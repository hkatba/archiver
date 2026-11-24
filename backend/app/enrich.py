"""AI enrichment: turn extracted page content into a structured, evidence-checked knowledge object.

Anti-hallucination measures:
  * the prompt restricts facts to the supplied page content and asks for verbatim evidence quotes;
  * the response must validate against a strict schema (`Enrichment`);
  * `verify()` checks every evidence quote against the source text: unverified features are flagged and
    unverified pricing is discarded entirely (pricing is never shown without evidence);
  * alternatives are always labelled as unverified AI suggestions.
Without an LLM (AI_PROVIDER=extractive) `extractive_enrichment()` builds the object from page metadata only.
"""

import hashlib
import re
from datetime import UTC, datetime
from functools import lru_cache
from typing import Literal, get_args

from pydantic import BaseModel, Field, model_validator

from app.config import settings
from app.embeddings import cosine, get_embedder
from app.llm import LLMProvider, Usage

PROMPT_VERSION = "2026-11-19.2"

CategoryName = Literal[
    "AI Tools", "Developer Tools", "Design", "Productivity", "Automation & No-Code", "Writing & Content",
    "Marketing & SEO", "Research & Learning", "Data & Analytics", "Documents & PDF", "Media",
    "Business & Finance", "Communication & Collaboration", "Hosting & Infrastructure", "Security & Privacy",
    "Open Source", "News & Articles", "Other",
]
CATEGORIES: list[str] = list(get_args(CategoryName))
ContentType = Literal["tool", "website", "article", "documentation", "repository", "resource", "other"]


class Feature(BaseModel):
    name: str = Field(description="A key capability, 2-8 words")
    evidence: str | None = Field(None, description="Short verbatim quote from the page content supporting it")


class Pricing(BaseModel):
    free_plan: bool | None = Field(None, description="true/false only if the page states it, else null")
    free_trial: bool | None = None
    paid_plans: bool | None = None
    starting_price: str | None = Field(None, description="Lowest paid price exactly as written, e.g. '$12/month'")
    pricing_url: str | None = None
    evidence: str | None = Field(None, description="Verbatim quote from the page with the pricing information")


class UsageNotes(BaseModel):
    use_for: str | None = Field(None, description="What this is useful for")
    when_to_use: str | None = None
    who_should_use: str | None = None
    differentiators: str | None = Field(None, description="What makes it different, if the page says so")
    limitations: str | None = None


class Alternative(BaseModel):
    name: str
    reason: str | None = None


class Enrichment(BaseModel):
    name: str = Field(description="Product/site name")
    short_description: str = Field(description="1-2 sentences: what it does")
    tldr: str = Field(description="2-3 sentences: what it does, its value, and when to use it")
    content_type: ContentType
    category: CategoryName
    subcategory: str | None = Field(None, description="Functional label, e.g. 'AI Presentation Generator'")
    problems_solved: list[str] = Field(default_factory=list)
    target_audience: list[str] = Field(default_factory=list)
    key_features: list[Feature] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list, description="3-5 lowercase functional search keywords")
    usage: UsageNotes = Field(default_factory=UsageNotes)
    pricing: Pricing = Field(default_factory=Pricing)
    is_open_source: bool | None = None
    alternatives: list[Alternative] = Field(default_factory=list)
    confidence: float = Field(description="0-1: how well the page content supported this analysis")
    unknowns: list[str] = Field(default_factory=list, description="Fields that could not be determined")

    @model_validator(mode="before")
    @classmethod
    def _coerce_shapes(cls, v):
        """Smaller/local models often send null sections, comma strings or near-miss enum values.
        Normalize the shape only; facts are still checked by verify()."""
        if not isinstance(v, dict):
            return v
        v = dict(v)
        for k in ("pricing", "usage"):
            if not isinstance(v.get(k), (dict, BaseModel)):
                v.pop(k, None)  # missing/null/string -> unknown
        for k in ("problems_solved", "target_audience", "tags", "unknowns"):
            x = v.get(k)
            if x is None:
                v.pop(k, None)
            elif isinstance(x, str):
                v[k] = [s.strip() for s in x.split(",") if s.strip()]
        for k in ("key_features", "alternatives"):
            x = v.get(k)
            if not isinstance(x, list):
                v.pop(k, None)
            else:
                v[k] = [{"name": i} if isinstance(i, str) else i for i in x
                        if isinstance(i, (str, dict, BaseModel))]
        cat = str(v.get("category") or "").strip()
        if cat not in CATEGORIES:
            match = next((c for c in CATEGORIES if c.lower() == cat.lower() or (cat and c.lower().startswith(
                cat.lower().split()[0]))), None)
            if not v.get("subcategory") and cat:
                v["subcategory"] = cat
            v["category"] = match or "Other"
        if v.get("content_type") not in get_args(ContentType):
            v["content_type"] = "other"
        if not isinstance(v.get("confidence"), (int, float)):
            try:
                v["confidence"] = float(v.get("confidence"))
            except (TypeError, ValueError):
                v["confidence"] = 0.5
        for k in ("short_description", "tldr", "name"):
            if v.get(k) is None:
                v[k] = ""
        return v


SYSTEM_PROMPT = f"""You analyze one saved web page for a personal knowledge library and return a structured profile.

Rules:
- Base every factual statement ONLY on the page content and metadata provided. Do not add facts from memory
  about features, pricing, open-source status or availability.
- If something is not stated, use null or an empty list, and add the field name to `unknowns`.
- For each key feature and for pricing, copy a short VERBATIM quote (5-25 words) from the page into `evidence`.
  Never infer prices or a free plan; if the page doesn't show pricing, leave all pricing fields null.
- `usage` fields are your interpretation of the page; keep them grounded and concise.
- `alternatives`: up to 4 well-known comparable products (they are shown to the user as unverified suggestions).
  Leave empty if unsure.
- `category` must be one of: {", ".join(CATEGORIES)}. Choose by what the product is FOR. Use "AI Tools" only
  when generating or analyzing content with AI is the product's main job (chatbots, image/video/voice
  generators, AI writing). A product that merely has AI features goes in its functional category: a notes app
  with AI is "Productivity", a UI component library is "Developer Tools", a design app is "Design".
- `subcategory`: a short functional label such as "AI Image Generator", "PDF Converter", "API Testing Tool".
- `tags`: 3-5 lowercase keywords describing what it does (not the product name).
- `target_audience`: from Developers, Designers, Founders, Students, Researchers, Marketers, Content Creators,
  Business Owners, General Users (or another short group if clearly better).
- Write plainly; no marketing language."""


def build_prompt(*, url: str, final_url: str | None, title: str | None, meta: dict, headings: list[str],
                 tech_stack: list[str], github: dict | None, markdown: str) -> str:
    parts = [f"URL: {url}"]
    if final_url and final_url != url:
        parts.append(f"Final URL after redirects: {final_url}")
    if title:
        parts.append(f"Page title: {title}")
    for key, label in (("site_name", "Site name"), ("description", "Meta description"), ("og_title", "OG title")):
        if meta.get(key):
            parts.append(f"{label}: {meta[key]}")
    if meta.get("keywords"):
        parts.append("Meta keywords: " + ", ".join(meta["keywords"]))
    if meta.get("jsonld"):
        parts.append(f"Structured data (JSON-LD): {str(meta['jsonld'])[:1500]}")
    if tech_stack:
        parts.append("Detected technologies: " + ", ".join(tech_stack))
    if github:
        gh = {k: github.get(k) for k in ("full_name", "description", "stars", "forks", "language", "license",
                                         "topics", "archived", "pushed_at", "latest_release", "homepage")}
        parts.append(f"GitHub repository data (from the GitHub API): {gh}")
    if headings:
        parts.append("Headings: " + " | ".join(headings[:30]))
    parts.append(f"\n--- PAGE CONTENT (markdown, may be truncated) ---\n{markdown[: settings.ai_max_input_chars]}")
    return "\n".join(parts)


def input_hash(provider: str, model: str, prompt: str) -> str:
    return hashlib.sha256(f"{PROMPT_VERSION}\n{provider}\n{model}\n{prompt}".encode()).hexdigest()


# ---------------------------------------------------------------- verification

def _norm(text: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9$€£%.]+", " ", text.lower()).split())


def supported(evidence: str | None, source_norm: str, source_tokens: set[str]) -> bool:
    """True if the quote appears in the source (exactly after normalization, or >=85% token overlap)."""
    if not evidence:
        return False
    ev = _norm(evidence)
    if len(ev) < 8:
        return False
    if ev in source_norm:
        return True
    tokens = ev.split()
    return len(tokens) >= 4 and sum(t in source_tokens for t in tokens) / len(tokens) >= 0.85


def verify(e: Enrichment, source_text: str) -> dict:
    src = _norm(source_text)
    tokens = set(src.split())
    data = e.model_dump()
    unknowns = set(e.unknowns)
    for f in data["key_features"]:
        # Models often quote the feature itself as its name; that's verifiable too
        f["verified"] = supported(f.get("evidence"), src, tokens) or supported(f.get("name"), src, tokens)
    p = data["pricing"]
    claims = any(p.get(k) is not None for k in ("free_plan", "free_trial", "paid_plans", "starting_price"))
    p["verified"] = bool(claims and supported(p.get("evidence"), src, tokens))
    if p.get("starting_price") and not any(_norm(tok) in src for tok in re.findall(r"[$€£]?\d[\d.,]*",
                                                                                   p["starting_price"])):
        p["starting_price"] = None
    if claims and not p["verified"]:
        for k in ("free_plan", "free_trial", "paid_plans", "starting_price"):
            p[k] = None
        p["evidence"] = None
        p["discarded_unverified"] = True
        unknowns.add("pricing")
    p["checked_at"] = datetime.now(UTC).isoformat()
    for a in data["alternatives"]:
        a["verified"] = False
    data["tags"] = list(dict.fromkeys(t.strip().lower().lstrip("#") for t in data["tags"] if t.strip()))[:5]
    data["confidence"] = max(0.0, min(1.0, float(data["confidence"])))
    data["unknowns"] = sorted(unknowns)
    data["source"] = "llm"
    return data


async def llm_enrichment(llm: LLMProvider, prompt: str, source_text: str) -> tuple[dict, Usage]:
    result, usage = await llm.structured(system=SYSTEM_PROMPT, user=prompt, schema=Enrichment)
    return verify(result, source_text), usage


# ---------------------------------------------------------------- extractive fallback (no LLM)

# (category, subcategory, description) used for zero-shot classification by embedding similarity
TAXONOMY = [
    ("AI Tools", "AI Chatbot / Assistant", "AI chatbot assistant that answers questions and chats"),
    ("AI Tools", "AI Writing Assistant", "AI writing assistant that generates and edits text copy"),
    ("AI Tools", "AI Image Generator", "generate images art and photos from text prompts with AI"),
    ("AI Tools", "AI Video Generator", "AI video generation create videos from text or images"),
    ("AI Tools", "AI Audio & Voice", "AI voice generation text to speech music and audio"),
    ("AI Tools", "AI Presentation Generator", "AI that creates slide decks and presentations"),
    ("AI Tools", "AI Coding Assistant", "AI coding assistant that writes and explains code"),
    ("AI Tools", "AI App Builder", "build apps and websites with AI from a prompt"),
    ("AI Tools", "AI Research Assistant", "AI search engine and research assistant with citations"),
    ("AI Tools", "AI Agents & Models", "AI agents, large language models and model APIs"),
    ("Developer Tools", "API Platform", "API platform and developer API services"),
    ("Developer Tools", "API Testing & Debugging", "test debug and monitor HTTP APIs"),
    ("Developer Tools", "Developer Utility", "developer utility tool for programmers"),
    ("Developer Tools", "Frontend & UI Library", "frontend UI component library framework CSS"),
    ("Developer Tools", "Database & Backend", "database backend as a service storage"),
    ("Developer Tools", "Documentation", "developer documentation reference guide"),
    ("Design", "UI/UX Design Tool", "design user interfaces prototypes and mockups"),
    ("Design", "Design Resources", "icons fonts illustrations templates and design assets"),
    ("Design", "Design Inspiration", "design inspiration gallery of websites and interfaces"),
    ("Productivity", "Notes & Knowledge", "note taking knowledge base and personal wiki"),
    ("Productivity", "Task & Project Management", "task management to-do lists and project planning"),
    ("Productivity", "Calendar & Scheduling", "calendar scheduling and meeting booking"),
    ("Automation & No-Code", "Workflow Automation", "automate workflows connect apps and integrations"),
    ("Automation & No-Code", "Website Builder", "no-code website builder landing pages"),
    ("Automation & No-Code", "No-Code App Builder", "build web and mobile apps without code"),
    ("Writing & Content", "Writing Tool", "writing grammar editing and content creation"),
    ("Marketing & SEO", "SEO Tool", "search engine optimization keyword research rankings"),
    ("Marketing & SEO", "Social Media Tool", "social media scheduling and management"),
    ("Marketing & SEO", "Email Marketing", "email marketing newsletters campaigns"),
    ("Research & Learning", "Learning Platform", "online courses tutorials and learning"),
    ("Research & Learning", "Research Tool", "academic research papers and literature search"),
    ("Data & Analytics", "Analytics", "web analytics dashboards and metrics"),
    ("Data & Analytics", "Data Tool", "data analysis spreadsheets and visualization"),
    ("Documents & PDF", "PDF Utility", "convert merge compress and edit PDF files"),
    ("Documents & PDF", "File Converter", "convert files between formats online"),
    ("Media", "Image Editing", "edit photos remove backgrounds resize images"),
    ("Media", "Video Editing", "edit videos online cut subtitles"),
    ("Media", "Stock Media", "free stock photos videos and music"),
    ("Business & Finance", "Business Tool", "business invoicing accounting payments CRM"),
    ("Communication & Collaboration", "Team Collaboration", "team chat collaboration and communication"),
    ("Hosting & Infrastructure", "Hosting & Deployment", "deploy and host websites servers cloud"),
    ("Security & Privacy", "Security & Privacy Tool", "password security privacy VPN protection"),
    ("News & Articles", "Article", "blog post news article opinion essay"),
]


@lru_cache
def _taxonomy_vectors() -> list[list[float]]:
    return get_embedder().documents([f"{sub}: {desc}" for _, sub, desc in TAXONOMY])


def zero_shot_category(text: str) -> tuple[str | None, str | None, float]:
    vec = get_embedder().query(text[:2000])
    scored = sorted(((cosine(vec, tv), i) for i, tv in enumerate(_taxonomy_vectors())), reverse=True)
    score, idx = scored[0]
    if score < 0.55:
        return None, None, score
    cat, sub, _ = TAXONOMY[idx]
    return cat, sub, score


_MD_LINK = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")


def _sentences(markdown: str, limit: int) -> list[str]:
    text = _MD_LINK.sub(r"\1", markdown)
    out = []
    for line in text.splitlines():
        line = re.sub(r"^[#>*\-\s|]+", "", line).replace("**", "").replace("__", "").strip()
        if len(line) < 40 or line.count(" ") < 5:
            continue
        for s in re.split(r"(?<=[.!?])\s+", line):
            if len(s) >= 30:
                out.append(s.strip())
            if len(out) >= limit:
                return out
    return out


def _clean_name(title: str | None) -> str | None:
    if not title:
        return None
    return re.split(r"\s+[|\-–—·:]\s+", title)[0].strip()[:120] or None


def extractive_enrichment(*, title: str | None, meta: dict, markdown: str, github: dict | None,
                          domain: str) -> dict:
    """Metadata-only profile. Contains nothing that isn't on the page; everything else is `unknown`."""
    name = meta.get("site_name") or _clean_name(meta.get("og_title")) or _clean_name(title) or domain
    first = _sentences(markdown, 3)
    description = meta.get("description") or (github or {}).get("description") or (first[0] if first else None)
    tldr = " ".join(first[:3]) if first else description
    cat, sub, score = zero_shot_category("\n".join(filter(None, [name, title, description, tldr])))
    if github:
        cat = cat if cat and cat != "News & Articles" else "Open Source"
    tags = [k.lower() for k in (meta.get("keywords") or (github or {}).get("topics") or [])][:5]
    content_type = "repository" if github else ("article" if meta.get("type") == "article" else "website")
    return {
        "name": name, "short_description": description, "tldr": tldr, "content_type": content_type,
        "category": cat, "subcategory": sub, "problems_solved": [], "target_audience": [], "key_features": [],
        "tags": tags, "usage": {}, "alternatives": [],
        "pricing": {"verified": False, "checked_at": datetime.now(UTC).isoformat()},
        "is_open_source": True if github and github.get("license") else None,
        "confidence": round(min(0.4, max(0.1, score - 0.3)), 2),
        "unknowns": ["problems_solved", "target_audience", "key_features", "pricing", "usage"],
        "source": "extractive",
    }

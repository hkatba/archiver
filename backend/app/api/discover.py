import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.api.common import cards, load_links
from app.auth import ai_limiter, current_user
from app.db import get_db
from app.llm import LLMError, get_llm
from app.models import SearchHistory, User
from app.schemas import AssistantIn, AssistantOut, SearchFilters, SearchIn, SearchOut, SearchResult
from app.search import Filters, search
from app.services import latest_enrichment

router = APIRouter(prefix="/api", tags=["search"])


def _filters(f: SearchFilters) -> Filters:
    return Filters(**f.model_dump())


@router.post("/search", response_model=SearchOut, summary="Hybrid semantic + keyword search with explanations")
def run_search(body: SearchIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    hits = search(db, user.id, body.query, mode=body.mode, filters=_filters(body.filters), limit=body.limit)
    links = load_links(db, [h.link_id for h in hits])
    by_id = {c.id: c for c in cards(db, links)}
    if body.query.strip():
        db.add(SearchHistory(user_id=user.id, query=body.query.strip()[:500], mode=body.mode, result_count=len(hits)))
        db.commit()
    return SearchOut(query=body.query, mode=body.mode, results=[
        SearchResult(link=by_id[h.link_id], score=round(h.score, 5),
                     similarity=round(h.similarity, 3) if h.similarity is not None else None, reasons=h.reasons)
        for h in hits if h.link_id in by_id])


ASSISTANT_SYSTEM = """You are a research assistant for the user's personal library of saved websites and tools.

Rules:
- Use ONLY the numbered library items provided with the question as the set of tools the user has saved.
  Never claim the library contains a tool that is not in the list.
- Cite items inline by number, like [2]. Recommend the best fits first and say briefly why.
- If no item fits, say plainly that the library doesn't seem to contain a matching tool.
- Facts about an item (features, pricing, open source) come from its data below. If you add general knowledge,
  label it as such ("generally known: ..."). Only mention pricing that the item marks as verified.
- Be concise: short paragraphs or bullet lists."""


def _item_context(n: int, link, ai: dict) -> str:
    pricing = ai.get("pricing") or {}
    features = [f["name"] for f in ai.get("key_features") or [] if isinstance(f, dict)][:6]
    lines = [f"[{n}] {link.name} ({link.domain})"]
    if link.subcategory or link.category:
        lines.append(f"Category: {link.category or ''}{' > ' + link.subcategory if link.subcategory else ''}")
    for label, val in (("Description", link.description), ("TL;DR", ai.get("tldr")),
                       ("Problems solved", "; ".join(ai.get("problems_solved") or [])),
                       ("Audience", ", ".join(ai.get("target_audience") or [])),
                       ("Features", "; ".join(features)), ("Tags", ", ".join(link.tags))):
        if val:
            lines.append(f"{label}: {val}")
    if pricing.get("verified"):
        lines.append(f"Pricing (verified): free plan={pricing.get('free_plan')}, free trial={pricing.get('free_trial')},"
                     f" starting price={pricing.get('starting_price')}")
    else:
        lines.append("Pricing: unknown")
    if link.is_open_source is not None:
        lines.append(f"Open source: {link.is_open_source}")
    return "\n".join(lines)


@router.post("/assistant", response_model=AssistantOut, summary="Ask questions about your saved library")
async def assistant(body: AssistantIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    llm = get_llm()
    if llm is None:
        raise HTTPException(400, "The assistant needs an AI provider. Set AI_PROVIDER (anthropic, openai, gemini or "
                                 "ollama) in .env and restart. Search works without it.")
    ai_limiter.check(f"assistant:{user.id}")
    if body.messages[-1].role != "user":
        raise HTTPException(422, "The last message must be from the user")
    user_turns = [m.content for m in body.messages if m.role == "user"]
    retrieval_query = " ".join(user_turns[-2:])  # follow-ups ("compare them") keep the previous topic

    def retrieve():
        hits = search(db, user.id, retrieval_query, filters=_filters(body.filters), limit=8, min_similarity=0.5)
        links = load_links(db, [h.link_id for h in hits])
        link_cards = cards(db, links)
        ais = [(latest_enrichment(db, lk.id) or None) for lk in links]
        return link_cards, [a.data if a else {} for a in ais]

    link_cards, ai_data = await run_in_threadpool(retrieve)
    context = "\n\n".join(_item_context(i + 1, c, a) for i, (c, a) in enumerate(zip(link_cards, ai_data)))
    question = body.messages[-1].content
    final = (f"Library items relevant to the question:\n\n{context}" if link_cards
             else "No library items matched this question.") + f"\n\nQuestion: {question}"
    history = [m.model_dump() for m in body.messages[:-1]][-10:]
    try:
        answer, _usage = await llm.chat(system=ASSISTANT_SYSTEM, messages=[*history, {"role": "user", "content": final}])
    except LLMError as e:
        raise HTTPException(502, str(e)) from None
    cited = {int(n) for n in re.findall(r"\[(\d+)\]", answer)}
    sources = [c for i, c in enumerate(link_cards, 1) if i in cited] or link_cards
    return AssistantOut(answer=answer, sources=sources, provider=llm.name, model=llm.smart_model)

import pytest

from app.enrich import (
    Alternative,
    Enrichment,
    Feature,
    Pricing,
    build_prompt,
    extractive_enrichment,
    llm_enrichment,
    verify,
)
from app.extract import parse_html
from app.llm import Usage
from tests.conftest import fixture_html

SOURCE = parse_html(fixture_html("saas.html"), "https://slidecraft.example/").markdown


def make(**kw) -> Enrichment:
    base = dict(name="SlideCraft", short_description="Makes slide decks with AI.", tldr="AI deck generator.",
                content_type="tool", category="AI Tools", subcategory="AI Presentation Generator",
                tags=["#Presentations", "slides", "Slides", "pitch decks", "ai", "extra"], confidence=1.4)
    base.update(kw)
    return Enrichment(**base)


def test_verified_pricing_is_kept():
    e = make(pricing=Pricing(free_plan=True, paid_plans=True, starting_price="$12 per month",
                             evidence="The Pro plan costs $12 per month and unlocks unlimited decks"))
    data = verify(e, SOURCE)
    assert data["pricing"]["verified"] is True
    assert data["pricing"]["free_plan"] is True and data["pricing"]["starting_price"] == "$12 per month"


def test_hallucinated_pricing_is_discarded():
    e = make(pricing=Pricing(free_plan=True, starting_price="$9/month", evidence="Free forever for everyone"))
    data = verify(e, SOURCE)
    p = data["pricing"]
    assert p["verified"] is False and p["free_plan"] is None and p["starting_price"] is None
    assert p["discarded_unverified"] is True and "pricing" in data["unknowns"]


def test_price_not_in_source_is_dropped_even_with_valid_quote():
    e = make(pricing=Pricing(paid_plans=True, starting_price="$15/mo",
                             evidence="The Pro plan costs $12 per month and unlocks unlimited decks"))
    assert verify(e, SOURCE)["pricing"]["starting_price"] is None


def test_feature_evidence_and_normalization():
    e = make(key_features=[
        Feature(name="Prompt to deck", evidence="Generate a full deck from one prompt or an uploaded document."),
        Feature(name="Video export", evidence="Export your deck as an MP4 video"),
        Feature(name="No quote"),
        Feature(name="Brand kits keep fonts and colors consistent across every deck."),  # name is a quote
    ], alternatives=[Alternative(name="Gamma")])
    data = verify(e, SOURCE)
    assert [f["verified"] for f in data["key_features"]] == [True, False, False, True]
    assert data["alternatives"][0]["verified"] is False
    assert data["tags"] == ["presentations", "slides", "pitch decks", "ai", "extra"]
    assert data["confidence"] == 1.0 and data["source"] == "llm"


class FakeLLM:
    name, fast_model, smart_model = "fake", "fake-fast", "fake-smart"

    def __init__(self, result: Enrichment):
        self.result, self.calls = result, []

    async def structured(self, *, system, user, schema, smart=False):
        self.calls.append(user)
        assert schema is Enrichment and "verbatim" in system.lower()
        return self.result, Usage(1000, 200)

    async def chat(self, *, system, messages):
        return "ok", Usage()


async def test_llm_enrichment_runs_verification():
    llm = FakeLLM(make(pricing=Pricing(free_plan=True, evidence="totally free")))
    prompt = build_prompt(url="https://slidecraft.example/", final_url=None, title="SlideCraft", meta={},
                          headings=[], tech_stack=[], github=None, markdown=SOURCE)
    data, usage = await llm_enrichment(llm, prompt, SOURCE)
    assert usage.input_tokens == 1000
    assert data["pricing"]["free_plan"] is None
    assert "PAGE CONTENT" in llm.calls[0]


def test_extractive_enrichment_uses_only_page_data():
    ext = parse_html(fixture_html("saas.html"), "https://slidecraft.example/")
    data = extractive_enrichment(title=ext.title, meta=ext.meta, markdown=ext.markdown, github=None,
                                 domain="slidecraft.example")
    assert data["name"] == "SlideCraft"
    assert data["short_description"] == ext.meta["description"]
    assert data["source"] == "extractive"
    assert data["pricing"]["verified"] is False and "pricing" in data["unknowns"]
    assert data["tags"] == ["ai presentations", "slide generator", "pitch deck"]
    assert 0.1 <= data["confidence"] <= 0.4


def test_invalid_enums_are_mapped_not_trusted():
    assert make(content_type="spaceship").content_type == "other"
    assert make(category="ai tools").category == "AI Tools"
    with pytest.raises(ValueError):
        Enrichment.model_validate("not an object")


def test_coerces_sloppy_model_output():
    e = Enrichment.model_validate({
        "name": "Hoppscotch", "short_description": "API client.", "tldr": None, "content_type": "web app",
        "category": "developer tools", "subcategory": None, "pricing": None, "usage": "n/a",
        "problems_solved": "testing APIs, debugging requests", "target_audience": None,
        "key_features": ["REST client", {"name": "GraphQL", "evidence": "GraphQL support"}, 3],
        "alternatives": "Postman", "tags": "api, testing", "confidence": "0.8", "unknowns": None,
    })
    assert e.category == "Developer Tools" and e.content_type == "other" and e.tldr == ""
    assert e.pricing.free_plan is None and e.problems_solved == ["testing APIs", "debugging requests"]
    assert [f.name for f in e.key_features] == ["REST client", "GraphQL"] and e.alternatives == []
    assert e.tags == ["api", "testing"] and e.confidence == 0.8


def test_unknown_category_becomes_other_with_subcategory():
    e = make(category="Spaceship Builders", subcategory=None)
    assert e.category == "Other" and e.subcategory == "Spaceship Builders"

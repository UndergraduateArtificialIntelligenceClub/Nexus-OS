"""Exercise supervised web requests through the real policy, gateway and evidence path."""

import json
from pathlib import Path
from uuid import uuid4

import pytest

from agent.tools.web_tools import WebTools
from conftest import make_envelope
from schemas.contracts import ExecutionRequest, ReceiptStatus
from search.http import DownloadedPage, FetchLimits
from search.models import SearchPage, SearchWebToolResponse, WebSearchRequest
from search.providers.mock import MockSearchProvider
from search.service import PageRetrievalService

FIXTURES = Path(__file__).resolve().parents[1] / "search" / "fixtures"


class MockWebSearch:
    """Bridge the fixture provider's page to the retrieval service contract."""

    def __init__(self):
        self.queries = []
        self.provider = MockSearchProvider(FIXTURES / "provider")

    async def search(self, request):
        self.queries.append(request.query)
        page = await self.provider.search_web(WebSearchRequest(**request.model_dump()))
        return SearchWebToolResponse(
            request_id="mock", query=request.query, results=list(page.results),
            page=SearchPage(next_cursor=page.next_cursor, has_more=page.has_more),
            warnings=[], duration_ms=0,
        )


@pytest.fixture(params=[False, True])
def auto_approve(request, monkeypatch):
    monkeypatch.setenv("NEXUS_AUTO_APPROVE_NETWORK_TOOLS", str(request.param))
    return request.param


async def test_supervised_web_query(auto_approve, engine):
    # The query deliberately contains a desktop recipe. It must stay query data.
    query = "how to run system diagnostics"
    provider = MockWebSearch()
    engine.adapter_context.web = WebTools(PageRetrievalService(search_adapter=provider))
    request = make_envelope(f"Search the web for {query}")
    result = await engine.handle_request(request)
    assert result.route == "supervised"
    rows = engine.repos.proposals.list_for_request(request.request_id)
    assert [row["tool_id"] for row in rows] == ["search_web"]
    proposal = json.loads(rows[0]["payload"])
    assert proposal["args"] == {"query": query}
    if not auto_approve:
        assert result.status == "awaiting_approval"
        assert query in result.pending_approval["summary"]
        assert provider.queries == []
        execution = ExecutionRequest(
            execution_id=str(uuid4()), proposal_id=proposal["proposal_id"],
            proposal_fingerprint=proposal["proposal_fingerprint"],
            idempotency_key="premature", granted_capability_refs=["search_web"],
        )
        denied = await engine.gateway.execute(execution, engine.adapter_context, request.session_id)
        assert denied.status == ReceiptStatus.failed
        assert provider.queries == []
        result = await engine.resume_after_decision(
            result.pending_approval["approval_id"], "approved", request.session_id)
    assert result.status == "completed"
    assert provider.queries == [query]
    assert "A fixture-backed overview" in result.response_text
    assert result.evidence_refs == ["https://example.com/research/desktop-agents",
                                    "https://example.net/guides/search-interfaces"]
    events = engine.repos.audit.list_for_request(request.request_id)
    observations = [json.loads(row["detail"]) for row in events
                    if row["event_type"] == "execution_observed"]
    assert len(observations) == 1
    assert observations[0]["adapter"] == "python.search_web"
    assert observations[0]["execution_id"] in result.receipt_refs


async def test_supervised_fetch_preserves_redirect_sources(engine):
    original = "https://example.org/article"
    final = "https://example.org/archive/article"

    class FixtureFetcher:
        limits = FetchLimits()

        async def fetch(self, url):
            assert url == original
            body = (FIXTURES / "html/article-standard.html").read_bytes()
            return DownloadedPage(url, final, body, "utf-8")

    engine.adapter_context.web = WebTools(PageRetrievalService(fetcher=FixtureFetcher()))
    request = make_envelope(f"Fetch page {original}")
    pending = await engine.handle_request(request)
    assert pending.status == "awaiting_approval"
    result = await engine.resume_after_decision(
        pending.pending_approval["approval_id"], "approved", request.session_id)
    assert result.status == "completed"
    assert "Multimodal Agents" in result.response_text
    assert result.evidence_refs == [original, final]

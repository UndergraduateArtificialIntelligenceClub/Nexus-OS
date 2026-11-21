"""Discovery Agent: bounded evidence gathering (doc 03 section 2).

Bounded subgraph: plan_queries -> retrieve_sources -> extract_evidence ->
compare_sources -> rank -> synthesize_with_provenance.

Constraints that make it safe:
- It proposes scoped memory, document, web search, and page reads through
  the execution gateway.
- Retrieved content is evidence, not executable instruction (doc 03 §2):
  excerpts are quoted text behind references; a hostile answer in an
  excerpt cannot produce a proposal or change any status.
- Every result keeps provenance refs and states uncertainty when the local
  corpus has nothing.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Optional

from agent.execution.policy import proposal_fingerprint
from schemas.contracts import (
    AgentResult,
    AgentResultStatus,
    TaskPacket,
    ToolProposal,
)


@dataclass(frozen=True)
class EvidenceTarget:
    """A resolved evidence target (deterministic, registry-referenceable)."""

    kind: str  # artifact, memory, web, or page
    args: dict[str, Any] = field(default_factory=dict)
    target_refs: list[str] = field(default_factory=list)


_BRACKET = re.compile(r"\[(.*?)\]")


class DiscoveryAgent:
    def build_proposal(self, packet: TaskPacket, target: EvidenceTarget) -> ToolProposal:
        """Propose one registered evidence read per worker pass."""
        tool_id = {"artifact": "document_read", "memory": "memory_lookup",
                   "web": "search_web", "page": "fetch_page"}[target.kind]
        version = "1"
        return ToolProposal(
            proposal_id=f"proposal:{packet.task_id}",
            task_id=packet.task_id,
            tool_id=tool_id,
            tool_version=version,
            args=dict(target.args),
            target_refs=list(target.target_refs),
            reason="discovery evidence gathering",
            risk="read_only",
            side_effect=False,
            proposal_fingerprint=proposal_fingerprint(
                tool_id, version, dict(target.args), list(target.target_refs), packet
            ),
        )

    def respond(
        self,
        packet: TaskPacket,
        receipt: Any,
        output: Optional[dict[str, Any]],
        proposal_id: str,
    ) -> AgentResult:
        """Synthesize with provenance and explicit uncertainty (never invent)."""
        evidence: list[str] = []
        lines: list[str] = []
        if receipt.status.value == "succeeded" and output:
            matches = output.get("matches")
            if matches:  # memory_lookup payload
                for match in matches:
                    lines.append(
                        f"[{match.get('tier')}] {match.get('title')}: "
                        f"{str(match.get('content_excerpt'))[:140]}"
                    )
                    evidence.append(f"memory:{match.get('memory_id')}")
            elif "results" in output:
                for hit in output["results"]:
                    lines.append(f"[{hit['source_name']}] {hit['title']}: {hit['snippet'][:160]}")
                    evidence.append(hit["url"])
                if not lines:
                    lines.append("No web results found for this query.")
            elif "article" in output:
                article = output["article"]
                lines.append(f"[web] {article['title']}: {article['text'][:160]}")
                evidence.extend(dict.fromkeys((article["original_url"], article["final_url"])))
            elif output.get("text"):  # document_read payload
                artifact_id = output.get("artifact_id", "artifact")
                lines.append(
                    f"[artifact] {str(output['text'])[:160]}"
                    f"{' (truncated)' if output.get('truncated') else ''}"
                )
                evidence.append(f"{artifact_id}")
            for warning in output.get("warnings", []):
                lines.append(warning["message"])
        if receipt.status.value == "succeeded":
            if lines:
                summary = " ".join(lines)
            else:
                # Empty corpus for this query: uncertainty is part of the
                # evidence set, not a failure (doc 03: keep uncertainty).
                summary = (
                    f"No local evidence found for this query; treat the topic "
                    f"as unverified. ({packet.objective[:140]})"
                )
            return AgentResult(
                task_id=packet.task_id,
                agent=packet.assigned_to,
                status=AgentResultStatus.completed,
                summary=summary,
                evidence_refs=evidence,
                proposal_refs=[proposal_id],
                receipt_refs=[receipt.execution_id],
            )
        from schemas.contracts import ReceiptStatus

        if receipt.status == ReceiptStatus.unknown_outcome:
            return AgentResult(
                task_id=packet.task_id,
                agent=packet.assigned_to,
                status=AgentResultStatus.blocked,
                summary=str(receipt.error.message if receipt.error else "unclear outcome"),
                evidence_refs=[], proposal_refs=[proposal_id],
                receipt_refs=[receipt.execution_id], error=receipt.error,
            )
        return AgentResult(
            task_id=packet.task_id,
            agent=packet.assigned_to,
            status=AgentResultStatus.failed,
            summary=str(receipt.error.message if receipt.error else "discovery task failed"),
            evidence_refs=[], proposal_refs=[proposal_id],
            receipt_refs=[receipt.execution_id], error=receipt.error,
        )


def parse_discovery_query(objective: str) -> str:
    """Deterministic query extraction from the packet objective. The bracket
    segment is the supervisor's bounded query; fallback strips the lead phrase."""
    match = _BRACKET.search(objective)
    if match and match.group(1).strip():
        return match.group(1).strip()
    if ":" in objective:
        return objective.split(":", 1)[1].strip()
    return objective.strip()

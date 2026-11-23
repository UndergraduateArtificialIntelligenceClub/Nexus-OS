# Memory Manager

Status: **Proposed** for Milestone 2. Tracked by issues
[#93-#101](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/milestone/5).
The starter retrieval code still runs; this plan replaces it without changing the
AI-Core trust boundaries.

Memory is three surfaces with one source of truth:

```text
main graph (supervisor + workers)
        |  MemoryRequest / TurnObservation
        v
Memory Liaison  (the memory sub-agent, role: memory)
        |  typed calls; no database handle
        v
Memory Manager  (trusted service: store, retrieve, validate, index)
        |  SQLite canonical + rebuildable projections
        ^
        |  HTTP reads, mutations, WebSocket events
Memory widget  (shell internal app: browse, review, identity, health)
```

**The Manager commits. The Liaison proposes. The user controls.**

## Why this shape

- **Local-first.** SQLite is canonical, projections are rebuildable, and no hosted
  memory service is required.
- **Scoped by default.** Every memory row carries `user_id`, `workspace_id`, and
  `session_id`. A read cannot accidentally cross a scope boundary.
- **C8-gated.** Agents propose memory; trusted engine code validates and commits.
  The main agent never receives a database handle or `memory_save`.
- **Inspectable.** The widget shows what is remembered, where it came from, and
  what the Liaison used in the last run.
- **Deterministic without a model.** Retrieval, validation, dedupe, indexing, and
  provider-`none` fallback all work without an LLM.

## Documents

| Document | Contents |
| --- | --- |
| [plan.md](plan.md) | Architecture, storage, retrieval, write lifecycle, delivery phases, risks |
| [contracts.md](contracts.md) | Scope rules, link types, C8 v2, API endpoints, events |
| [ui.md](ui.md) | Memory widget registry entry, layouts, source seam, actions, tests |

Canonical AI-Core vocabulary remains in
[05 - Reference glossary](../AI-Core/05-reference-glossary.md). Contract IDs
(`C1`-`C9`) remain authoritative in
[02 - API and contracts](../AI-Core/02-api-and-contracts.md).

## Issue map

| # | Issue | Pri | Depends on |
| --- | --- | --- | --- |
| [#93](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/93) | Memory store foundation: canonical scope, audit, FTS5 projection | p0 | - |
| [#94](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/94) | Intent-aware retrieval and MemoryContext assembly | p0 | #93 |
| [#95](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/95) | Memory Liaison subagent and main-agent link | p0 | #93, #94, #54, #41, #45 |
| [#96](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/96) | Memory read API and events | p0 | #93, #94, #41, #45 |
| [#97](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/97) | Memory widget: browse, search, health | p0 | #94, #95, #96, #41, #45, #55 |
| [#98](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/98) | Memory write lifecycle and mutation API | p1 | #93, #94, #95, #96 |
| [#99](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/99) | Memory widget controls: review, edit, forget, identity | p1 | #97, #98, #100 |
| [#100](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/100) | Session memory, identity profile, instruction files | p1 | #93, #94, #95, #98 |
| [#101](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/101) | Advanced memory: semantic file RAG + consolidation duties | p2 | #93, #94, #95, #98, #100, #59 |

Issue [#79](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/79)
(M3) is rescoped to the advanced remainder: entity and relation memory, temporal
multi-hop retrieval, graph-based identity enrichment, and privacy hardening across
every projection.

## Current baseline

The repository already has:

- `memories`, `memory_sources`, `memory_proposals`, `memory_index`, and
  `knowledge_artifacts` tables in `modules/storage/schema.sql`;
- C8 `MemoryProposal`, `MemoryTier`, `MemoryKind`, and `MemoryContext` models in
  `apps/engine/backend/schemas/contracts.py`;
- `MemoryService.retrieve_context` and `propose_episode` in
  `apps/engine/backend/agent/memory/service.py`;
- `ingest_build_context` and `respond_propose_memory` nodes in
  `apps/engine/backend/agent/graphs/main_graph.py`;
- `memory_lookup` and `memory_save` registry entries;
- the agent identity contract (#54) and a read-only roster (#55).

The starter path uses `LIKE` over `memory_index`, a fixed freshness value, and
word-overlap relevance. It also proposes an M2 episode for every completed turn.
This plan keeps what works, makes the store scoped and auditable, and replaces the
retrieval and write lifecycle as separate reviewed issues.

## Non-goals

- No hosted memory service, remote database, or required cloud embedding provider.
- No separate orchestrator or second agent runtime.
- No direct SQLite access from the shell, the main agent, or the Liaison.
- No silent memory writes, silent deletes, or hidden prompt injection.
- No chat surface in the Memory widget; the orb remains the conversation surface.

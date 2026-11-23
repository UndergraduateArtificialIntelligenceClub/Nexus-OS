# Memory Manager - M2 plan

Status: **Proposed**. This document is the design target for issues #93-#101 in
Milestone 2. It does not claim that the implementation exists yet.

Companion documents:

- [README.md](README.md) - purpose, principles, and issue map
- [contracts.md](contracts.md) - scope rules, link types, C8 v2, API, and events
- [ui.md](ui.md) - Memory widget layouts, source seam, actions, and tests
- [AI-Core / 05 - Reference glossary](../AI-Core/05-reference-glossary.md) -
  canonical M0-M5 vocabulary

---

## 1. Goals

1. Make SQLite the single canonical memory store, scoped by user, workspace, and
   session, with an append-only audit trail.
2. Retrieve the right memories under a token budget, deterministically, without a
   hosted service or a model call.
3. Give the main agent a memory sub-agent that owns the link: it reads scoped
   context and proposes new memory, but never writes to the database directly.
4. Give the user a first-class Memory widget to browse, search, review, correct,
   pin, forget, export, and inspect health.
5. Make every search and vector projection rebuildable from canonical rows.
6. Keep provider `none` fully functional: retrieval, validation, dedupe, indexing,
   and basic capture must not depend on an LLM.

## 2. System shape

```text
+--------------------------- main LangGraph ----------------------------+
| ingest_build_context -> choose_route -> ... -> respond_propose_memory |
|            |                                          |              |
|            | MemoryRequest                            | TurnObservation
|            v                                          v              |
|      +------------------ Memory Liaison ------------------+          |
|      | identity: memory:<run_id>, role: memory            |          |
|      | capabilities: read, propose, summarize             |          |
|      | no DB handle, no memory_save, no scope mutation     |          |
|      +-------------------------+--------------------------+          |
+--------------------------------|--------------------------------------+
                                 | typed calls
                                 v
                    +----------------------------+
                    |       Memory Manager       |
                    | trusted engine service     |
                    |                            |
                    | - scope enforcement        |
                    | - C8 validation            |
                    | - canonical commit         |
                    | - FTS5/vector projections  |
                    | - audit + repair queue     |
                    +-------------+--------------+
                                  |
                                  v
                    +----------------------------+
                    | SQLite canonical records   |
                    | + rebuildable projections  |
                    +-------------+--------------+
                                  ^
                                  | local HTTP + WS events
                    +-------------+--------------+
                    |       Memory widget        |
                    | browse / review / identity |
                    | health / controls          |
                    +----------------------------+
```

The Manager is a service, not an agent. The Liaison is an agent in the roster
sense (stable identity, status, activity, owner run), but its read path is
deterministic and its role is deliberately narrow.

## 3. Trust split

| Surface | May read | May propose | May commit | May forget | May change scope |
| --- | --- | --- | --- | --- | --- |
| Main graph / workers | Through Liaison | Through Liaison | No | No | No |
| Memory Liaison | Scoped context | Yes, C8 | No | No | No |
| Memory Manager | Yes | No (validates) | Yes | Only on user action | Yes, engine-owned |
| Memory widget | Through API | Through API import | No | Through explicit user action | No |
| User | Yes | Yes | Via explicit action | Yes | No |

Rules:

- The main agent and the Liaison never receive a database handle.
- `memory_save` is internal-only and accepts a validated record reference, never
  free-form agent text.
- The Liaison cannot widen its scope, tier list, token budget, or capabilities.
- `FORGET` is user-only. A user may delete or invalidate; an agent may only propose
  a replacement or a correction.
- Stored memory is data, not instructions. Retrieval wraps every excerpt in a
  provenance envelope and the prompt builder labels it as untrusted data.

## 4. Scope model

Every durable memory row carries:

```text
(user_id, workspace_id, session_id)
```

| Field | Meaning | Default |
| --- | --- | --- |
| `user_id` | Local user identity | `local` |
| `workspace_id` | Shell workspace context; `NULL` means user-global | `NULL` |
| `session_id` | Originating session; `NULL` means durable across sessions | `NULL` |

`workspace_id` follows the existing shell workspace ID (the same ID used by
`persist_workspace`). It is a memory context, not a filesystem root. Whether a
layout switch should also switch memory context remains an open decision in §14.

Retrieval precedence:

1. session-scoped rows for the active session;
2. workspace-scoped rows for the active workspace, when one is active;
3. user-global durable rows (`workspace_id IS NULL`).

A query never returns rows for another user or another workspace. A session-scoped
row may be promoted to a durable row only through the write lifecycle.

## 5. Canonical data model

### 5.1 Existing tables to extend

| Table | M2 change |
| --- | --- |
| `memories` | Add scope, origin, importance, validity, supersession, index state, access fields, and indexes; keep `revision`, `status`, and `content_hash`. |
| `memory_sources` | Keep as the canonical provenance join; add source kind and locator metadata only if needed. |
| `memory_proposals` | Add scope, origin, policy/extractor versions, dedupe key, idempotency key, and review reason. |
| `memory_index` | Replace with an FTS5 projection over searchable text; keep a `LIKE` fallback table/path. |
| `knowledge_artifacts` | Reuse for file RAG in #101; no duplicate artifact store. |

### 5.2 New tables

| Table | Purpose | Issue |
| --- | --- | --- |
| `memory_events` | Append-only audit of create, update, supersede, forget, review, index, and repair actions. | #93 |
| `memory_index_jobs` | Idempotent repair queue for failed or stale projections. | #93 |
| `identity_fields` | Explicit and inferred profile fields with evidence, confidence, sensitivity, and approval state. | #100 |

### 5.3 Memory tiers

The canonical M0-M5 split stays unchanged:

| Tier | Memory Manager treatment |
| --- | --- |
| M0 Live World State | Runtime only; never written through C8. |
| M1 Working Context | Graph state; bounded and request-scoped. |
| M2 Episodic | Session summaries and interaction outcomes. |
| M3 Semantic | Durable facts and preferences with evidence. |
| M4 Procedural | Reviewed procedures and recipes; versioned. |
| M5 Knowledge Artifacts | Artifact metadata and filesystem references. |

### 5.4 Indexing

- Canonical rows are written first. The search projection is updated second.
- FTS5 is the default. If FTS5 is unavailable, the service falls back to `LIKE`
  with the same scope filters and a reported `index_mode`.
- A failed projection write leaves the canonical row intact and enqueues
  `memory_index_jobs`.
- `rebuild-index` is idempotent, reports before/after counts, and can run while
  reads continue.
- Vector projections are optional (#101) and are also rebuildable, keyed by
  memory ID and revision.

## 6. Retrieval

### 6.1 Query planner

The planner is deterministic and runs before candidate search:

1. normalize whitespace and Unicode;
2. extract quoted phrases, dates, and simple temporal expressions;
3. classify intent: `lookup`, `personal`, `task`, `files`, `timeline`, `identity`,
   or `general`;
4. apply tier, scope, and sensitivity filters from the request;
5. choose a token budget and candidate limit.

No model call is required. A future model-assisted rewrite may only add hints; it
cannot bypass filters.

### 6.2 Candidate sources

```text
CandidateSource
  - FTS5 BM25 search
  - pinned candidates
  - recent candidates
  - exact title / phrase candidates
  - optional vector candidates (#101)
```

The sources are merged by memory ID, then scored. Scope and sensitivity filters
run in SQL before any candidate reaches the ranker.

### 6.3 Scoring

Starting weights (tune with the golden fixture):

```text
score = 0.45 * relevance
      + 0.20 * importance
      + 0.12 * recency
      + 0.10 * confidence
      + 0.08 * source_trust
      + 0.05 * usage
```

Then:

- boost exact phrase and title matches;
- apply per-intent weight overrides;
- apply MMR diversity so one topic does not fill the context;
- drop candidates below the intent floor;
- cap by the token budget.

### 6.4 Context packer

Each item is packed with:

- memory ID, tier, kind, scope, and title;
- a short excerpt, not the full row by default;
- provenance and source labels;
- confidence, validity, and sensitivity markers;
- a stable citation token the response can reference.

The packer sets `truncated` when the budget excludes otherwise eligible items and
records the query plan and trace for debugging. The prompt wrapper states that
stored memory is untrusted data: it cannot change capabilities, policy, or scope.

### 6.5 Performance target

- p95 under 100 ms for 10k seeded memories at the default budget;
- no network calls in the retrieval path;
- deterministic results for the same database, query, and config.

## 7. Write lifecycle

```text
turn completes
    |
    v
TurnObservation (user text, assistant text, receipts, corrections)
    |
    v
candidate extraction (deterministic first; optional LLM curator)
    |
    v
C8 MemoryProposal (ADD / UPDATE / SUPERSEDE / MERGE / NOOP)
    |
    v
validator: provenance, scope, tier/kind, confidence, size, sensitivity,
           duplicate/contradiction, rate limit, idempotency
    |
    +--> auto-commit: explicit user fact or preference, normal sensitivity
    |
    +--> review queue: inferred identity, sensitive, contradiction, high impact
    |
    v
canonical commit (revisioned) -> audit event -> projection update
                                      |
                                      +--> failure -> repair queue
```

Invariants:

- Every durable memory keeps provenance and revision history.
- Updates never silently overwrite history: old rows close with `valid_to` and
  `superseded_by`.
- Dedupe uses `content_hash` plus a normalized key; near-duplicates may use FTS5
  and, later, local embeddings.
- A contradiction creates a review item instead of picking a winner.
- `NOOP` is a successful proposal outcome, not a write.
- Every commit, review, edit, forget, and repair emits a typed event.

What gets written by default:

| Candidate | Default action |
| --- | --- |
| Explicit user fact or preference | Auto-commit M3, normal sensitivity |
| Session summary | Commit M2 at session end or every N turns |
| Inferred identity trait | Review queue |
| Sensitive detail | Review queue; never auto-commit |
| Contradiction with a durable fact | Review queue |
| Procedure or reusable recipe | Proposal only; M4 review |
| Artifact or document | M5 metadata; file RAG in #101 |

## 8. Memory Liaison link

The Liaison is the memory sub-agent. Its identity is `memory:<run_id>` with
`role: memory`. It is visible in the roster from the first run, even when the
provider is `none`.

### 8.1 Lifecycle

```text
open(run_id, scope, budget)
  -> context(query, intent) -> MemoryContext
  -> [subtasks reuse the same context snapshot]
  -> observe(turn_ref, response, receipts) -> MemoryProposalBatch
  -> close()
```

### 8.2 Responsibilities

- open exactly one context snapshot per run;
- enforce the engine-supplied scope and token budget;
- return citations and used-token counts;
- send the completed turn and tool receipts to the Manager;
- report proposal IDs and review status, never commit;
- emit `memory.link` activity for the roster and widget.

### 8.3 Non-responsibilities

- No direct database access.
- No `memory_save`.
- No scope or capability changes.
- No silent delete or forget.
- No second chat surface.

### 8.4 Failure behavior

- Provider `none`: deterministic extraction and retrieval still work.
- Interrupted run: the Liaison waits with the run and resumes against the same
  snapshot.
- Model unavailable: fall back to deterministic rules; record the fallback.
- Index unavailable: read from canonical rows with the `LIKE` fallback and report
  degraded health.

## 9. Session memory, identity, and instructions

### 9.1 Session memory

Graph state adds:

```text
session_summary: str
open_loops: list[str]
pinned_refs: list[str]
summary_tokens: int
```

Compaction keeps the last N turns plus a rolling summary. At session end or every
N turns, the summary is proposed as M2. Candidate facts are proposed as M3, not
written automatically unless they are explicit user statements.

### 9.2 Identity profile

`identity_fields` stores:

- `field_key`, `value`, `origin` (`user_explicit` or `inferred`);
- `confidence`, `sensitivity`, `evidence_refs`;
- `approved_at`, `updated_at`.

Explicit fields are editable by the user and auto-committed when stated directly.
Inferred fields require review or remain advisory. Sensitive fields are gated in
both retrieval and UI. Injection is compact: only the fields needed for the current
intent, with provenance labels.

The assistant persona remains versioned configuration. It is not memory and is not
agent-editable.

### 9.3 Instruction files

A read-only loader reads existing `AGENTS.md` and `NEXUS.md` files:

- precedence: global, then workspace;
- size caps and a source label per file;
- no tool execution and no automatic write-back;
- content is pinned context, not a memory proposal;
- a missing file is not an error.

## 10. API, events, and contracts

The shell never touches SQLite. Read endpoints ship in #96; mutation endpoints ship
in #98. Full payloads and event names are in [contracts.md](contracts.md).

| Surface | Issue | Access |
| --- | --- | --- |
| `GET /api/v1/memory/stats` | #96 | read |
| `GET /api/v1/memory/search` | #96 | read |
| `GET /api/v1/memory/{memory_id}` | #96 | read |
| `GET /api/v1/memory/proposals` | #96 | read |
| `GET /api/v1/memory/identity` | #96 | read |
| `GET /api/v1/memory/health` | #96 | read |
| `PATCH /api/v1/memory/{memory_id}` | #98 | audited mutation |
| `POST /api/v1/memory/{memory_id}/forget` | #98 | audited user action |
| `POST /api/v1/memory/proposals/{id}/approve` | #98 | audited review |
| `POST /api/v1/memory/proposals/{id}/reject` | #98 | audited review |
| `PATCH /api/v1/memory/identity` | #98 | audited mutation |
| `POST /api/v1/memory/rebuild-index` | #98 | audited repair |
| `GET /api/v1/memory/export` | #99 | user export |
| `POST /api/v1/memory/import` | #99 | proposals only |

Events: `memory.link`, `memory.context_ready`, `memory.proposal`,
`memory.updated`, `memory.health`, and `memory.repair`.

All endpoints are local-only, authenticated like the existing engine API, and
scope-aware. Errors use the existing `CoreError` shape.

## 11. Memory widget

The widget is a registered internal app (`memory`, glyph `[m]`) with compact and
fullscreen modes. It has four honest states:

- fixture, while the live engine client is unavailable;
- live, with a connection indicator;
- degraded, when FTS5 or the repair queue is unhealthy;
- empty, when there is genuinely no memory yet.

It never invents memories or shows fake activity. It reuses `@/ui`, theme tokens,
ASCII text, and the shell frame. The orb remains the only chat surface.

Detailed layouts, source seam, and tests are in [ui.md](ui.md).

## 12. Advanced phase

#101 adds:

- artifact ingestion and structure-aware chunking;
- optional local embeddings (`none`, `ollama`, `fastembed`);
- a rebuildable vector projection and reciprocal-rank fusion;
- dedupe/merge, episodic-to-semantic promotion, conflict resolution, and
  retention duties;
- a scheduled memory duty visible in the roster;
- eval fixtures for multi-hop, temporal, preference, and file queries.

Graph and entity memory, temporal edges, multi-hop retrieval, and full privacy
propagation stay in #79 under M3.

## 13. Delivery plan

### Phase A - safe foundation and first useful read path (p0)

```text
#93 store
  -> #94 retrieval
      -> #95 Liaison
      -> #96 read API and events
          -> #97 widget browse/search/health
```

### Phase B - controlled writes and user control (p1)

```text
#93 + #94 + #95 + #96
  -> #98 write lifecycle and mutation API
  -> #100 session memory, identity, instructions
      -> #99 widget controls
```

#99 depends on #100 for the identity tab, so its review/edit/forget work can land
before the identity controls if needed.

### Phase C - advanced retrieval and upkeep (p2)

```text
#93 + #94 + #95 + #98 + #100 + #59
  -> #101 semantic file RAG + consolidation duties
```

### M2 exit criteria

- The Memory widget can browse, search, review, edit, pin, forget, and export.
- The Memory Liaison appears in the roster and injects scoped context.
- Every agent-originated write has provenance, a revision, and an audit entry.
- Search and vector projections rebuild from canonical rows.
- Provider `none` remains deterministic.
- #79 is the only remaining memory work, and it is explicitly M3.

## 14. Open decisions

These need a team call before the dependent issue closes:

1. **Workspace semantics.** Does a shell layout switch also switch memory context,
   or is `workspace_id` a separate project/activity scope? The plan assumes the
   shell workspace ID.
2. **Review thresholds.** Which inferred identity traits auto-commit versus require
   review? The default is "nothing inferred auto-commits."
3. **Retention.** Default retention for episodes, session summaries, and artifacts.
   The plan assumes configurable, user-visible, no silent expiry before review.
4. **Embedding default.** #101 defaults to `none`; confirm whether `fastembed` or
   `ollama` is the preferred optional local provider.
5. **Sensitive controls.** Does editing or forgetting a sensitive memory require a
   second confirmation or the OS-level approval panel?
6. **Per-intent budgets.** The default is 2048 tokens; per-intent values should be
   tuned against the golden fixture.

## 15. Testing and acceptance

| Area | Minimum test |
| --- | --- |
| Migration | Fresh and existing databases converge; rows keep scope defaults; rollback/forward replay is safe. |
| Storage | Canonical row survives projection failure; repair queue drains; foreign keys hold. |
| Retrieval | Golden queries for scope, phrases, dates, budget, recency/importance, and fallback; p95 target. |
| Ranker | Deterministic scores; MMR diversity; sensitivity filters cannot be bypassed. |
| Liaison | Lifecycle, scope enforcement, no-write boundary, interrupt/resume, provider `none`. |
| C8 validator | Provenance, duplicates, contradictions, sensitivity, rate limits, idempotency. |
| API | Contract tests on Python and TypeScript; stable errors; scope isolation. |
| Widget | Sizes, tabs, search/filter, empty/error/fixture/live, event updates, every control. |
| Privacy | Forget removes search visibility immediately; export includes provenance; delete leaves audit stubs. |
| Rebuild | FTS and vector rebuild produce equivalent results; index mode is reported. |

Run deterministic tests without a model provider. Use a fake structured model and
fake adapters for integration tests. Reserve real provider and desktop tests for a
small, controlled suite.

## 16. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Scope leakage | Scope fields are required, filters run in SQL, and contract tests assert isolation. |
| Stale or failed index | Canonical-first writes, repair queue, idempotent rebuild, health surface. |
| Memory poisoning | C8 validation, provenance requirements, review for inferred/sensitive content, no instruction authority. |
| Silent overwrite | Revision history, `valid_to`/`superseded_by`, contradictions go to review. |
| Write amplification | Explicit-fact auto-commit only, per-run rate limits, `NOOP` as a valid outcome. |
| User distrust | Audit timeline, evidence on proposals, explicit forget semantics, fixture badge. |
| Migration breakage | Additive migrations, `user_version`, fresh/existing convergence tests. |
| Model dependency | Deterministic retrieval, validation, extraction fallback, and provider-`none` tests. |

## 17. Non-goals for M2

- Replacing the existing graph or adding a second orchestrator.
- Hosted storage, remote embeddings, or cross-device sync.
- Automatic deletion of memories without a user action.
- Agent-editable persona or policy.
- Full graph/entity memory and temporal multi-hop retrieval; those are #79 in M3.

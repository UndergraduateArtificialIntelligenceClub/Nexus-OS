# Memory contracts

Status: **Proposed**. Types and endpoints here are the target for #93-#101. Until
the implementing issue lands, the current C8 shape in
[AI-Core / 02 - API and contracts](../AI-Core/02-api-and-contracts.md) remains
authoritative.

The canonical wire vocabulary is shared with
`apps/engine/backend/schemas/contracts.py` and
`apps/shell/frontend/src/types/agentEvents.ts`. Change both sides together.

---

## 1. Scope

```ts
type MemoryScope = {
  user_id: string           // "local" for the single-user desktop
  workspace_id: string | null
  session_id: string | null
}
```

Rules:

- `workspace_id: null` means user-global.
- `session_id: null` means durable across sessions.
- A request may narrow the scope, never widen it.
- The engine supplies the scope; the model and the Liaison cannot change it.
- The widget displays the scope; it does not choose it.

## 2. Tier and kind

```ts
type MemoryTier = "M0" | "M1" | "M2" | "M3" | "M4" | "M5"
type MemoryKind = "episode" | "fact" | "procedure" | "artifact"
```

| Tier | Allowed kinds | Durable? |
| --- | --- | --- |
| M0 | runtime only | No |
| M1 | runtime only | No |
| M2 | episode | Yes |
| M3 | fact | Yes |
| M4 | procedure | Yes |
| M5 | artifact | Yes |

C8 never carries M0 or M1. A validator rejects a tier/kind pair outside this
matrix.

## 3. Link types

### 3.1 `MemoryRequest`

```ts
type MemoryIntent =
  | "lookup"
  | "personal"
  | "task"
  | "files"
  | "timeline"
  | "identity"
  | "general"

type MemoryRequest = {
  request_id: string
  run_id: string
  scope: MemoryScope
  query: string
  intent: MemoryIntent
  tiers: MemoryTier[]
  token_budget: number
  max_items: number
  mode: "context" | "identity" | "files"
  include_sensitive: boolean
  created_at: string
}
```

`include_sensitive` is engine-controlled and defaults to `false`. The Liaison
cannot set it from agent text.

### 3.2 `MemoryContext`

The existing `MemoryContext` keeps `query_id`, `item_refs`, and `token_budget`.
M2 enriches the item shape and adds budget, plan, and trace fields with defaults.

```ts
type MemoryContextItem = {
  memory_id: string
  tier: MemoryTier
  kind: MemoryKind
  title: string | null
  excerpt: string
  relevance: number          // 0..1
  freshness: number          // 0..1
  confidence: number         // 0..1
  importance: number         // 0..1
  sensitivity: "normal" | "sensitive"
  provenance_ref: string
  source_refs: string[]
  valid_to: string | null
  revision: number
  citation: string           // stable token used by the response
}

type MemoryContext = {
  query_id: string
  context_id: string
  item_refs: MemoryContextItem[]
  token_budget: number
  used_tokens: number
  truncated: boolean
  index_mode: "fts5" | "like" | "hybrid"
  query_plan: {
    normalized_query: string
    phrases: string[]
    dates: string[]
    intent: MemoryIntent
    tiers: MemoryTier[]
    filters: Record<string, string | number | boolean | null>
  }
  trace: {
    candidates: number
    after_filters: number
    after_rank: number
    packed: number
    duration_ms: number
    notes: string[]
  }
}
```

`item_refs` remains the wire name for backward compatibility. #94's "items" means
the enriched `item_refs` collection, not a second parallel list.

### 3.3 `TurnObservation`

```ts
type TurnObservation = {
  observation_id: string
  run_id: string
  request_id: string
  scope: MemoryScope
  turn_ref: string
  user_text: string
  assistant_text: string
  tool_receipt_refs: string[]
  corrections: string[]
  pinned_refs: string[]
  created_at: string
}
```

The Liaison sends the completed turn after `respond_propose_memory`. Tool receipts
let the validator distinguish a user-stated fact from a model inference.

### 3.4 `MemoryProposalBatch`

```ts
type MemoryProposalBatch = {
  batch_id: string
  run_id: string
  observation_id: string
  proposals: MemoryProposal[]
  accepted_ids: string[]
  review_ids: string[]
  rejected: Array<{ proposal_id: string; code: string; reason: string }>
  created_at: string
}
```

## 4. C8 v2

M2 extends C8 behind a version bump. The v1 shape stays accepted during migration
and is normalized to v2.

```ts
type MemoryOperation =
  | "ADD"
  | "UPDATE"
  | "SUPERSEDE"
  | "MERGE"
  | "NOOP"

type MemoryOrigin =
  | "user_explicit"
  | "user_edit"
  | "agent_inferred"
  | "system_consolidation"
  | "import"

type MemoryProposal = {
  proposal_id: string
  source_request_id: string
  run_id: string
  scope: MemoryScope
  tier: "M2" | "M3" | "M4" | "M5"
  kind: MemoryKind
  operation: MemoryOperation
  content_ref: string
  content_hash: string
  provenance_refs: string[]
  confidence: number          // 0..1
  importance: number          // 0..1
  sensitivity: "normal" | "sensitive"
  origin: MemoryOrigin
  valid_from: string | null
  valid_to: string | null
  supersedes: string | null
  dedupe_key: string | null
  entities: Array<{ name: string; type: string; ref: string | null }>
  relations: Array<{ from: string; predicate: string; to: string; ref: string | null }>
  policy_version: string
  extractor_version: string
  idempotency_key: string
  review_reason: string | null
}
```

Rules:

- `FORGET` is not a C8 operation. It is a user action through the mutation API.
- `MERGE` must name the surviving memory and the merged sources.
- `SUPERSEDE` must name the old memory and set its `valid_to`.
- `NOOP` records that a candidate was considered and intentionally not written.
- `content_ref` points to a canonical content payload; the model never writes a
  raw memory row.
- `policy_version` and `extractor_version` make re-validation and re-extraction
  reproducible.

## 5. Read models

### 5.1 `MemoryStats`

```ts
type MemoryStats = {
  total: number
  by_tier: Record<MemoryTier, number>
  by_status: Record<"active" | "superseded" | "forgotten", number>
  pending_proposals: number
  indexed_count: number
  index_mode: "fts5" | "like" | "hybrid"
  repair_queue: number
  last_rebuild_at: string | null
}
```

### 5.2 `MemoryHit` and `MemoryDetail`

```ts
type MemoryHit = {
  memory_id: string
  title: string | null
  excerpt: string
  tier: MemoryTier
  kind: MemoryKind
  scope: MemoryScope
  confidence: number
  importance: number
  sensitivity: "normal" | "sensitive"
  status: "active" | "superseded" | "forgotten"
  valid_to: string | null
  source_refs: string[]
  updated_at: string
  score: number
}

type MemoryDetail = MemoryHit & {
  content: string
  provenance: Array<{ ref: string; kind: string; label: string; run_id: string | null }>
  revisions: Array<{ revision: number; created_at: string; reason: string }>
  audit_tail: MemoryEvent[]
  originating_run_id: string | null
}
```

`content` is returned only for a detail read or an explicit user edit. Search
results carry excerpts.

### 5.3 `MemoryProposalView`

```ts
type MemoryProposalView = {
  proposal: MemoryProposal
  status: "pending" | "accepted" | "rejected" | "superseded"
  evidence: Array<{ ref: string; excerpt: string; source: string }>
  diff: {
    before: string | null
    after: string | null
    changed_fields: string[]
  }
  review_reason: string | null
  created_at: string
  decided_at: string | null
}
```

### 5.4 Identity

```ts
type IdentityField = {
  field_key: string
  label: string
  value: string
  origin: "user_explicit" | "inferred"
  confidence: number
  sensitivity: "normal" | "sensitive"
  evidence_refs: string[]
  approved_at: string | null
  updated_at: string
}

type IdentityProfile = {
  fields: IdentityField[]
  version: number
  updated_at: string
}
```

Only `user_explicit` fields are editable. Inferred fields show evidence and may be
promoted to explicit by a user edit or approval.

### 5.5 Health

```ts
type MemoryHealth = {
  status: "ok" | "degraded" | "repairing"
  index_mode: "fts5" | "like" | "hybrid"
  indexed_count: number
  canonical_count: number
  stale_projections: number
  repair_queue: number
  pending_proposals: number
  expired_items: number
  sensitive_items: number
  last_rebuild_at: string | null
  checks: Array<{
    name: string
    status: "ok" | "warn" | "error"
    detail: string
  }>
}
```

## 6. API

All routes are under `/api/v1/memory`, bind to localhost, and use the existing
engine authentication. Reads ship in #96. Mutations ship in #98. Export/import
ship in #99.

### 6.1 Read endpoints

| Method | Path | Query / body | Response |
| --- | --- | --- | --- |
| `GET` | `/stats` | `scope?` | `MemoryStats` |
| `GET` | `/search` | `q`, `tiers?`, `workspace_id?`, `session_id?`, `limit?`, `cursor?`, `include_sensitive?` | `{ items: MemoryHit[], next: string \| null }` |
| `GET` | `/{memory_id}` | - | `MemoryDetail` |
| `GET` | `/proposals` | `status?`, `limit?`, `cursor?` | `{ items: MemoryProposalView[], next: string \| null }` |
| `GET` | `/identity` | - | `IdentityProfile` |
| `GET` | `/health` | - | `MemoryHealth` |

`include_sensitive` is accepted only from the local user surface, never from an
agent run.

### 6.2 Mutation endpoints

| Method | Path | Body | Effect |
| --- | --- | --- | --- |
| `PATCH` | `/{memory_id}` | `{ content?, title?, tags?, pin?, reason }` | Edit or pin; revision and audit. |
| `POST` | `/{memory_id}/forget` | `{ mode: "delete" \| "invalidate", reason }` | Immediate search removal; audit stub. |
| `POST` | `/proposals/{proposal_id}/approve` | `{ reason? }` | Validate and commit. |
| `POST` | `/proposals/{proposal_id}/reject` | `{ reason }` | Mark rejected; no write. |
| `PATCH` | `/identity` | `{ fields: Array<{ field_key, value }> }` | Explicit-only edit; audit. |
| `POST` | `/rebuild-index` | `{ mode: "fts" \| "vector" \| "all" }` | Idempotent rebuild. |

### 6.3 Export and import

| Method | Path | Effect |
| --- | --- | --- |
| `GET` | `/export?format=markdown\|json` | User export with provenance and scope. |
| `POST` | `/import` | Creates proposals; never direct writes. |

## 7. Events

All events use the existing `WsEnvelope`:

```ts
type WsEnvelope<T extends string, D> = {
  type: T
  session_id: string
  run_id: string | null
  ts: string
  data: D
}
```

| Event | Payload | Emitted by |
| --- | --- | --- |
| `memory.link` | `{ agent_id, state, activity, context_id?, used_tokens?, proposal_count? }` | Liaison |
| `memory.context_ready` | `{ run_id, context_id, item_count, used_tokens, truncated, index_mode }` | Manager |
| `memory.proposal` | `{ batch_id, proposals: Array<{ proposal_id, operation, tier, status }> }` | Manager |
| `memory.updated` | `{ memory_id, change, revision, scope }` | Manager |
| `memory.health` | `{ status, index_mode, repair_queue, stale_projections }` | Manager |
| `memory.repair` | `{ job_id, memory_id, status, attempts }` | Manager |

`memory.updated` changes: `created`, `updated`, `superseded`, `merged`,
`forgotten`, `pinned`, `unpinned`, `identity`.

## 8. Errors

Use the existing `CoreError` shape. Proposed memory-specific codes:

| Code | Meaning |
| --- | --- |
| `MEMORY_NOT_FOUND` | The memory ID does not exist in the caller's scope. |
| `MEMORY_SCOPE_DENIED` | The request tried to widen scope or read another scope. |
| `MEMORY_VALIDATION_FAILED` | C8 failed provenance, tier/kind, size, or confidence checks. |
| `MEMORY_REVIEW_REQUIRED` | The proposal needs a user decision before commit. |
| `MEMORY_CONFLICT` | A contradiction or duplicate needs review. |
| `MEMORY_RATE_LIMITED` | The per-run proposal limit was exceeded. |
| `MEMORY_IDEMPOTENCY_REPLAY` | The idempotency key was already applied; the stored result is returned. |
| `MEMORY_INDEX_DEGRADED` | Search is using the fallback or repair is in progress. |

A scope denial returns the same not-found shape as a missing row to avoid leaking
existence.

## 9. Revision, idempotency, and rebuild

- Every memory row has a monotonic `revision`.
- `UPDATE`, `SUPERSEDE`, `MERGE`, and user edits increment the revision.
- `(idempotency_key, proposal_id)` is unique; replay returns the original result.
- Projection rows store `memory_id` and `revision`; a mismatch means stale.
- `rebuild-index` is safe to run repeatedly and reports counts.
- A failed projection write never rolls back the canonical commit; it enqueues a
  repair job instead.

## 10. Lifecycle sequence

```text
1. ingest_build_context
   -> Liaison.open(run_id, scope, budget)
   -> Manager validates scope and returns MemoryContext
   -> graph injects wrapped excerpts and citations

2. workers execute
   -> no memory writes; receipts are collected

3. respond_propose_memory
   -> Liaison.observe(TurnObservation)
   -> deterministic extractor (optional LLM curator) produces candidates
   -> Manager validates candidates and creates C8 v2 proposals
   -> auto-commit or review
   -> Manager emits memory.updated / memory.proposal
   -> Liaison returns MemoryProposalBatch

4. run closes
   -> Liaison.close()
   -> roster returns to idle with "N proposals pending review" when applicable
```

## 11. Compatibility rules

- New fields are additive with defaults.
- The `MemoryContext.item_refs` wire name is preserved.
- C8 v1 is accepted during migration and normalized to v2.
- Python models and TypeScript mirrors change in the same PR.
- A missing or unavailable FTS5 module is a degraded mode, not a fatal error.
- A missing embedding provider is a degraded mode; FTS5 remains available.
- `memory_save` stays internal-only; no new agent tool may bypass C8.

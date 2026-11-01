# 04 - Implementation rules and roadmap

> **Status key:** the trust, local-first, typed-contract, persistence, and deterministic-first principles are **Established**. The implementation order and repository map are **Proposed**.

## Non-negotiable rules

1. **Agents propose; trusted code authorizes.** No agent, model response, tool description, or retrieved document can execute a native side effect directly.
2. **Deterministic first.** Resolve IDs, schemas, targets, permissions, risk, receipts, and retries in deterministic code. Use a model only where reasoning or language interpretation helps.
3. **One gateway for side effects.** A new adapter is useless until it is reachable only through the trusted execution gateway.
4. **Approve exact work.** Bind approval to tool version, arguments, target references, scope, session, and expiry. Any material change means a new proposal.
5. **Receipt before claim.** A response may say an external action completed only when a C7 receipt says so.
6. **Checkpoint before uncertainty.** Persist before dispatch, while awaiting approval, after an execution result, and before final synthesis.
7. **State stays small and serializable.** Put artifacts, secrets, and large text behind references; validate every state update.
8. **Memory writes are proposals.** Require provenance, value, sensitivity review, duplicate/conflict handling, and retention policy.
9. **No policy in prompts.** Prompts can explain policy but the executable policy is typed data/code owned by the runtime.
10. **One canonical vocabulary.** Do not rename a graph node, status, tool, or memory tier in code without updating [05 - Reference glossary](05-reference-glossary.md).
11. **Local-first by default.** A basic installation works with local persistence and a configurable model provider; hosted services are opt-in adapters.
12. **Audit enough to recover.** Record request, proposal, policy decision, approval outcome, execution request, receipt, and checkpoint links with safe diagnostics.

## Proposed repository map

The exact language used for the LangGraph host is an **Open decision**. The following layout keeps that choice isolated. The examples use Python-style filenames for the graph service; preserve the module boundaries if another language is selected.

~~~
nexus-ai-core/
  apps/desktop/
    ui/                         # React presentation, approval and progress views
    src-tauri/                  # Rust runtime, IPC, gateway, native adapters
  packages/contracts/
    request.ts                  # C1/C2 types and validation schema
    task.ts                     # C3/C9 types
    execution.ts                # C4-C7 types
    memory.ts                   # C8 and M0-M5 types
  services/orchestrator/
    graphs/main_graph.py        # Exact main graph and conditional edges
    graphs/worker_graph.py      # Bounded task worker
    agents/supervisor.py        # Planning/dependency subgraph
    agents/desktop.py           # Desktop reasoning subgraph
    agents/discovery.py         # Research/evidence subgraph
    agents/knowledge.py         # Memory/retrieval subgraph
    state/reducers.py           # Safe graph-state merge functions
    models/gateway.py           # Structured model provider adapter
  core/
    registry/tools.json         # Versioned tool metadata
    policy/evaluator.py         # Deterministic policy decision
    approvals/service.py        # C5 creation, expiry, invalidation
    memory/retrieval.py         # Hybrid ranked retrieval
    memory/validator.py         # C8 validation/deduplication
    storage/repositories.py     # SQLite repositories
    checkpoints/store.py        # Checkpoint adapter and resume lookup
  migrations/                   # SQLite schema migrations
  tests/
    contracts/ graphs/ agents/ execution/ memory/ integration/
~~~

**Ownership rule:** the UI imports generated contracts, never runtime internals; orchestration imports registry metadata and service interfaces, never Rust adapter handles; Rust adapters are reachable through the gateway only.

## Build in dependency order

### Phase 0 - Contracts and durable skeleton

Build: C1-C9 schemas, status vocabulary, SQLite migrations, repositories for sessions/requests/tasks, an artifact record, and basic audit events.

Done when:

- A React request can become a persisted request with a stable ID.
- Contracts reject malformed/unknown authority fields.
- A checkpoint reference can be stored and retrieved.
- Contract and migration tests pass without a model provider.

### Phase 1 - Trusted execution core

Build: tool registry, policy evaluator, approval service, Rust gateway, execution receipts, `system_diagnostics`, and `file_search`.

Done when:

- Unregistered tools and mismatched proposals are rejected.
- Approval expires and invalidates on argument or target changes.
- A gateway execution is idempotent and produces a C7 receipt.
- A crash after adapter invocation can be reconciled by idempotency key.

### Phase 2 - Direct path and main graph

Build: `ingest_build_context`, `choose_route`, `clarify`, `fast_direct_task`, `collect_merge`, `evaluate_progress`, `synthesize_outcome`, and `respond_propose_memory`. Add checkpoint/resume behavior.

Done when:

- “Open my browser” can use a deterministic recipe without model inference.
- Unknown or ambiguous targets stop for clarification.
- Every response is linked to its request and relevant receipt/evidence.
- Restarting at each checkpoint yields no duplicate side effect.

### Phase 3 - Supervision and initial agent subgraphs

Build: `supervisor_plan`, `validate_plan`, `dispatch_ready_tasks`, `bounded_replan`, the task worker, Desktop Agent, and minimum Discovery Agent evidence flow.

Done when:

- A multi-step request becomes bounded C3 packets with dependencies.
- Parallel workers merge through reducers, not shared mutable state.
- Replan count and task scope are enforced.
- Discovery output includes evidence/provenance and cannot invoke native adapters.

### Phase 4 - Memory, artifacts, and knowledge

Build: M0-M5 mapping, hybrid retrieval, `memory_lookup`, `memory_save`, `document_read`, `document_create`, artifact metadata, memory validation, deduplication, and index repair.

Done when:

- A prior architecture decision can be retrieved with provenance.
- A report becomes a registered artifact and can be proposed as M5.
- Duplicate/conflicting facts are surfaced instead of silently overwriting each other.
- Deleting/retiring memory propagates to search projections.

### Phase 5 - Reliability and product hardening

Build: cancellation, timeout behavior, model-provider fallbacks, observability UI, export/backup, diagnostics, policy administration, and end-to-end desktop tests.

Done when:

- A simulated crash during every execution phase has a documented recovery outcome.
- Model unavailability yields deterministic fallback, safe partial completion, or clear user action.
- Audit data can reconstruct “who proposed, approved, executed, and observed what.”

## Test matrix and acceptance invariants

| Area | Minimum test | Invariant |
|---|---|---|
| Contracts | Schema fuzz/negative cases | Invalid authority-bearing envelopes do not cross a boundary |
| Graph | Transition and checkpoint tests | Node routes use only declared statuses and bounded loops |
| Worker | Scoped packet tests | A worker cannot add capability, target, or step count |
| Policy/approval | Mutation and expiry tests | Approval matches the exact proposal fingerprint |
| Gateway | Idempotency/crash tests | Each side effect has a receipt or `unknown_outcome` |
| Memory | Retrieval/dedupe/conflict tests | Every durable memory keeps provenance and revision |
| Storage | Migration/foreign-key tests | Canonical records remain consistent with index projections |
| Agents | Structured-output and hostile-content tests | Agent text cannot invoke adapters or change policy |
| End to end | Desktop happy/failure paths | UI shows verified progress and safe partial outcomes |

Run deterministic unit and graph tests without a model provider. Use a fake structured model and fake adapters for integration tests; reserve real desktop/provider tests for a small, controlled suite.

## Engineering decision log to close early

| Decision | Why it matters | Safe default |
|---|---|---|
| LangGraph host language/process | Affects deployment and SDK usage, not contracts | Isolate in `services/orchestrator` |
| IPC framework | Defines UI/runtime transport | Narrow typed Rust command surface |
| Local embedding/index library | Controls retrieval performance and packaging | SQLite remains canonical; index is rebuildable |
| Model provider defaults | Controls privacy/cost/availability | Local provider first, hosted adapter opt-in |
| Approval policy UX | Shapes trust and interruption recovery | Show exact targets, impact, expiry, and cancel |
| Artifact root/backup policy | Controls retention and deletion | User-visible local root with metadata and export |

Do not postpone these decisions until agents exist. The execution gateway, contracts, and persistence model are the foundation every agent depends on.


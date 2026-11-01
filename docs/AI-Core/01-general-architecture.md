# 01 - General architecture

> **Status key:** **Established** facts come from the supplied brief. **Proposed** choices make the implementation actionable and should be confirmed before code is treated as production-ready.

## The mental model

NEXUS AI CORE is not one all-powerful assistant. It is a local-first coordinator that turns a user request into a bounded plan, asks specialized agents for reasoning or evidence, and sends only validated execution requests to trusted runtime code.

**Established:** React owns interaction and presentation; Rust owns desktop authority and trusted execution; LangGraph owns orchestration and graph state transitions. Agents propose actions, while a gateway validates and authorizes actual side effects.

The short version is:

~~~
React UI -> Rust runtime boundary -> LangGraph -> agents / workers -> tool proposal
         <- trusted execution gateway <- policy + approval <- Rust-owned adapters
~~~

See D1 in [the diagram PDF](NEXUS-AI-CORE-Architecture-Diagrams.pdf) for the complete boundary map.

## Layers and ownership

| Layer | Owner | Responsibility | Must not control | Logic |
|---|---|---|---|---|
| Presentation | React | Collect intent, show progress, render approval and results | Native side effects, policy decisions | Deterministic UI |
| Runtime host | Rust | Session boundary, IPC, native handles, adapter ownership | Agent reasoning or user-facing wording | Deterministic |
| Main orchestration | LangGraph | Route, checkpoint, dispatch, merge, recover | Direct OS/service calls | Mixed |
| Coordination | Supervisor | Decompose and schedule bounded tasks | Grant permissions or invent tools | Mixed |
| Domain agents | Desktop, Discovery, Knowledge | Produce typed plans, evidence, and proposals | Bypass worker or gateway | Mixed |
| Task worker | Worker graph | Bind task scope, resolve inputs, request execution, reconcile result | Expand its own scope or authority | Mostly deterministic |
| Capability system | Tool registry + policies | Describe available, allowed operations | Execute without gateway validation | Deterministic |
| Trusted execution | Rust gateway + adapters | Validate, approve, execute, observe, receipt | Plan user goals or rewrite policy | Deterministic |
| Memory and retrieval | Memory service | Retrieve, rank, propose durable knowledge | Become a source of execution authority | Mixed retrieval |
| Durable storage | SQLite, checkpoint store, filesystem, indexes | Keep records, artifacts, and recovery data | Interpret intent or authorize actions | Deterministic |
| Model inference | Inference gateway | Supply structured reasoning behind contracts | Make permission decisions | Generative |
| Observability | Audit + events | Trace decisions, receipts, checkpoints, errors | Alter outcomes | Deterministic |

## Authority is enforced, not implied

**Proposed enforcement model**

1. React calls a narrow Rust IPC surface with a `RequestEnvelope` (C1), never a native adapter.
2. Rust creates or validates the session, request identity, and capability context before the graph begins.
3. LangGraph and agents can emit `ToolProposal` objects (C4), but they do not receive adapter handles, OS tokens, or raw account credentials.
4. The task worker turns a valid proposal into an `ExecutionRequest` (C6) only after schema validation, target resolution, policy evaluation, and any required approval.
5. The Rust-owned trusted execution gateway is the sole path to an adapter. It binds approval to the exact proposal fingerprint, records a receipt, and returns an `ExecutionReceipt` (C7).
6. The graph trusts a receipt or an explicitly `unknown_outcome` status, not a model's claim that an action occurred.

This shape makes an LLM useful without letting it turn prose into authority. A compromised or confused agent can make a bad proposal; it cannot directly press the destructive button.

## Request lifecycle

1. The user acts in React. The UI sends a typed request through the Rust boundary.
2. The runtime creates a session/request record and invokes the LangGraph main graph at `ingest_build_context`.
3. The graph loads M0/M1 context and retrieves only relevant durable memories. It selects a route at `choose_route`.
4. A safe, recognized operation can use `fast_direct_task`. Everything else goes through `supervisor_plan`, `validate_plan`, and bounded task dispatch.
5. Workers call a domain subgraph or deterministic recipe. They return evidence, a result, or a `ToolProposal`.
6. A proposal is checked by policy and, when needed, shown in React as an approval bound to exact arguments and targets.
7. Only the gateway executes an approved request. The gateway emits a receipt, audit event, and observable result.
8. The graph merges results, evaluates progress, performs a bounded replan if justified, synthesizes the answer, and makes a memory proposal.
9. A memory validator decides whether a proposal becomes durable; it does not silently save every conversation fragment.

For the node-by-node flow, see [03 - How it works](03-how-it-works.md) and D2.

## Routing: direct is not unchecked

**Established:** the main graph includes both `fast_direct_task` and a supervised path.

**Proposed:** the direct path is limited to a registry-backed deterministic recipe whose intent, target, arguments, and risk class are unambiguous. “Open my browser” may qualify after the target is resolved. “Clean up my downloads” does not; it needs a plan and likely review.

Both paths converge on the same policy, approval, execution, receipt, and audit mechanisms. “Fast” only removes unnecessary planning; it never removes the trust boundary.

## Data ownership and persistence

| Data | Canonical owner | Durable location | Examples |
|---|---|---|---|
| UI-only state | React | In-memory UI state | Panel visibility, draft text |
| Native capability context | Rust runtime | Session/approval records, not graph state | Window handle reference, scoped grant |
| Graph state | LangGraph + checkpoint service | Checkpoint store | Route, task status, cursor |
| Work records | Core repositories | SQLite | Requests, tasks, agent runs |
| Side-effect evidence | Trusted gateway | SQLite + event records | Receipt, outcome, timestamps |
| Artifacts | Artifact service | Local filesystem + metadata row | Reports, documents |
| Searchable memory | Memory service | SQLite + local full-text/vector index | Episodes, facts, procedures |

Graph state contains identifiers and small structured values, never raw files, secrets, open handles, or unbounded model context.

## Error and recovery posture

Errors travel as typed results, not as informal model prose. A worker reports a retryable failure, terminal failure, or uncertain side effect. The main graph records a checkpoint before dispatch and after reconciliation. If execution may have happened but no receipt is yet visible, the gateway is queried by idempotency key before retrying anything.

**Established:** checkpointing, observability, audit, and recovery are architectural layers.

**Proposed:** an external side effect is retried only when it has been proven not to have occurred, or when its adapter is explicitly idempotent. Replaying graph computation is safe more often than replaying a desktop or filesystem operation.

## Local-first deployment profile

The initial deployment can run on one desktop:

- React UI and Rust runtime ship with the desktop application.
- The orchestration service and model adapter run locally or communicate through an explicitly configured local/hosted provider boundary.
- SQLite stores structured records; local filesystem storage holds artifacts; local full-text/vector indexes accelerate retrieval; the checkpoint store preserves graph progress.

**Open decision:** select the language/process boundary for LangGraph and the exact embedded vector-index implementation. Do not let that choice change the contract or authority model.


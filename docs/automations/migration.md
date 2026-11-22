# Automation Migration Inventory & Wave-1 Runbook

> **Issue Reference:** Closes #38 (`feat:automations`, Milestone 1 MVP Gaps)  
> **Status:** Wave-1 Complete  
> **Author:** Avneet Kaur (`avneet-kaur-07`)

---

## 1. Legal, Licensing, & Architectural Principles

### 1.1 License Notice & Clean-Room Provenance
* **Reference Repository:** `C:\Users\ragha\OneDrive\Documents\Raghav Personal\myProjects\Brahma-Ai-Evo`
* **Licensing Constraint:** The `Brahma-Ai-Evo` repository is **personal-use licensed**.
* **Clean-Room Requirement:** All automations, tools, and runtime mechanisms ported from Brahma are treated strictly as **functional specifications**. Code is never copied verbatim; implementations are authored cleanly from scratch using Nexus OS contracts (`schemas/contracts.py`), Pydantic v2 validation, and typed Python adapters.

### 1.2 Known Reference Defect
In the Brahma prototype, `actions/cmd_control.py` is referenced by the planner and task executor, but the file **does not physically exist** in the reference codebase. 
* **Nexus OS Architectural Decision:** Arbitrary terminal / shell command execution is intentionally **omitted and rejected**. In accordance with the AI-Core non-negotiable rules (*"Agents propose; trusted code authorizes"*), unrestricted shell execution violates the trust boundary. Any command execution must go through dedicated, typed, and permission-gated adapters or native Win32/Tauri commands.

### 1.3 The One Orchestrator Principle
All automations and tools ported to Nexus OS must strictly compose with the existing **LangGraph AI-Core** (`apps/engine/backend/agent/`):
* Tools are registered in `agent/tools/registry.py` under the `ToolEntry` schema.
* Execution is routed through the trusted `ExecutionGateway` (`agent/execution/gateway.py`) and governed by `PolicyEvaluator` (`agent/execution/policy.py`).
* Adapters are implemented in `agent/execution/adapters.py`.
* Automations **never** introduce competing background orchestrators, ad-hoc execution loops, or bespoke graph bypasses.

---

## 2. Complete Migration Inventory

Every tool, skill, and automation from the Brahma reference repository is cataloged below with its migration status, target in Nexus OS, policy risk classification, and rationale.

| Reference Tool / Skill | Status | Nexus OS Target | Risk Class | Rationale & Status Notes |
| :--- | :--- | :--- | :--- | :--- |
| `weather_report` | **Migrated (Wave 1)** | `tool:weather_report` | `read_only` | Lightweight JSON queries via `wttr.in`. Safe, deterministic, read-only. |
| `reminders` | **Migrated (Wave 1)** | `tool:reminder_create` | `reversible_write` | Creates timed reminders with title, due timestamp, and priority. Reversible write. |
| `calendar_scheduler` | **Migrated (Wave 1)** | `tool:calendar_schedule` | `reversible_write` | Schedules events, validates interval sanity (`end > start`). Reversible write. |
| `media_controls` | **Migrated (Wave 1)** | `tool:media_control` | `reversible_write` | Dispatches desktop media actions (play/pause/next/volume/mute). Reversible write. |
| `open_app` alias map | **Migrated (Wave 1)** | `resolve_app_alias` | `read_only` | Maps natural language app names ("browser", "calc", "editor") to canonical application targets. Feeds Desktop Bridge. |
| `web_search` (DDG) | **Migrated (Wave 1)** | `tool:web_search_ddg` | `read_only` | Fast DuckDuckGo fallback provider; bypasses bot-detection challenges encountered in live headless Chromium search. |
| `file_controller` | **Adapted (Wave 1)** | `tool:file_control` | `reversible_write` | File read/write/append/delete strictly bound to `approved_workspace` roots, returning undo stack receipts (`undo_receipt`). |
| `cmd_control` | **Skipped (Intentional)** | *None* | `destructive` | Defective in reference repo; violates Nexus OS execution security boundary. |
| `wake_word` | **Skipped (Deferred)** | *None* | `read_only` | Brahma used crude transcript matching; deferred to dedicated Voice issue (#46) for true DSP wake-word handling. |
| `screen_capture` / vision | **Skipped (Deferred)** | *None* | `read_only` | Deferred to Milestone 2 Vision track (#51, #52, #53). |
| `clipboard_sentry` | **Skipped (Deferred)** | *None* | `read_only` | Deferred to Milestone 3 Clipboard Processor (#74). |
| `gmail_integration` | **Skipped (Deferred)** | *None* | `sensitive` | Deferred to Milestone 3 Workspace Tools (#71). |
| `document_builder` | **Skipped (Deferred)** | *None* | `reversible_write` | Deferred to Milestone 3 Document Builders (#72). |

---

## 3. Wave-1 Specification & Design

### 3.1 Tool Identification & Policy Classification
All Wave-1 tools are registered in `apps/engine/backend/agent/tools/registry.py` and implemented in `apps/engine/backend/agent/execution/adapters.py`.

```
User Intent
    ↓
Supervisor / Agent Subgraph (proposes C4 ToolProposal)
    ↓
PolicyEvaluator (validates RiskClass, targets, and bounds)
    ↓
ExecutionGateway (checks idempotency, creates audit log)
    ↓
Adapters (executes python.<tool_id> or native desktop bridge)
    ↓
C7 ExecutionReceipt
```

### 3.2 The Shared Undo Stack Pattern (`file_control`)
For state-modifying operations (such as `file_control`), the adapter captures previous state in an `undo_receipt` payload:
* **Write / Append:** Captures prior file contents before overwriting.
* **Delete:** Stores the removed content so a subsequent undo operation can restore the file.
* **Boundary Guard:** All file mutations strictly enforce `_within_approved_roots` to prevent path traversal outside designated workspace directories.

### 3.3 Application Alias Map (`resolve_app_alias`)
Natural language intents rarely provide exact executable names. The `resolve_app_alias` helper translates user phrases into canonical identifiers:
* `"browser"`, `"chrome"`, `"web"` $\rightarrow$ `"browser"`
* `"editor"`, `"notes"`, `"text"` $\rightarrow$ `"notes"`
* `"calc"`, `"calculator"` $\rightarrow$ `"calc"`
* `"terminal"`, `"cmd"`, `"console"` $\rightarrow$ `"terminal"`
* `"files"`, `"explorer"` $\rightarrow$ `"files"`
* `"calendar"`, `"events"` $\rightarrow$ `"calendar"`
* `"settings"`, `"config"` $\rightarrow$ `"settings"`

---

## 4. Runbook: How to Migrate the Next Tool

When adding future automations (Wave 2 & Wave 3), follow this standard 4-step runbook:

### Step 1: Define Typed Pydantic Input Schemas
In `apps/engine/backend/agent/tools/registry.py`:
* Subclass `_Input` (`ConfigDict(extra="forbid")`).
* Add typed fields with constraints (e.g., `Field(min_length=1)` or regex `pattern`).
* Never accept unparsed prompt text or arbitrary dictionaries.

### Step 2: Register a `ToolEntry`
In `_ENTRIES` in `apps/engine/backend/agent/tools/registry.py`:
* Specify `tool_id`, `version="1"`, `capability_group`.
* Assign an explicit `RiskClass` (`read_only`, `reversible_write`, `sensitive`, `destructive`).
* Specify `side_effect: bool` (`True` if state changes; `False` if purely query).
* Define `allowed_targets` (e.g., `("approved_workspace",)` or `("local_engine",)`).
* Set `idempotency` policy (`not_required` or `key_required`).

### Step 3: Implement the Adapter Function
In `apps/engine/backend/agent/execution/adapters.py`:
* Implement an async function: `async def <tool_id>(args: dict[str, Any], ctx: AdapterContext) -> dict[str, Any]`.
* Validate boundary conditions (e.g., `_within_approved_roots` for filesystem, ISO timestamp sanity for calendars).
* Register the function in the `ADAPTERS` map: `"python.<tool_id>": <tool_id>`.

### Step 4: Add Comprehensive Tests
In `tests/systems/`:
* Create or update the unit test suite.
* Include **at least one happy path test** verifying returned structure.
* Include **at least one failure mode test** verifying rejected inputs or boundary violations.
* Ensure `test_registry_schema_integrity` passes cleanly.

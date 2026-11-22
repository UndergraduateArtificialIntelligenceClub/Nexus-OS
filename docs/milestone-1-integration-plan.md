# Nexus OS — Milestone 1 Integration & Feature Audit

> **Target:** Milestone 1 (M1 - MVP Gaps) Completion  
> **Source of Truth:** GitHub Issues #24–#41, `docs/ISSUES.md`, `docs/AI-Core/07-api-flow.md`, `docs/ui-library/plan.md`, `apps/shell/frontend/DESIGN.md`  
> **Date:** November 2026  
> **Status:** Active Execution Plan  

---

## 1. Executive Summary & Audit Overview

Nexus OS is designed as an intent-driven, multimodal desktop orchestration layer. Rather than operating as a conventional floating-window desktop or a sandboxed chatbot, it pairs a **6×4 fixed-cell widget grid ("The Quiet Terminal")** with an **autonomous LangGraph agent engine (AI-Core)** running as a local sidecar.

A systematic audit across `apps/shell/frontend` (React + TypeScript + Vite), `apps/engine/backend` (Python + FastAPI + LangGraph), `src-tauri` (Rust + Win32), and `modules/` reveals a clear operational state:

- **Frontend Shell Foundation:** Highly mature. The 6×4 grid layout engine (`layout.ts`), instance host with FLIP spring transitions (`InstanceHost.tsx`), ASCII motion frames (`AsciiFrame.tsx`), theme token system (`tokens.css`), UI component library (`apps/shell/frontend/src/ui/`), and desktop store (`desktopStore.tsx`) pass all **45 test suites with 399 unit and contract tests**.
- **Backend AI Engine & Retrieval:** Highly mature in isolation. The FastAPI `/api/v1` surface, LangGraph supervisor/worker graph, execution gateway with C5 policy enforcement, and headless Chromium retrieval pipeline (Playwright, Google search provider, HTML extraction) are fully authored and tested.
- **The Core Problem:** **Integration Decoupling.** Several core systems and apps have been developed independently behind clean seams (sources/adapters), but the wire connecting frontend and backend has not yet been plugged in. The shell currently relies on offline fixtures or local regex parsers, while the backend runs mock window tools or awaits HTTP/WebSocket clients.

### Audit Classification Matrix

| Category | Apps & Features Included | Description |
|---|---|---|
| **🟢 Properly Built & Fully Linked** | Clock, Calc, Calendar, Gallery, Workspace Persistence (Issue #28) | Works end-to-end; either purely deterministic client math or fully wired to backend persistence. |
| **🟡 Frontend Built, Backend Mocked / Local Only** | Notes (single-note local file), Settings (theme only), Terminal (mock text), System Monitor (null telemetry), Files (local host OS read-only) | UI exists and is polished, but backend logic is minimal, local-only, or returns static placeholders. |
| **🟠 Backend & Frontend Built, Disconnected** | **Agent Engine ⇄ Desktop Shell** (Issue #41), **Web Search ⇄ Browser App** (Issues #24, #25, #29), **Agents Manager ⇄ Live Event Bus** (Issue #55), **Media Inbox ⇄ Engine Widget Producers** (Issue #26) | Full backend and full frontend are independently complete and tested, but connected to mock/fixture seams instead of each other. |
| **🔵 Backend Present, No Frontend / Stubs** | Native Win32 Window Manager (Win32 enumeration in Rust/Python, but shell uses fixed grid), Execution Gateway Approvals (Interrupt panel exists in UI kit but unlinked to WS interrupts), Voice Pipeline (Issues #34–#37) | Backend capabilities or system APIs exist, but have no UI representation or interactive hook in the desktop shell. |

---

## 2. Comprehensive App-by-App Audit

Every internal application registered in `apps/shell/frontend/src/apps/registry.ts` was audited against its frontend view, storage/backend seam, and target Milestone 1 requirements.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          INTERNAL APPS STATUS OVERVIEW                      │
├──────────────────┬──────────────┬──────────────┬─────────────┬──────────────┤
│ App ID           │ Frontend UI  │ Backend      │ Integration │ M1 Target    │
├──────────────────┼──────────────┼──────────────┼─────────────┼──────────────┤
│ clock            │ Complete     │ Client Clock │ 🟢 Linked   │ Done         │
│ calc             │ Complete     │ Client Math  │ 🟢 Linked   │ Done         │
│ calendar         │ Complete     │ Client Date  │ 🟢 Linked   │ Done         │
│ gallery          │ Complete     │ DesktopStore │ 🟢 Linked   │ Done         │
│ notes            │ Complete     │ KeyValueStore│ 🟡 Local-FS │ Upgrade M1   │
│ files            │ Complete     │ Plugin-FS    │ 🟡 Local-FS │ Upgrade M1   │
│ settings         │ Complete     │ LocalStorage │ 🟡 Local-FS │ Upgrade M1   │
│ terminal         │ UI Template  │ None (Mock)  │ 🟡 Mocked   │ Phase 2 (M1) │
│ monitor (sysmon) │ Complete     │ None (Null)  │ 🟡 Disconn. │ Phase 3 (M1) │
│ browser          │ Complete     │ Playwright   │ 🟠 Disconn. │ Priority M1  │
│ agents (roster)  │ Complete     │ AgentRoster  │ 🟠 Disconn. │ Priority M1  │
│ video            │ Complete     │ MediaInbox   │ 🟠 Disconn. │ Priority M1  │
│ reader           │ Complete     │ MediaInbox   │ 🟠 Disconn. │ Priority M1  │
│ wm (windows)     │ Complete     │ DesktopStore │ 🟢/🔵 Split │ Done (Grid)  │
│ timer            │ Complete     │ Client State │ 🟢 Linked   │ Done         │
└──────────────────┴──────────────┴──────────────┴─────────────┴──────────────┘
```

### Detailed Breakdown

#### 1. Settings (`settings`)
- **Current Frontend:** Implemented in `internal-apps/settings/frontend/src/App.tsx` using `SettingsTemplate`. Provides a radio group for theme selection (`light`, `dark`, `system`), read-only desk statistics (`widgets open`, `grid: 6 × 4`), and keyboard shortcuts (`⌘K`, `⌘M`, `⌘↵`, `esc`, `⌘.`).
- **Current Backend:** Writes only the active theme string to `localStorage`.
- **Gaps:** None of the real OS, engine, or subsystem configuration parameters are exposed:
  - No connection to `modules/config/index.ts` (`ENGINE_HOST`, `ENGINE_PORT`, `ACTIVE_AI_PROVIDER`, `VISION_ENABLED`).
  - No connection to `EngineSettings` (`model_provider`, `model_name`, `model_base_url`, `artifact_root`, `approved_roots`, `auto_approve_reversible_write`, `auto_approve_network_tools`).
  - No retrieval settings (Google search API token `NEXUS_API_TOKEN`, fallback provider selection).
  - No voice settings (mic input device, STT provider, TTS speed).
  - No UI toggle for reduced motion (currently only reads system OS media query).
- **Milestone 1 Goal:** Upgrade `SettingsApp` to read and modify real configuration over a unified settings provider, exposing Engine Status, Active LLM/Provider, Retrieval Auth/Mode, and Desktop motion controls.

#### 2. Files (`files`)
- **Current Frontend:** Implemented in `internal-apps/files/frontend/src/App.tsx`. Includes directory navigation, breadcrumb path traversal, file type classification, and integrated viewers for Markdown, Code, Plain Text, Image, Video, Audio, and general binary metadata.
- **Current Backend:** Implements a dual `FileSource` seam (`source.ts`):
  - In Tauri: Calls `@tauri-apps/plugin-fs` to browse the host OS user's home directory (`~`).
  - In browser dev mode: Uses a static fixture tree (`__fixtures__`).
- **Gaps:**
  - Files is purely **read-only**. It cannot create, rename, edit, or delete files.
  - Files is isolated from the Python engine's knowledge artifacts directory (`EngineSettings.artifact_root`, `.nexus_artifacts`).
  - Cannot save notes directly to files, or open arbitrary workspace files into the editor (Issue #31).
  - No file search or indexing integration.
- **Milestone 1 Goal:** Link the Files app to the engine's artifact storage root alongside the home directory, and support direct file-handing to `notes` (text editing), `reader` (markdown viewing), and `video` (playback).

#### 3. Browser (`browser`)
- **Current Frontend:** Implemented in `internal-apps/browser/frontend/src/App.tsx`. Clean headless browser interface with search query box, domain-badged results list, structured article reading pane with evidence tags, inline media playback, and "open as widget" actions.
- **Current Backend:** `apps/engine/backend/search/` houses a complete, high-performance web retrieval service:
  - FastAPI endpoints: `POST /api/v1/web/search`, `POST /api/v1/web/browse`, `GET /api/v1/web/tools`.
  - Headless Chromium execution via `Playwright` with anti-bot handling and security boundary (`deny_proxy.py`).
  - Live Google search scraper (`google.py`) and mock provider (`mock.py`).
  - Trafilatura & LXML HTML content extraction (`extract.py`).
- **Gaps:** The frontend `BrowserApp` is hardcoded to `fixtureSource`! It never invokes the live FastAPI retrieval endpoints, passes no `NEXUS_API_TOKEN`, and does not handle live search network errors or provider rate-limiting.
- **Milestone 1 Goal (Issues #24, #25, #29):** Author `EngineBrowserSource` implementing `BrowserSource`, link it to `/api/v1/web/search` and `/api/v1/web/browse`, add DuckDuckGo fallback provider, and wire search tools into the agent supervisor.

#### 4. Agents Manager (`agents`)
- **Current Frontend:** Implemented in `internal-apps/agents-manager/frontend/src/App.tsx`. Read-only duty roster with agent status pills (`idle`, `acting`, `waiting`, `error`), elapsed running timers, status narratives, and multi-step `ActivityTimeline` progress.
- **Current Backend:** In `apps/engine/backend/api/agents.py`, `AgentRoster` tracks active workers and emits `agent.updated` events over the session WebSocket.
- **Gaps:** In `roster.ts`, `defaultRosterSource()` returns `fixtureRosterSource()`. The live event listener `liveRosterSource()` is implemented but disconnected because the shell has not wired the WebSocket event bus.
- **Milestone 1 Goal (Issue #27, #41):** Connect `liveRosterSource` to the shell's global engine event bus, receiving real `agent.updated`, `task.progress`, and `agent.state` events from the engine runtime.

#### 5. System Monitor (`monitor`)
- **Current Frontend:** Implemented in `internal-apps/system-monitor/frontend/src/App.tsx`. Uses `AsciiMeter` components to render horizontal bar gauges for CPU, Memory, and GPU usage across 1x1 and 2x1 grid cells. Follows the "never fake system state" rule: displays an honest empty state ("no telemetry yet — the system backend is not connected").
- **Current Backend:** Missing. `useReadings()` returns `null`. Neither Rust (`src-tauri`) nor Python (`apps/engine/backend`) exposes a telemetry polling command or diagnostic route.
- **Milestone 1 Goal:** Implement a native telemetry IPC command `system_diagnostics` in `src-tauri` (using `sysinfo` crate) or an engine endpoint `/api/v1/system/diagnostics` (using `psutil`), and hook it into `useReadings()`.

#### 6. Terminal (`terminal`)
- **Current Frontend:** Implemented in `internal-apps/terminal/frontend/src/App.tsx`. Renders static ASCII terminal output with hardcoded lines (`nexus$ agent status ...`).
- **Current Backend:** Completely absent. No pseudo-terminal (PTY) daemon, no subprocess execution pipeline, no IPC channel for streaming stdout/stderr.
- **Milestone 1 Goal:** Keep terminal as a controlled diagnostic console for Milestone 1: wire it to stream live engine execution logs and agent thought traces over WebSocket, rather than exposing an unsafe raw host shell before permission sandboxing is finalized.

#### 7. Notes (`notes`)
- **Current Frontend:** Implemented in `internal-apps/notes/frontend/src/App.tsx`. Real-time text editor with character counter, debounced auto-save (500ms), and visual save indicator (`saved`, `saving`, `error`).
- **Current Backend:** Uses `storage` seam (`KeyValueStorage`). In Tauri, saves to `AppData/storage/notes.txt`. In browser, saves to `localStorage` (`nexus.storage.notes`).
- **Gaps:** Only supports a single persistent buffer (key: `notes`). Does not support multiple files, folder organization, or naming.
- **Milestone 1 Goal (Issue #31):** Extend `storage` adapter to support named notes (`notes:list`, `notes:read(id)`, `notes:write(id)`), allowing Notes to function as a lightweight multi-note notebook.

#### 8. Video Player (`video`) & Article Reader (`reader`)
- **Current Frontend:** Fully implemented in `src/ui/media/VideoPlayer.tsx` and `src/ui/media/ArticleReader.tsx`. Both widgets listen to the `mediaInbox.ts` pub/sub hub (`useMedia('video')`, `useMedia('article')`).
- **Current Backend:** Currently fed only when the user clicks "open as widget" inside `BrowserApp`.
- **Gaps:** The agent engine cannot yet directly emit video or article widgets onto the desk via `run.response.widgets` (Issue #42).
- **Milestone 1 Goal (Issue #26):** Ensure `mediaInbox.ts` is accessible from both the Browser app and incoming engine `run.response.widgets` WebSocket payloads.

#### 9. Window Manager Widget (`wm`)
- **Current Frontend:** Implemented in `internal-apps/wm/frontend/src/App.tsx`. Renders a live list of open app instances on the 6×4 desk with controls to resize, fullscreen, minimize, close, tidy, or clear the desk.
- **Current Backend:** Connected directly to `DesktopStore`. Works seamlessly.
- **Relationship to Native OS Window Manager:** The shell deliberately hides external window chrome. The native Win32 window tools in Rust (`win32/window.rs`) and Python (`agent/tools/window_tools.py`) were part of an earlier proposal for managing host OS windows. For the M1 desktop shell, the 6×4 grid is the sole window manager.

#### 10. Clock, Calculator, Calendar, Gallery, Timer
- **Clock (`clock`):** Live analog and digital clock, locale-aware, fully functional.
- **Calculator (`calc`):** Live arithmetic keypad, expression evaluator, division-by-zero guard, fully functional.
- **Calendar (`calendar`):** Real-time calendar with day, mini-month, and navigable full-month views, fully functional.
- **Gallery (`gallery`):** Launcher grid that queries `APPS` registry and opens/focuses apps on the desk, fully functional.
- **Timer (`timer`):** Interactive stopwatch/countdown timer using `AsciiSlider`, fully functional.

---

## 3. Subsystem Audit & Integration Gaps

### 3.1 AI-Core Agent Engine ⇄ Desktop Shell (Issue #41 - Critical Blocker p0)

```
┌────────────────────────────────────────────────────────────────────────┐
│                        DESKTOP SHELL ⇄ ENGINE FLOW                     │
│                                                                        │
│   ┌──────────────────────────┐          ┌──────────────────────────┐   │
│   │   Spotlight / MenuBar    │          │    FastAPI AI-Core       │   │
│   │   User enters text/voice │          │    Engine (main.py)      │   │
│   └────────────┬─────────────┘          └─────────────▲────────────┘   │
│                │                                      │                │
│                │ POST /api/v1/agent/runs              │                │
│                ▼                                      │                │
│   ┌──────────────────────────┐          ┌─────────────┴────────────┐   │
│   │     engineClient.ts      ├─────────►│        RunManager        │   │
│   │  (REST + ReconnectingWS) │          │     (LangGraph Graph)    │   │
│   └────────────▲─────────────┘          └─────────────┬────────────┘   │
│                │                                      │                │
│                │ WS: agent.state, ui.command, etc.   │                │
│                │                                      ▼                │
│   ┌────────────┴─────────────┐          ┌──────────────────────────┐   │
│   │    AgentAvatar / Grid    │◄─────────┤        SessionHub        │   │
│   │  Applies layout actions  │          │   Broadcasts events/acks │   │
│   └──────────────────────────┘          └──────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

#### What exists:
1. **Engine Client:** `apps/shell/frontend/src/shell/agent/engineClient.ts` is fully implemented and passes all unit tests (`engineClient.test.ts`). It supports:
   - Starting runs (`POST /api/v1/agent/runs`).
   - Resuming interrupts (`POST /api/v1/agent/runs/{id}/resume`).
   - Cancelling runs (`POST /api/v1/agent/runs/{id}/cancel`).
   - WebSocket connection with auto-reconnect (`ws://127.0.0.1:8000/api/v1/ws?session_id=...`).
   - Auto-acknowledgement of `ui.command` events back to the server (`ui.command.ack`).
2. **Engine API Surface:** `apps/engine/backend/api/` has full REST and WebSocket support (`routes.py`, `hub.py`, `runs.py`, `ui_bridge.py`).

#### What is missing:
- **`engineClient` is NOT instantiated in the shell!**
- In `shell/Desktop.tsx`, `AgentProvider` is passed a local fallback runner:
  ```ts
  const run: AgentRun = (text, agent) =>
    runCommand(text, { desktop, theme, setTheme, moveAvatar, showDock })
  ```
  `runCommand` only calls `parseCommand(text)`, which matches basic regex keywords like `"open browser"` or `"dark mode"`. It never contacts the Python backend.
- `MenuBar.tsx` statically displays `"mic off"` and `"engine local"`.
- The avatar status does not reflect live LangGraph execution states (`listening`, `thinking`, `acting`, `waiting`, `speaking`, `error`).
- `ui.command` execution is not wired to `DesktopStore` methods.

---

### 3.2 Headless Web Search & Retrieval (Issues #24, #25, #29)

#### What exists:
1. Complete retrieval HTTP API in `apps/engine/backend/search/api.py`.
2. Playwright headless browser manager in `apps/engine/backend/search/browser.py`.
3. HTML content cleaner & parser in `apps/engine/backend/search/extract.py`.
4. Browser UI widget with article viewer, search result list, and video player in `apps/shell/frontend/src/internal-apps/browser/frontend/src/App.tsx`.

#### What is missing:
- `BrowserApp` is hardwired to `fixtureSource`.
- No HTTP client in the shell makes calls to `POST /api/v1/web/search` or `POST /api/v1/web/browse`.
- No token configuration for `NEXUS_API_TOKEN` bearer authentication.
- Backend lacks a fallback search provider (DuckDuckGo or SearXNG) when Google live search is disabled (Issue #24).
- The agent supervisor cannot call search tools directly because they are not yet registered in the AI-Core tool gateway (Issue #29).

---

### 3.3 Workspace Persistence & SQLite Storage (Issue #28 - Fully Operational)

#### What exists:
- Backend: SQLite `workspaces` table updated via `PUT /api/v1/workspaces/{id}` and read via `GET /api/v1/workspaces/{id}`.
- Frontend: `apps/shell/frontend/src/wm/workspacePersistence.ts` provides dual caching (immediate paint from `localStorage` key `nexus-desktop-v1`, debounced sync to SQLite, conflict resolution).
- Status: **Fully implemented, tested (20 Vitest unit tests + backend tests), and active.**

---

### 3.4 Execution Gateway & Human-in-the-Loop Interrupts (C5 Policy)

#### What exists:
- Backend: `gateway.py` pauses execution when an action requires user confirmation (`auto_approve_reversible_write = False`), creating a C5 approval with a TTL and emitting `run.interrupt`.
- Frontend: UI primitives `InterruptPanel.tsx` and `ConfirmPanel.tsx` exist in `src/ui/ai/` and `src/ui/overlays/`.

#### What is missing:
- When the engine sends `run.interrupt` over the WebSocket, the shell has no active listener to pop up `InterruptPanel`.
- No button action is hooked to call `engineClient.resumeRun(runId, { resume: "yes" | "no" })`.

---

### 3.5 Voice Pipeline (Issues #34–#37)

#### What exists:
- Architecture specification in `docs/AI-Core/07-api-flow.md`.
- UI slot in `MenuBar.tsx` (`"mic off"`).
- `source: "voice"` accepted by `POST /api/v1/agent/runs`.

#### What is missing:
- STT (Speech-to-Text): No Web Speech API or local Whisper integration in the webview.
- TTS (Text-to-Speech): No Piper or Edge-TTS audio stream player in the shell.
- Push-to-talk keybinding or microphone button handler.

---

## 4. Milestone 1 Integration Plan: Step-by-Step Implementation

To close Milestone 1 and achieve full end-to-end MVP functionality, work must be executed across **6 sequential phases**.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       MILESTONE 1 EXECUTION PHASES                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  Phase 1: Engine ⇄ Shell Live Wiring (Issue #41)                            │
│           Connect WebSocket, hook ui.command, sync avatar state             │
│                                  │                                          │
│                                  ▼                                          │
│  Phase 2: Live Search & Retrieval Integration (Issues #24, #25, #29)        │
│           EngineBrowserSource, DuckDuckGo fallback, agent search tools       │
│                                  │                                          │
│                                  ▼                                          │
│  Phase 3: Settings & System Diagnostics Upgrade                             │
│           Unified settings store, native telemetry IPC/route               │
│                                  │                                          │
│                                  ▼                                          │
│  Phase 4: Files & Notes Storage Realignment (Issue #31, #60)                │
│           Artifacts root integration, multi-note storage                    │
│                                  │                                          │
│                                  ▼                                          │
│  Phase 5: Voice Pipeline MVP Loop (Issues #34–#37)                          │
│           Browser STT capture, engine run submission, TTS audio playback    │
│                                  │                                          │
│                                  ▼                                          │
│  Phase 6: Multi-Widget Layout Sign-Off & Verification (Issue #32)           │
│           End-to-end regression testing, contract validation               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### Phase 1: Engine ⇄ Shell Live Wiring (Issue #41 - Critical Blocker p0)

**Goal:** Replace the isolated regex parser in `Desktop.tsx` with live bidirectional communication via `engineClient`.

1. **Instantiate `engineClient` at Shell Root:**
   - In `apps/shell/frontend/src/shell/Desktop.tsx`, create a singleton `EngineClient` using `createEngineClient({ baseUrl, sessionId })`.
   - Call `engine.connect()` on mount and handle disconnect/reconnect.
   - Update `MenuBar.tsx` to display `"engine online"` (green dot) when connected, falling back to `"engine offline (local)"` when unreachable.

2. **Wire Agent Avatar & Speech to WebSocket Events:**
   - Listen to `agent.state` events (`idle`, `listening`, `thinking`, `acting`, `waiting`, `speaking`, `error`) and update the `AgentStore` avatar state accordingly.
   - When `run.response` arrives, extract `data.speech` and call `agent.say(text)`.
   - When `run.interrupt` arrives, mount `InterruptPanel` beside the avatar with "Confirm / Cancel" or clarification options.

3. **Wire `ui.command` to `DesktopStore`:**
   - Implement `onUiCommand` in `Desktop.tsx` mapping engine actions to store methods:
     ```ts
     onUiCommand: async (cmd) => {
       switch (cmd.action) {
         case 'open_app': desktop.open(cmd.app_id as AppId, cmd.data?.size); break
         case 'close_app': desktop.close(cmd.app_id as AppId); break
         case 'minimize': desktop.minimize(cmd.app_id as AppId); break
         case 'maximize':
         case 'fullscreen': desktop.fullscreen(cmd.app_id as AppId); break
         case 'restore': desktop.restore(cmd.app_id as AppId); break
         case 'resize': desktop.resize(cmd.app_id as AppId, cmd.data?.size); break
         case 'set_avatar_position': agent.setAnchor(cmd.data?.anchor); break
         case 'tidy': desktop.tidy(); break
       }
       return { ok: true, wmState: desktop.snapshot() }
     }
     ```
   - Automatically push updated `wm.state` back across the WebSocket whenever the grid changes.

4. **Preserve Offline Graceful Fallback:**
   - In `runCommand.ts`, if `engine.isConnected()` is false, fall back to `parseCommand(text)` so the shell remains fully operable even if the Python engine is stopped.

---

### Phase 2: Live Search & Retrieval Integration (Issues #24, #25, #29)

**Goal:** Connect the Browser app to the live backend retrieval service and register search tools with the agent.

1. **Create `EngineBrowserSource`:**
   - In `apps/shell/frontend/src/internal-apps/browser/frontend/src/engineSource.ts`, implement `BrowserSource`:
     - `search(query)`: Sends `POST /api/v1/web/search` with `{ query, limit: 10 }` and Bearer token. Transforms response items into `SearchPayload`.
     - `open(url)`: Sends `POST /api/v1/web/browse` with `{ url }`. Transforms clean HTML extract into `ReadPayload` (structured headings, paragraphs, evidence refs).
   - In `BrowserApp.tsx`, toggle between `EngineBrowserSource` and `fixtureSource` based on engine connectivity.

2. **Add Fallback Search Provider in Engine (Issue #24):**
   - In `apps/engine/backend/search/providers/`, add `DuckDuckGoSearchProvider` using `ddg-api` or HTML scraping as a fallback when Google search credentials are not supplied.

3. **Expose Search Tools to Agent Supervisor (Issue #29):**
   - Register `web_search` and `fetch_page` in `agent/tools/registry.py` under the AI-Core execution gateway, enabling the agent to autonomously research queries and produce `run.response.widgets`.

---

### Phase 3: Settings & System Diagnostics Upgrade

**Goal:** Expand Settings into an honest control pane and feed real telemetry to System Monitor.

1. **Upgrade Settings Subsystem:**
   - Expand `internal-apps/settings/frontend/src/App.tsx` with dedicated sections:
     - **Appearance:** Theme toggle (`light` / `ink` / `system`), Reduced Motion manual switch.
     - **AI Engine:** Connection status (`connected` / `offline`), Endpoint URL, Active Provider (Local Ollama vs OpenAI-compatible), Active Model name.
     - **Web Retrieval:** Search Provider selection (Google Live vs DuckDuckGo vs Mock), API Token input.
     - **Desk & Storage:** Open widget instances count, local storage usage, database synchronization status.

2. **Implement Real System Telemetry:**
   - Option A (Native Rust): Add `system_diagnostics` command in `src-tauri` reading CPU and memory percentages via standard OS APIs.
   - Option B (Engine FastAPI): Add `GET /api/v1/system/diagnostics` using `psutil`.
   - Update `useReadings()` in `internal-apps/system-monitor/frontend/src/App.tsx` to poll diagnostics every 2 seconds when not minimized.

---

### Phase 4: Files & Notes Storage Realignment (Issues #31, #60)

**Goal:** Transform Notes and Files into interconnected workspace tools.

1. **Link Files to Engine Artifacts:**
   - Update `tauriSource()` in `files/source.ts` to expose two root locations in the breadcrumb bar:
     - `~ (Home)`: User's host filesystem.
     - `⬡ (Nexus Artifacts)`: Engine's generated reports, summaries, and agent outputs (`.nexus_artifacts`).

2. **Upgrade Notes Storage:**
   - Enhance `apps/shell/frontend/src/storage/index.ts` to support key enumeration (`list(prefix)`).
   - Allow Notes to maintain multiple named documents (`notes/scratchpad`, `notes/meeting`, etc.) switchable from a compact title header.

---

### Phase 5: Voice Pipeline MVP Loop (Issues #34–#37)

**Goal:** Achieve an end-to-end voice loop: Speak intent → STT → Engine Run → TTS response.

1. **Voice Architecture Decision (Issue #34):**
   - STT: Browser Web Speech API (`webkitSpeechRecognition`) for zero-latency local speech-to-text without heavy native dependencies.
   - TTS: Browser Web Speech API (`speechSynthesis`) or backend Piper TTS endpoint (`POST /api/v1/voice/tts`).

2. **Microphone Capture & Push-to-Talk (Issue #35):**
   - Add microphone toggle button to `MenuBar.tsx` and bind push-to-talk key (e.g. hold `Space` in Spotlight or press dedicated shortcut).
   - Feed recognized transcript directly to `engineClient.startRun(transcript, 'voice')`.

3. **Text-to-Speech Output (Issue #36):**
   - When `run.response` emits `speech`, speak the response aloud using the active voice synthesizer.

4. **Voice End-to-End Test (Issue #37):**
   - Verify verbal prompt: *"Open browser and search for local weather"* → Browser widget opens on the grid and displays results.

---

### Phase 6: Multi-Widget Layout Sign-Off & Verification (Issue #32)

**Goal:** Ensure grid stability, responsive packing, and zero-regression compliance across all widget sizes.

1. **Verify Grid Invariants:**
   - Maintain the strict 6×4 cell budget.
   - Validate packing order: 4×2, 2×2, 2×1, 1×2, 1×1.
   - Ensure widgets never overlap or push off-screen.

2. **End-to-End Test Suite:**
   - Run Vitest suite (`npm --prefix apps/shell/frontend test`) verifying all 399 unit tests pass.
   - Run backend system test suite (`pytest tests/systems`) verifying API contracts and WebSocket flow.

---

## 5. Milestone 1 Acceptance Criteria & Sign-Off Checklist

Before declaring Milestone 1 complete and initiating Milestone 2 (Gestures, Vision, Agents Manager Level 2), all items below must be verified:

- [ ] **Engine ⇄ Shell Live Connection (Issue #41):**
  - Shell connects to `ws://127.0.0.1:8000/api/v1/ws` on startup.
  - MenuBar displays live connection status (`engine online`).
  - Spoken or typed requests in Spotlight initiate runs via `POST /api/v1/agent/runs`.
  - Avatar reacts to agent states (`thinking`, `acting`, `speaking`).
  - Native `ui.command` actions (`open_app`, `close_app`, `tidy`, `fullscreen`) manipulate the desktop grid and acknowledge receipt.
- [ ] **Web Search & Retrieval Live (Issues #24, #25, #29):**
  - Browser app queries live `/api/v1/web/search` and renders real web results.
  - Browser app fetches readable article content via `/api/v1/web/browse`.
  - DuckDuckGo fallback provider operates when Google search is unconfigured.
  - Agent supervisor can invoke web search tools.
- [ ] **Honest System Monitor & Settings:**
  - System Monitor displays real CPU and memory usage from live telemetry.
  - Settings allows switching themes, toggling reduced motion, and inspecting engine configuration.
- [ ] **Multi-Widget Stability (Issue #32):**
  - All 15 registered apps render correctly at their designated default sizes.
  - Fullscreen transitions and dock minimize/restore work without unmounting instances.
  - Workspace layout persists across page reloads and Tauri desktop restarts (Issue #28).

# NEXUS OS: AI-Native Intelligent Desktop Environment

> **An intent-driven desktop orchestration layer bridging human-computer interaction, multimodal spatial tracking, and agentic desktop control.**

```text
 ╔═════════════════════════════════════════════════════════════════════════════╗
 ║                                                                             ║
 ║     _   _  ______  __   __ _   _  _____     ____    _____                   ║
 ║    | \ | ||  ____|\ \ / /| | | |/ ____|   / __ \  / ____|                  ║
 ║    |  \| || |__    \ V / | | | || (___   | |  | || (___                    ║
 ║    | . ` ||  __|    > <  | | | | \___ \  | |  | | \___ \                   ║
 ║    | |\  || |____  / . \ | |_| | ____) | | |__| | ____) |                  ║
 ║    |_| \_||______|/_/ \_\ \___/ |_____/   \____/ |_____/                   ║
 ║                                                                             ║
 ║           An Intelligent Context-Aware Multimodal Desktop Shell             ║
 ║                                                                             ║
 ╚═════════════════════════════════════════════════════════════════════════════╝
```

---

## Executive Overview

Modern desktop interaction remains rigidly application-centric. Users spend disproportionate cognitive bandwidth manually arranging windows, toggling workspaces, launching processes, and switching between siloed tools. Meanwhile, traditional AI assistants run inside sandboxed chat widgets, blind to open windows, monitors, or active system tasks.

**NEXUS OS** resolves this divide. It introduces an intelligent orchestration shell running on top of existing operating systems. Rather than replacing the OS kernel or compositor, NEXUS acts as an intelligent intermediary. It continuously observes desktop topology, intercepts user intent via natural language and hand gestures, and translates those intents into structured tool invocations across internal shell applications and real operating system windows.

---

## Architectural Philosophy

NEXUS OS adheres to three fundamental engineering principles:

- **Unification over Duplication:** Internal shell widgets and external Win32 applications share a single unified `WindowState` abstraction.
- **Constrained Determinism:** Language models do not manipulate screen coordinates through brittle vision clicks; they plan and emit strictly validated schema calls executed by systems-level APIs.
- **Decoupled Engine Responsibilities:** UI rendering, low-level Win32 orchestration, and agentic inference are isolated across separate runtimes connected via type-safe IPC and local HTTP transport.

```text
               ┌──────────────────────────────────────────────┐
               │         User Input Channels                  │
               │   [ Natural Language | Gestures | Keyboard ] │
               └──────────────────────┬───────────────────────┘
                                      │
                                      ▼
               ┌──────────────────────────────────────────────┐
               │          REACT DESKTOP SHELL (Tauri)         │
               │   - Dynamic Desktop Canvas & Launcher        │
               │   - Internal App Ecosystem (Notes, Files)    │
               │   - MediaPipe Tasks Vision Gesture Engine    │
               │   - Workspace Topology & Snapping Manager    │
               └──────────────┬───────────────────────────────┘
                              │
                    Tauri IPC │ (JSON-RPC)
                              ▼
               ┌──────────────────────────────────────────────┐
               │             RUST TAURI BACKEND               │
               │   - Win32 API Window Enumeration & Hooks     │
               │   - Native Geometry, Focus & Process Control │
               │   - Event Debouncing & State Cache Stream    │
               └──────────────┬───────────────────────────────┘
                              │
                   Local HTTP │ (Port 8000)
                              ▼
               ┌──────────────────────────────────────────────┐
               │           FASTAPI PYTHON AGENT BRAIN         │
               │   - ReAct Agent Loop & Tool Calling Dispatch │
               │   - Context Grounding & Memory Engine        │
               │   - Hybrid Inference Router (Hosted / Ollama)│
               │   - SQLite Layer (Workspaces, Schemas)       │
               └──────────────────────────────────────────────┘
```

---

## System Architecture

NEXUS divides responsibilities across four distinct layers to prevent single-runtime bottlenecks:

### 1. Presentation Shell: React + TypeScript
* **Role:** High-performance user interface hosted inside a Tauri webview.
* **Responsibilities:** Manages the taskbar, widget canvas, z-indexing, window-snapping previews, internal virtual application runtimes, and local camera streams.

### 2. Native Systems Core: Rust + `windows-rs`
* **Role:** Low-latency systems integration layer.
* **Responsibilities:** Subscribes to Win32 shell hooks (`SetWinEventHook`) to track active processes, monitor changes, and window focus without polling loops. Manipulates process coordinates via `SetWindowPos`, `ShowWindow`, and `BringWindowToTop`.

### 3. Agent Intelligence Engine: Python + FastAPI
* **Role:** Headless intelligence sidecar process managed by Tauri.
* **Responsibilities:** Ingests real-time desktop state snapshots, grounds user prompts, executes tool routing loops, maintains short/long-term memory, and coordinates information retrieval.

### 4. Storage & Persistence: SQLite
* **Role:** Embedded relational database.
* **Responsibilities:** Stores layout configurations, user preferences, past workspace topologies, and context vectors for agent recall.

---

## Key Capabilities

### Unified Window Abstraction
Whether targeting an internal React widget or a real external process (e.g., Google Chrome, Visual Studio Code), the agent interacts with an identical data contract:

```typescript
interface WindowState {
  id: string;
  appId: string;
  title: string;
  mode: 'minimized' | 'windowed' | 'fullscreen';
  x: number;
  y: number;
  width: number;
  height: number;
  workspaceId: string;
  monitor: number;
  focused: boolean;
  zIndex: number;
  isExternal: boolean;
  externalHandle?: string; // HWND handle for Win32 targets
}
```

The underlying action layer evaluates `isExternal`. If `false`, it adjusts CSS transforms on the React canvas. If `true`, it delegates down to the Rust layer via Tauri IPC to reposition the Win32 window.

### Constrained Agent Tool Architecture
Instead of relying on visual screen-clicking agents that are prone to hallucinating coordinates, NEXUS OS grounds all language model interactions within an explicit tool-calling schema:

```text
User Request: "Put Chrome on the right and VS Code on the left."
      │
      ▼
Agent Context: {
  "active_monitors": [{"id": 0, "resolution": "1920x1080"}],
  "windows": [
    {"id": "win_c1", "title": "Google Chrome", "isExternal": true},
    {"id": "win_v2", "title": "Visual Studio Code", "isExternal": true}
  ]
}
      │
      ▼
Action Sequence Dispatched:
  1. move_window(id="win_c1", x=960, y=0, width=960, height=1080)
  2. move_window(id="win_v2", x=0, y=0, width=960, height=1080)
```

#### Core Agent Tools Matrix

| Tool Identifier | Scope | Primary Arguments | Operation Performed |
| :--- | :--- | :--- | :--- |
| `get_desktop_state` | Read | `monitor?: number` | Returns JSON of all monitored windows and spatial layout |
| `open_app` | Execute | `app_name: string` | Spawns internal widget or executes native binary path |
| `close_app` | Execute | `window_id: string` | Gracefully closes target window handle |
| `move_window` | Mutate | `window_id: string, x: number, y: number` | Repositions window to explicit monitor-relative coordinates |
| `resize_window` | Mutate | `window_id: string, width: number, height: number` | Resizes viewport dimensions |
| `set_window_mode` | Mutate | `window_id: string, mode: WindowMode` | Toggles minimized, windowed, or fullscreen states |
| `switch_workspace` | Mutate | `workspace_id: string` | Cycles active virtual workspace context |
| `search_web` | Network | `query: string, max_results?: number` | Retrieves external search data without launching browser |
| `fetch_article` | Network | `url: string` | Extracts clean markdown content from targeted URLs |
| `persist_workspace`| Storage| `name: string, layout: object` | Saves active desktop topology to SQLite |

### Real-Time Spatial Hand Tracking
NEXUS OS embeds **Google MediaPipe Tasks Vision** directly within the webview pipeline to interpret camera inputs at 60 FPS without passing heavy video streams across IPC boundaries:

- **Open Palm:** Wakes the spatial interaction listener.
- **Pinch (Index + Thumb):** Grabs the focused window or targeted widget.
- **Pinch Movement:** Moves the active window smoothly across the screen.
- **Swipe (Left / Right):** Switches between active virtual workspaces.
- **Closed Fist:** Instantly cancels current gesture locks and resets interaction state.

### Faceless Search & Media Discovery
Rather than cluttering system memory by opening heavy browser windows for routine queries, NEXUS features an integrated information retrieval surface. Querying research papers, documentation, or news triggers FastAPI background workers that retrieve structured summaries, media assets, and citations directly into internal shell views.

### Hybrid AI Runtime
NEXUS supports zero-latency privacy and heavy cloud reasoning through an interchangeable engine interface:

```text
                  ┌───────────────────────────────┐
                  │    Unified Tool Definitions   │
                  └──────────────┬────────────────┘
                                 │
             ┌───────────────────┴───────────────────┐
             ▼                                       ▼
  ┌───────────────────────┐             ┌────────────────────────┐
  │   Hosted Inference    │             │    Local Inference     │
  │   - Claude / OpenAI   │             │   - Ollama / vLLM      │
  │   - Deep reasoning    │             │   - 100% offline       │
  │   - Multi-step tasks  │             │   - Zero cloud egress  │
  └───────────────────────┘             └────────────────────────┘
```

---

## Technology Stack

```text
┌─────────────────┬────────────────────────────────────────────────────────────┐
│ Layer           │ Technology / Library                                       │
├─────────────────┼────────────────────────────────────────────────────────────┤
│ Application Host│ Tauri v2 (Rust desktop harness, secure webview packaging)  │
│ Presentation    │ React 19, TypeScript, Tailwind CSS, Lucide Icons           │
│ Systems & OS    │ Rust, windows-rs (Win32 User32 / Shell32 APIs)             │
│ Agent Runtime   │ Python 3.11+, FastAPI, Pydantic v2, Uvicorn                │
│ Inference       │ Ollama (Llama 3 / Mistral / Qwen 2.5), Anthropic / OpenAI  │
│ Vision Pipeline │ MediaPipe Tasks Vision (WebAssembly / WebGL)               │
│ Storage Engine  │ SQLite 3, SQLAlchemy / SQLx                                │
│ Packaging       │ PyInstaller (sidecar bundle), Cargo Build                  │
└─────────────────┴────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```text
nexus-os/
├── .github/
│   └── workflows/
│       ├── lint-and-test.yml         # CI pipeline for Rust, Python, and UI
│       └── build-release.yml         # Automated Tauri release compilation
├── apps/
│   ├── shell/                        # React Desktop Frontend
│   │   ├── src/
│   │   │   ├── components/           # Window frames, taskbar, workspaces
│   │   │   ├── hooks/                # Gesture, IPC, and state hooks
│   │   │   ├── internal-apps/        # Notes, Files, Terminal, System Monitor
│   │   │   ├── vision/               # MediaPipe landmark detection
│   │   │   ├── types/                # WindowState, IPC message schemas
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   └── engine/                       # Python FastAPI AI Brain
│       ├── agent/
│       │   ├── tools/                # Native window and web discovery tools
│       │   ├── memory/               # Short-term buffers and SQLite hooks
│       │   ├── providers/            # Ollama and hosted LLM adapters
│       │   └── loop.py               # ReAct execution loop
│       ├── schemas/                  # Pydantic input/output schemas
│       ├── database/                 # SQLite migrations and session management
│       ├── main.py                   # FastAPI server entry point
│       └── requirements.txt
│
├── src-tauri/                        # Rust Desktop Core
│   ├── src/
│   │   ├── win32/                    # Native Windows API hooks & calls
│   │   ├── commands/                 # Tauri commands exposed to frontend
│   │   ├── sidecar.rs                # FastAPI lifecycle management
│   │   ├── state.rs                  # Live cached desktop topology
│   │   └── main.rs                   # Systems entry point
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── tests/
│   ├── bench/                        # LLM Tool-calling benchmark suites
│   ├── systems/                      # Win32 window hooking unit tests
│   └── vision/                       # Gesture classification evaluations
├── scripts/
│   ├── dev-setup.sh                  # Development environment bootstrap
│   └── build-sidecar.py              # PyInstaller compilation script
├── docs/                             # Architecture diagrams and specifications
├── LICENSE                           # MIT License
└── README.md
```

---

## Getting Started

### Prerequisites

Ensure the following runtimes and toolchains are installed on your workstation:

1. **Operating System:** Windows 10/11 (x86_64) *(macOS and Linux support under development)*
2. **Node.js:** v18.0.0 or higher ([Download Node.js](https://nodejs.org/))
3. **Rust:** Latest stable toolchain ([Install Rust](https://rustup.rs/))
4. **Python:** Version 3.11 or higher ([Download Python](https://www.python.org/))
5. **C++ Build Tools:** Visual Studio Build Tools with the *Desktop development with C++* workload
6. **Local LLM Engine (Optional):** [Ollama](https://ollama.ai/) running `llama3.1:8b` or `qwen2.5-coder`

### Installation & Workspace Setup

Clone the repository and enter the workspace directory:

```powershell
git clone [https://github.com/raghavsethi/nexus-os.git](https://github.com/raghavsethi/nexus-os.git)
cd nexus-os
```

#### 1. Setup Python Agent Engine
Create an isolated virtual environment and install the required dependencies:

```powershell
cd apps/engine
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r requirements.txt
cd ../..
```

#### 2. Configure Environment Variables
Copy the template configuration files and configure your parameters:

```powershell
cp .env.example .env
```

```ini
# --- Engine Configuration ---
ENGINE_HOST=127.0.0.1
ENGINE_PORT=8000
DATABASE_URL=sqlite:///./nexus_state.db

# --- AI Provider Configuration ---
# Options: 'local' (Ollama) | 'hosted' (OpenAI / Anthropic)
ACTIVE_AI_PROVIDER=local

# Ollama Endpoint (for local mode)
OLLAMA_BASE_URL=http://127.0.0.1:11434
LOCAL_MODEL_NAME=llama3.1:8b

# Hosted API Credentials (for hosted mode)
OPENAI_API_KEY=your_openai_key_here
ANTHROPIC_API_KEY=your_anthropic_key_here
```

#### 3. Install Frontend Dependencies
Install web dependencies using your package manager:

```powershell
cd apps/shell
npm install
cd ../..
```

#### 4. Run in Development Mode
Launch the system using the Tauri development runner. This automatically spawns the React UI development server, hooks the Rust layer, and starts the Python backend sidecar:

```powershell
npm run tauri dev
```

---

## Configuration & Usage Scenarios

### Workflow 1: Natural Language Desktop Orchestration
Instruct the agent to organize your workspace using the global shortcut (`Ctrl + Space`):

```text
User: "I'm starting a research session. Open Chrome and my Notes, put Chrome on the right, Notes on the left, and minimize everything else."
```

```text
NEXUS Engine Actions:
- Enumerated active windows via Win32 API.
- Executed minimize on all background windows.
- Launched internal Notes application instance.
- Repositioned Windows Chrome (HWND: 0x002404A) to (X: 960, Y: 0, W: 960, H: 1080).
- Repositioned Notes widget to (X: 0, Y: 0, W: 960, H: 1080).
- Saved topology footprint to SQLite session cache.
```

### Workflow 2: Spatial Gesture Manipulation
Enable the webcam feed from the system tray:
1. Raise an open palm to activate gesture listening mode.
2. Pinch index and thumb over an active window to lock focus.
3. Drag your hand across the camera field of view to reposition the window across display boundaries.
4. Close your fist to release and lock coordinates.

---

## Roadmap & Milestones

```text
[Phase 0] Architecture Foundation ────► [Phase 1] Virtual Desktop Shell
                  │                                     │
                  ▼                                     ▼
[Phase 3] Search & Discovery Engine ◄──── [Phase 2] Tool-Calling Agent Loop
                  │
                  ▼
[Phase 4] MediaPipe Vision Gestures ────► [Phase 5] Win32 Native Integration (v1.0)
                                                        │
                                                        ▼
                                          [Phase 6] Cross-Platform (macOS / Linux)
```

- [x] **Phase 0: Core Scaffolding:** IPC pipes, Rust-FastAPI sidecar coordination, SQLite schemas.
- [x] **Phase 1: Shell Implementation:** Virtual desktop canvas, window snapping, layout persistence.
- [x] **Phase 2: Agent Tool Engine:** Structured ReAct loop, context grounding, provider switching.
- [ ] **Phase 3: Deep Information Retrieval:** Headless web extraction, citation parsing, native media renderers.
- [ ] **Phase 4: Multimodal Vision:** MediaPipe landmark detection, gesture classification, debouncing pipelines.
- [ ] **Phase 5: Native Window Automation:** Win32 `SetWinEventHook` state listeners, bidirectional native control.
- [ ] **Phase 6: Multi-Platform Expansion:** macOS Accessibility (`AXUIElement`) and Linux Wayland/Hyprland hooks.

---

## Security & Safety Boundaries

Granting an AI system programmatic control over native applications requires strict guardrails:

- **No Arbitrary Shell Execution:** The LLM never accesses raw shell environments (`cmd.exe`, `powershell`, or `bash`). It only calls structured, strictly typed tools.
- **Parametric Type Checking:** All tool payloads undergo validation via Pydantic models before passing down to the Rust layer.
- **Destructive Action Gates:** Destructive operations (such as force-closing unsaved windows or modifying files) require explicit user confirmation via prompt dialogs.
- **Air-Gapped Operation:** When set to `local` mode, all processing—including MediaPipe landmark classification, LLM reasoning via Ollama, and SQLite storage—runs entirely on the local machine with zero external network calls.

---

## Contributing

We welcome contributions from engineers interested in systems architecture, multimodal interaction, and agentic workflows.

1. Fork the repository.
2. Create your feature branch (`git checkout -b feature/native-event-hooks`).
3. Commit your changes following [Conventional Commits](https://www.conventionalcommits.org/) (`git commit -m 'feat(win32): implement SetWinEventHook focus listener'`).
4. Push to your branch (`git push origin feature/native-event-hooks`).
5. Open a Pull Request with a clear description of your implementation and test coverage.

---


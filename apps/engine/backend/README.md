# Engine (Python FastAPI AI Brain)

## Purpose
Headless agent intelligence sidecar. Runs the ReAct loop, grounds user prompts, routes tool calls, manages memory, and coordinates LLM inference (Ollama or hosted).

## Tech Stack
- Python 3.11+, FastAPI, Pydantic v2, Uvicorn, SQLAlchemy, python-dotenv

## Folder Layout
```
apps/engine/backend/
├── main.py                  # FastAPI entry point
├── requirements.txt
├── agent/
│   ├── loop.py              # ReAct execution loop
│   ├── tools/               # window, web discovery tools
│   ├── memory/              # short-term buffers
│   └── providers/           # Ollama, OpenAI, Anthropic adapters
├── schemas/                 # Pydantic I/O schemas
└── database/                # SQLite session management
└── README.md
```

## How to Run
```powershell
cd apps/engine/backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python main.py
```

## How to Add a Feature
1. New tool → `agent/tools/<name>_tools.py`
2. New provider → `agent/providers/<name>.py`
3. New schema → `schemas/<name>.py`
4. Register in `agent/loop.py`

## IPC / API Contracts
- `GET /health`
- `POST /desktop/state`
- `POST /agent/invoke`

Consumed by `src-tauri` sidecar via local HTTP on port 8000.

## Testing
No test runner configured. Add pytest under `tests/`.

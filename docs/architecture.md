# Architecture

See the root `README.md` for the full system architecture diagram and design philosophy.

## Layer Summary
1. Presentation Shell — React + Tauri (`apps/shell/frontend`)
2. Native Systems Core — Rust + windows-rs (`src-tauri`)
3. Agent Intelligence — Python + FastAPI (`apps/engine/backend`)
4. Storage — SQLite (`modules/storage/schema.sql`)

## Integration Roadmap
- [Milestone 1 Integration Plan](milestone-1-integration-plan.md) — Comprehensive feature audit, frontend/backend link status, and execution plan for M1 completion.

# Storage Module (Cross-Cutting)

## Purpose
SQLite schema and migrations shared between the Python engine and (optionally) the Rust layer for layout persistence, workspace configs, and agent memory.

## Tech Stack
- SQLite 3, SQLAlchemy (Python), SQLx (Rust)

## Folder Layout
```
modules/storage/
├── schema.sql           # DDL for workspaces, windows, memory tables
└── README.md
```

## How to Run
Apply `schema.sql` to the engine's `nexus_state.db` via SQLAlchemy.

## How to Add a Feature
Add a table to `schema.sql` and create a migration. Update `SessionManager` in the engine.

## IPC / API Contracts
None exposed directly; accessed via engine endpoints.

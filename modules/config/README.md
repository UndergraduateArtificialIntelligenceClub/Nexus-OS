# Config Module (Cross-Cutting)

## Purpose
Environment variable loading and feature flags shared across the shell, engine, and Tauri core.

## Tech Stack
- dotenv (Python/Node), custom config parsing

## Folder Layout
```
modules/config/
├── index.ts             # TS config loader
└── README.md
```

## How to Use
Copy `.env.example` to `.env` at the repo root. Load via each runtime's dotenv equivalent.

## How to Add a Feature
Add a variable to `.env.example` and a typed accessor here.

## IPC / API Contracts
None.

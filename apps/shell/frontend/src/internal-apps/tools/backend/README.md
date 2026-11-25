# Tools Backend

Nothing lives here: the Tools manager reads the engine's canonical registry.
The endpoints are `GET /api/v1/tools` and `PATCH /api/v1/tools/{tool_id}` in
`apps/engine/backend/api/tools.py`; overrides are in
`ToolOverrideRepository` and enforced by `agent/execution/policy.py`.

# Agents Manager Backend

This module has no backend of its own. The roster reads the engine's agent
identity contract (#54): `AgentRoster` in `apps/engine/backend/api/agents.py`,
served as `GET /api/v1/agents` and `agent.updated` on the session WebSocket
(`docs/agents-manager/agent-identity.md`).

Control verbs (`pause`, `resume`, `cancel`, `retry`) belong to the engine
(#57) and will land there, not here.

# Agents Manager

Level-1, read-only duty roster (#55). An internal app module, registered as
`agents` in the shell app registry.

One row per engine agent: status, label, elapsed time, activity, and role.
Rows are grouped by run. Live data comes from the engine's agent identity
contract: `GET /api/v1/agents` to catch up, then `agent.updated` events. When
the engine is unreachable, the rows freeze behind an offline banner. Fixture
data is used only in tests, or with `VITE_NEXUS_ROSTER=fixture`.

Deliberately out of scope: chat, engine settings, permission approvals, and
agent-control verbs.

Design and limits: [`docs/agents-manager/roster-widget.md`](../../../../../../docs/agents-manager/roster-widget.md).

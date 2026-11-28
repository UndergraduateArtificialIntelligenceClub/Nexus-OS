# Agents Manager

Level-1 duty roster (#55) with the Level-2 control surface (#57 / #58),
registered as `agents` in the shell app registry.

One row per engine agent: status, label, elapsed time, activity, role, and
the verbs the engine can honestly perform. Waiting rows say `needs a
decision` and route into the UI library's `InterruptPanel` through the
`open` verb. Live data comes from the engine's agent identity contract:
`GET /api/v1/agents` to catch up, then `agent.updated` events; verbs and
interrupt answers go through the `RosterSource.commands` seam. When the
engine is unreachable, the rows freeze behind an offline banner and every
verb disables. Fixture data is used only in tests, or with
`VITE_NEXUS_ROSTER=fixture`; its dummy rows sit behind a simulated engine,
so the verbs are demonstrable with no engine attached (badge says `fixture`).

Deliberately out of scope: chat, engine settings, and interrupt answers
anywhere but the `InterruptPanel`.

Design and limits: [`docs/agents-manager/roster-widget.md`](../../../../../../docs/agents-manager/roster-widget.md).

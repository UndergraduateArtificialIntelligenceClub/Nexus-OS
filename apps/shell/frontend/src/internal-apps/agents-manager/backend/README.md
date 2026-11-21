# Agents Manager Backend

Placeholder for the upcoming M2 agents-manager epic (#54–#61).

The engine's agent discovery, lifecycle, and control APIs (`list_agents`, `pause_agent`, `resume_agent`, `cancel_agent`) will hook into the shell's IPC and desktop event bus here once the wire contract expands beyond `agent.nexus`.

Until then, the frontend uses `fixtureRosterSource` as the honest default seam, with `liveRosterSource` ready to fold `ServerEvent`s emitted by the engine.

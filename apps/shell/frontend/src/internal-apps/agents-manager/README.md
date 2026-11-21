# Agents Manager

Level-0, read-only duty-roster preview. It is an internal app module and is
registered as `agents` in the shell app registry.

The widget renders each agent's id, label, status, activity, elapsed time, and
task timeline. It uses fixture data by default. `liveRosterSource()` accepts the
existing `ServerEvent` union so the shell can switch to live engine events once
its event bus is available.

Deliberately out of scope: chat, engine settings, permission approvals, and
agent-control verbs.

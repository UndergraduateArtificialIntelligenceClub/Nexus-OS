// The engine session this page load works in. Every engine consumer uses the
// same id, so the agents roster (#55) sees the agents of the runs the shell
// starts (#41): the engine scopes `GET /api/v1/agents` and the event socket by it.

let sessionId: string | null = null

export function engineSessionId(): string {
  sessionId ??= crypto.randomUUID()
  return sessionId
}

# Voice track plan (#34 → #35, with the contracts #36 and #37 build on)

Decision: [`decision.md`](decision.md). Wire contract: [`07-api-flow.md` § Voice](../AI-Core/07-api-flow.md). Branch: `voice-tts`.

**Owners:** #34 and #35 Divy · #36 TTS and #37 E2E: other owners, who consume the interfaces in §3.

## 1. #34: decision spike, what's left

- [x] Decision doc comparing latency, cost, offline, privacy and integration effort (`decision.md`)
- [x] Decision recorded; `07-api-flow.md` updated (Voice section)
- [x] Bench harness: `scripts/voice-bench/` (`webspeech.html`, `bench.py --backend tts|gemini|local`, `--merge`)
- [ ] **Run the bench and commit results.** Web Speech in Chrome, Edge, and the Tauri window on Windows (WebView2: record the runtime version) and macOS (WKWebView). Then `bench.py --backend tts --merge results/webspeech-*.json`. Copy the medians into `decision.md`.
- [ ] Optional comparison: `--backend gemini` (needs `GEMINI_API_KEY`).
- [ ] Team sign-off on (a) and on dropping local-first for voice; then update `04-implementation-rules-and-roadmap.md` §11 and the README's air-gapped mode.
- [ ] Edit the GitHub text of #35 / #36 / #37 as in `decision.md` § Re-scoped (mainly the #35 privacy criterion, and "don't port Brahma" on #36).

**Done when** the bench table in `decision.md` has numbers and the team has signed off. Then close #34 and set ISSUES.md to ✅.

## 2. #35: speech-to-text mic capture wired to agent runs

### 2.1 What exists today

| Piece | Where | State |
|---|---|---|
| Mic placeholder | `src/shell/chrome/MenuBar.tsx` (the "mic off" span) | static text |
| Agent status incl. `listening` | `src/shell/agent/agentStore.tsx` (`AgentStatus`) | type exists; nothing sets `listening` |
| Avatar art for `listening` | `shell/avatar/OrbitArt.tsx`, `orbitEngine.ts`, `ui/ascii/AsciiFace.tsx`, `ui/ai/AgentStatus.tsx` | done |
| Run entry | `agentStore.ask(text)` → `AgentRun(text, agent)` → `runCommand` (local keyword agent) | no `source` argument |
| Engine client | `src/shell/agent/engineClient.ts`, `startRun(text, 'voice')` | **not wired into the shell** (INT-1) |
| Text input with Enter/Esc | `src/shell/chrome/Spotlight.tsx` | done |

### 2.2 Design

Recognition lives in a small wrapper, so the rest of the shell never touches `SpeechRecognition` directly. That keeps it testable and swappable (decision risk 1).

**`src/shell/voice/speechInput.ts`**: `createSpeechInput({ lang = 'en-US', Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition })`
- `supported: boolean`, plus `start()`, `stop()` (finish and deliver the final result), `cancel()` (abort, no result).
- Events: `onStateChange(state)`, `onInterim(text)`, `onFinal(text)`, `onError(kind)`.
- `interimResults: true`, `continuous: false`, `maxAlternatives: 1`.
- Error mapping (the table in 07): `not-allowed` / `service-not-allowed` → `permission-denied`; `network` → `service-unreachable`; `language-not-supported` or no constructor → `unsupported`; `no-speech` / `aborted` → back to `idle`, no error.
- Watchdog: if neither `onend` nor `onresult` fires within ~8 s of `start()`, cancel and report `service-unreachable` (seen with WebView2 network failures).

**`src/shell/voice/voiceStore.ts`**: same external-store pattern as `agentStore`.
- State: `idle | listening | preview | submitting | error`, plus `{ transcript, interim, error? }`.
- `listening` mirrors to `agent.listen()`; leaving it calls `agent.stopListening()`.
- `preview` → Enter: `submit()`; Esc: `cancel()` (back to idle, nothing sent).
- `submit()` → `agent.ask(transcript, { source: 'voice' })`. On a rejected run → `error: 'engine-unreachable'`, keeping the transcript (Retry / Edit).
- Barge-in hook: `start()` calls `speechSink.stop()` when a sink is registered (#36). It's a no-op until then.

**`src/shell/chrome/MicButton.tsx`**: replaces the MenuBar "mic off" span.
- Click toggles listening. Push-to-talk: hold `Mod+Shift+Space`; release = `stop()`. Esc cancels in any state.
- Labels follow the state: `mic` / `listening…` / `mic blocked` / `voice offline` / `voice unsupported` / `engine offline`. A `title` explains each state, plus the privacy line from 07.
- Hidden or disabled with a reason when `supported === false`.

**Transcript preview.** Reuse Spotlight instead of a new surface: when a final result arrives, open Spotlight prefilled with the transcript, focused, with a `voice` badge. Spotlight's existing Enter/Esc handling gives "preview before submit; Esc cancels". Interim text shows live in the mic control while listening.

**Small changes to existing code:**
- `agentStore.tsx`: add `listen()` / `stopListening()` (status `listening` ⇄ `idle`). Make `ask(text, meta?: { source?: RunSource })`, and `AgentRun = (text, agent, meta) => …`. Default source `'text'`. `runCommand` ignores it.
- `Spotlight.tsx`: accept `initialText` and `source` props; submit passes `source` through.
- `Desktop.tsx`: pass `meta.source` to `engineClient.startRun` once INT-1 lands. Until then, the local keyword agent handles voice text, so the loop is demoable without the engine.
- `MenuBar.tsx`: swap the span for `<MicButton />`; leave the "engine local" item to INT-1.
- `src/types` / `vite-env.d.ts`: a minimal `SpeechRecognition` type declaration (TS's DOM lib doesn't ship the `webkit` alias).

### 2.3 Tests (vitest, jsdom)

`src/shell/voice/fakeSpeechRecognition.ts`: a scriptable fake installed as `window.webkitSpeechRecognition`. Helpers: `emitInterim`, `emitFinal`, `emitError(code)`, `end()`. It's shared with #37's mocked-edge test.

- `speechInput.test.ts`: unsupported when there's no constructor; interim → final; each error code → its mapped kind; `no-speech` → idle; `cancel()` aborts without a result; watchdog fires.
- `voiceStore.test.ts`: idle → listening → preview → submitting → idle; Esc in preview sends nothing; a rejected run → `engine-unreachable` with the transcript kept; `agent.listen()` / `stopListening()` called; `speechSink.stop()` called on start when a sink is registered.
- `MicButton.test.tsx`: click and push-to-talk; label and tooltip per state; Spotlight opens prefilled; Enter → `ask(text, { source: 'voice' })`.
- `agentStore` test: `listen()` sets `listening`; `ask` passes `meta` through.

### 2.4 Acceptance mapping

| #35 criterion | Covered by |
|---|---|
| Mic control replacing the MenuBar placeholder | `MicButton` (toggle + push-to-talk) |
| Final transcript → `engineClient.startRun(text, 'voice')` | `voiceStore.submit` → `ask(…, {source:'voice'})` → `startRun` after INT-1; local agent until then |
| Explicit permission-denied / unsupported / engine-unreachable states | `speechInput` error mapping + `voiceStore` `engine-unreachable`, plus `service-unreachable` for WebView2 |
| Transcript preview; Esc cancels | Spotlight prefill |
| "Only text leaves the browser", documented | 07 § Voice, "What leaves the machine", **reworded** (see `decision.md`): Nexus sends only text, but the recognizer's vendor receives audio |
| Vitest with mocked SpeechRecognition | §2.3 |

### 2.5 Order of work

1. Wrapper `speechInput.ts`, the fake, and its tests (no UI).
2. `agentStore` `listen` / `meta`, plus test.
3. `voiceStore` and its tests.
4. `MicButton` + MenuBar swap + Spotlight prefill, plus tests.
5. Manual check with `scripts/voice-bench/webspeech.html` conditions: Chrome, then the Tauri window on Windows (expect `service-unreachable` on Runtime 153) and macOS.

## 3. Interfaces #36 and #37 build on

**`SpeechSink`** (`src/shell/voice/speechSink.ts`, owned by #36; #35 only calls `stop()`):
```ts
interface SpeechSink {
  speak(text: string, opts?: { source?: 'run' | 'alert' }): Promise<void> // resolves when playback ends or falls back
  stop(): void                       // barge-in
  readonly muted: boolean            // Settings toggle, persisted
  subscribe(listener: () => void): () => void // playing/idle → drives agent 'speaking'
}
```
- `agentStore.say()` currently times `speaking` by text length. With a sink, `speaking` ends when `speak()` resolves (#36 changes `say`).
- Degraded mode: on a failed or timed-out `/voice/tts`, or when muted, `speak()` resolves immediately and the reply bubble stays.

**#37 mocked-edge pipeline test:** the fake `SpeechRecognition` (from #35) emits the phrase → preview → submit → a mocked engine client emits `agent.state` listening → thinking → speaking plus `run.response` → the sink receives `speech` and mocked `/voice/tts` returns fixture WAV → assert avatar status order and the sink call. Its phrases come from `scripts/voice-bench/phrases.json`.

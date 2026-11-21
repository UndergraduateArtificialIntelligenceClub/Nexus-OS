# Voice stack decision (issue #34)

**Status:** Decided: option (a), by the voice track (Divy), pending team sign-off. The bench numbers below are still to be filled in.
**Date:** 2026-11-21 · **Track:** Voice

## Decision

**Option (a): browser Web Speech STT + engine-side TTS**, the original plan in `docs/AI-Core/07-api-flow.md`. The TTS backend is Piper by default; edge-tts is allowed now that local-first doesn't apply. #36 picks it, and both sit behind the same `/api/v1/voice/tts`.

Pipeline: `SpeechRecognition` in the shell → `POST /api/v1/agent/runs {text, source:"voice"}` → `run.response.speech` →
`POST /api/v1/voice/tts` (Piper, engine side) → playback in the shell.

Local-first is not a requirement for voice (voice-track call, 2026-11-21; confirm with the team). Recognized audio goes to the webview vendor's speech service.
`04-implementation-rules-and-roadmap.md` §11 and the README's air-gapped `local` mode still say otherwise; update them, or scope them to "except voice".

## Comparison

| | **(a) Web Speech + Piper** (chosen) | (b) Gemini Live native audio | (c) Hybrid: Gemini Live transcription + engine + TTS | Local STT in engine + Piper |
|---|---|---|---|---|
| Latency, end of speech → first reply audio | Web Speech final result + Piper synth + engine run; **bench pending** | Lowest perceived latency; streaming, barge-in | Streaming transcript + engine + TTS | Batch STT after release + TTS + engine |
| Cost | Free | `gemini-3.1-flash-live-preview`: $0.005/min in, $0.018/min out, about $3/user/month at 50 turns/day | About $0.005/min of speech in | Free |
| Offline | No | No | No | Yes |
| Privacy | Audio to Microsoft (WebView2/Edge) or Google (Chrome) | Audio and context to Google | Audio to Google | Stays local |
| Fits `07-api-flow` | **Yes, as designed.** Text into `/agent/runs` | **No.** The model answers and calls tools itself, outside the main graph, approvals and gateway | Yes, with a streaming STT adapter | Yes, plus `/voice/stt` |
| Integration effort | **Lowest.** Shell-only STT; `/voice/tts` in the engine | High: audio WebSocket bridge, tool-call adapter, keys | Medium | Medium: mic capture, endpoint, model download |
| Main risk | **WebView2 regression (below)** | Preview model, quotas, architecture bypass | Cost, keys | CPU latency, ~500 MB model |

**Hex app:** not a fit for any option. It is a stand-alone, speech-to-text-only dictation app that pastes into the focused window. It has no TTS, and its SDK transcribes finished WAV files through an unreleased helper.

## Risks and mitigations for (a)

1. **Web Speech is broken in WebView2 Runtime 153.** It fails with `network` ([WebView2Feedback #5724](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5724), a regression from 152). This is our Windows target, and the evergreen runtime auto-updates, so we cannot pin around it in production.
   - Track #5724. The bench page reports the runtime version and any error, so we know when it is fixed.
   - Show a clear "voice unavailable" state on `SpeechRecognitionError` (`network`, `not-allowed`, `language-not-supported`). Keep typed input as the always-working path.
   - Keep the shell's STT behind a small `SpeechInput` interface (`start/stop/onResult/onError`), so another recognizer can be swapped in without touching the run flow.
2. **macOS Tauri uses WKWebView.** Web Speech there is unverified, and WebKit has shipped it exposed-but-non-functional in WKWebView before (iOS, WebKit bug 239816). Test on the bench page inside the Tauri window.
3. **Vendor behaviour.** Recognition quality, language list and outages are outside our control. Edge has had regional `network` failures (Edge 147, April 2026).
4. **Piper licence.** The maintained Piper (`OHF-Voice/piper1-gpl`) is GPL-3.0, and Nexus is Apache-2.0. Run it as a separate CLI process, not imported into the PyInstaller engine binary, and get a licence review before distributing. Kokoro-82M (Apache-2.0) is the fallback voice. (Not legal advice.)

## Prototype bench

`scripts/voice-bench/`: `webspeech.html` times a person reading the 12 phrases (`phrases.json`). It measures from the end of voice, read from the mic level, to the recognizer's final result, plus the word error rate. `bench.py --backend tts` times Piper on the replies, and `--merge` combines the two into `results/summary.md`. Gemini Live and local STT stay in the bench as comparison backends.

| Metric (median of 12 phrases) | (a) Web Speech + Piper | (b) Gemini Live (comparison) |
|---|---|---|
| End of speech → final transcript | _pending_ | _pending_ |
| Piper synth time (reply ready) | _pending_ | n/a |
| End of speech → first reply audio (excl. engine) | _pending_ (sum of the two above) | _pending_ |
| Word error rate | _pending_ | _pending_ |
| Error rate on Windows (WebView2 runtime noted) | _pending_ | _pending_ |

## Re-scoped implementation issues

The GitHub issues are the source of truth. These notes say what each one means under this decision, and where its text needs to change. Implementation steps are in [`plan.md`](plan.md).

- **#35 STT (Web Speech path): keep it as written, with one correction.** The criterion "only text leaves the browser (no audio upload)" is **not true for Web Speech in Chromium**. Nexus uploads no audio, but the recognizer itself streams mic audio to Microsoft (WebView2/Edge) or Google (Chrome). Change the criterion to: *"Nexus sends only the transcript to the engine; the webview's recognizer sends audio to its vendor's speech service — documented in 07 and in the mic tooltip."* Chrome's on-device recognition mode would make the original wording true where available; it is unverified in WebView2, so it is a follow-up, not a requirement. The "engine unreachable" error state depends on INT-1 (engine client wiring).
- **#36 TTS: keep it as written.** Piper (GPL-3.0, run as a CLI subprocess; see Risks) or edge-tts. edge-tts uses Microsoft Edge's online Read Aloud voice service through an unofficial client, so it can break or be rate-limited without notice. It also needs network access, which is acceptable now. **Do not port Brahma's `_speak_edge_native`.** #34 marks Brahma as personal-use licensed, reference only, do not copy. Write the adapter from the edge-tts library's own docs. The "same speech sink" criterion needs one shell `SpeechSink` (`speak`, `stop`, `muted`, playback state). #35 calls its `stop()` when listening starts (barge-in), and the avatar's `speaking` state follows its playback.
- **#37 Voice loop E2E: keep it as written.** "≤ 5 s to first audio with a local model" means the engine running a local model provider (e.g. Ollama); STT is Web Speech either way. The automated test mocks the two edges: a fake `SpeechRecognition` and a mocked `/voice/tts`. The bench phrase set (`scripts/voice-bench/phrases.json`) is its input. The bench covers STT + TTS only; #37 adds the engine run and owns the manual real-device checklist.
- **#46:** unchanged; push-to-talk from #35 is its starting point.

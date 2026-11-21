# Voice bench (issue #34)

Measures the chosen voice stack, (a) Web Speech STT + Piper TTS, on a scripted phrase set (`phrases.json`). Two other stacks are kept for comparison.

| Backend | What it measures | How |
|---|---|---|
| `webspeech` | Browser/webview `SpeechRecognition`: end of speech → final transcript, WER | `webspeech.html`, a person reads the phrases |
| `piper-tts` | Piper synth time for each reply (CLI subprocess) | `bench.py --backend tts` |
| `gemini` | Gemini Live native audio (comparison) | `bench.py --backend gemini` |
| `local` | faster-whisper + Piper (comparison) | `bench.py --backend local` |

## Metrics

All latencies start at **end of speech**, the moment the last user audio chunk is delivered.

- `stt_ms`: final transcript available. For `webspeech`, end of speech is the last moment the mic level is above the silence threshold, so the recognizer's own end-of-speech delay is included. For Gemini it can be negative, because transcription streams while the user is still talking.
- `first_audio_ms`: first reply audio available. **Local excludes the engine run.** Gemini includes its own reasoning. To compare full loops, add the engine's `/api/v1/agent/runs` time to local.
- `total_ms`: turn finished. `connect_ms`: Gemini session setup (one fresh session per phrase).
- `wer`: word error rate of the transcript vs the phrase text.

The local TTS figure is an upper bound: the Piper CLI writes the whole WAV before we count it, and each call pays process start and voice load.

## Run it

```sh
cd scripts/voice-bench
python3.12 -m venv .venv && source .venv/bin/activate     # needs Python 3.10+
pip install piper-tts                                     # add faster-whisper google-genai for the comparisons
python -m piper.download_voices --data-dir voices en_US-lessac-medium
python bench.py --self-test                               # no deps; checks the harness
```

**1. Web Speech (STT half).** Serve this folder and open the page in the browser or webview you ship in:

```sh
python -m http.server 8765        # then open http://localhost:8765/webspeech.html
```

Allow the mic, then press Start (or Space) and read each phrase. When all 12 are done, click **Download results** and move the file into `results/`. Repeat in each target: Chrome (dev build), Edge, and the Tauri window on Windows (WebView2) and macOS (WKWebView). An error, or "no SpeechRecognition", is a result too: keep the file.

**2. Piper (TTS half), merged with step 1:**

```sh
python bench.py --backend tts --piper-model en_US-lessac-medium --piper-data-dir voices \
  --merge results/webspeech-*.json
```

**Comparisons (optional):** `--backend gemini` (needs `GEMINI_API_KEY`) or `--backend local`; `--backend all` runs Piper, local and Gemini.

Options: `--stt-model base.en|small.en|medium.en`, `--device cuda`, `--compute-type float16`, `--runs 3`, `--gemini-model <id>` (default `gemini-3.1-flash-live-preview`).

**Input audio (gemini/local only).** If `audio/<id>.wav` exists (a real recording), it is used. Otherwise the phrase is synthesized once with Piper into `audio/synth/`. Synthetic speech is easier to recognize than a person, so record at least one person reading the 12 phrases before trusting the WER column.

## Results

Each run writes `results/<timestamp>.json` (every turn, merged files included) and `results/summary.md`. Commit those plus the `webspeech-*.json` files, then copy the medians into the table in `docs/voice/decision.md`. Run on the team's reference Windows laptop, with the machine noted in the summary.

The Gemini backend uses the `google-genai` Live API (`client.aio.live.connect`, `send_realtime_input`, `session.receive`) as documented at the time of writing. If the SDK has changed, adjust `GeminiLiveBackend`. It is written from the public docs; nothing is taken from the Brahma reference code.

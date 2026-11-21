#!/usr/bin/env python3
"""Voice stack latency bench (issue #34).

Runs a scripted phrase set through the voice stacks and records latency and
accuracy for each phrase:

  webspeech  browser Web Speech STT, measured in webspeech.html (a person reads
             the phrases) and merged here with --merge            option (a), chosen
  tts        Piper TTS only (CLI subprocess): the TTS half of (a)
  local      faster-whisper STT (in process) + Piper TTS                comparison
  gemini     Gemini Live native audio over the google-genai SDK   option (b), comparison

Every latency is measured from the moment the last chunk of user audio has
been delivered ("end of speech"):

  stt_ms          end of speech -> final transcript
  first_audio_ms  end of speech -> first reply audio sample available
  wer             word error rate of the transcript vs the scripted phrase

The local stack does not run the engine graph; its first_audio_ms is
STT + TTS only. Gemini's includes the model's own reasoning. Add the engine's
run time (measure it with /api/v1/agent/runs) to compare the full loops.

Usage:
  python bench.py --self-test                     # no deps, fake backends
  python bench.py --backend tts --piper-model en_US-lessac-medium --piper-data-dir voices \
      --merge results/webspeech-*.json            # option (a): Web Speech + Piper
  python bench.py --backend local --piper-model en_US-lessac-medium --piper-data-dir voices
  GEMINI_API_KEY=... python bench.py --backend gemini --piper-model en_US-lessac-medium --piper-data-dir voices
  python bench.py --backend all --piper-model en_US-lessac-medium --piper-data-dir voices

Input audio: audio/<id>.wav if recorded (any rate, mono or stereo PCM16),
otherwise synthesized once with Piper into audio/synth/<id>.wav.
"""

from __future__ import annotations

import argparse
import array
import asyncio
import io
import json
import os
import platform
import statistics
import subprocess
import sys
import tempfile
import time
import wave
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Protocol

HERE = Path(__file__).resolve().parent
TARGET_RATE = 16_000
CHUNK_MS = 20


# ---------------------------------------------------------------------------
# audio helpers (stdlib only)
# ---------------------------------------------------------------------------


@dataclass
class Pcm:
    """Mono PCM16 at TARGET_RATE."""

    data: bytes

    @property
    def duration_ms(self) -> float:
        return len(self.data) / 2 / TARGET_RATE * 1000

    def chunks(self, ms: int = CHUNK_MS):
        step = TARGET_RATE * ms // 1000 * 2
        for i in range(0, len(self.data), step):
            yield self.data[i:i + step]

    def to_wav(self) -> bytes:
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(TARGET_RATE)
            w.writeframes(self.data)
        return buf.getvalue()


def read_wav(path: Path) -> Pcm:
    with wave.open(str(path), "rb") as w:
        if w.getsampwidth() != 2:
            raise ValueError(f"{path}: only PCM16 WAV is supported")
        channels, rate = w.getnchannels(), w.getframerate()
        samples = array.array("h", w.readframes(w.getnframes()))
    if sys.byteorder == "big":
        samples.byteswap()
    if channels > 1:
        samples = array.array("h", (
            int(sum(samples[i:i + channels]) / channels) for i in range(0, len(samples), channels)
        ))
    return Pcm(resample(samples, rate, TARGET_RATE).tobytes())


def resample(samples: array.array, src: int, dst: int) -> array.array:
    """Linear-interpolation resample. Good enough for ASR input."""
    if src == dst or not samples:
        return samples
    n_out = int(len(samples) * dst / src)
    out = array.array("h", bytes(2 * n_out))
    ratio = src / dst
    last = len(samples) - 1
    for i in range(n_out):
        pos = i * ratio
        j = int(pos)
        frac = pos - j
        a = samples[min(j, last)]
        b = samples[min(j + 1, last)]
        out[i] = int(a + (b - a) * frac)
    return out


def wer(reference: str, hypothesis: str) -> float:
    norm = lambda s: "".join(c.lower() if c.isalnum() or c.isspace() else " " for c in s).split()
    ref, hyp = norm(reference), norm(hypothesis)
    if not ref:
        return 0.0 if not hyp else 1.0
    prev = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        cur = [i] + [0] * len(hyp)
        for j, h in enumerate(hyp, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r != h))
        prev = cur
    return prev[-1] / len(ref)


# ---------------------------------------------------------------------------
# backends
# ---------------------------------------------------------------------------


@dataclass
class TurnResult:
    phrase_id: str
    backend: str
    audio_ms: float
    transcript: str = ""
    stt_ms: Optional[float] = None
    first_audio_ms: Optional[float] = None
    total_ms: Optional[float] = None
    connect_ms: Optional[float] = None
    wer: Optional[float] = None
    error: Optional[str] = None
    extra: dict = field(default_factory=dict)


class Backend(Protocol):
    name: str

    def describe(self) -> dict: ...

    async def turn(self, phrase: dict, pcm: Pcm) -> TurnResult: ...


class PiperCli:
    """Piper as a separate process (keeps the GPL-3.0 code out of our binaries)."""

    def __init__(self, model: Optional[str], data_dir: Optional[str] = None, binary: Optional[str] = None) -> None:
        self.model = model
        self.data_dir = data_dir
        # piper1-gpl CLI: `python -m piper -m <voice> -f <out.wav> -- <text>` (docs/CLI.md).
        self.command = [binary] if binary else [sys.executable, "-m", "piper"]

    def synth(self, text: str, out: Path) -> float:
        if not self.model:
            raise RuntimeError("--piper-model is required to synthesize audio")
        out.parent.mkdir(parents=True, exist_ok=True)
        cmd = [*self.command, "-m", self.model, "-f", str(out)]
        if self.data_dir:
            cmd += ["--data-dir", self.data_dir]
        start = time.perf_counter()
        # Includes process start and voice load on every call, as a per-request subprocess would.
        subprocess.run([*cmd, "--", text], check=True, capture_output=True)
        return (time.perf_counter() - start) * 1000


class TtsBackend:
    """Piper only: the TTS half of option (a). Web Speech supplies the STT half."""

    name = "piper-tts"
    has_stt = False

    def __init__(self, piper: PiperCli) -> None:
        self.piper = piper
        with tempfile.TemporaryDirectory() as tmp:  # warm the voice files into the OS cache
            self.piper.synth("Ready.", Path(tmp) / "warm.wav")

    def describe(self) -> dict:
        return {"tts": f"piper {self.piper.model} (CLI, per-request process)"}

    async def turn(self, phrase: dict, pcm: Pcm) -> TurnResult:
        result = TurnResult(phrase["id"], self.name, pcm.duration_ms)
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "reply.wav"
            result.first_audio_ms = self.piper.synth(phrase["reply"], out)
            result.extra["reply_audio_ms"] = round(read_wav(out).duration_ms)
        result.total_ms = result.first_audio_ms
        return result


class LocalBackend:
    name = "local"

    def __init__(self, stt_model: str, piper: PiperCli, device: str, compute_type: str) -> None:
        from faster_whisper import WhisperModel  # imported here: optional dependency

        self.stt_model_name = stt_model
        self.piper = piper
        load = time.perf_counter()
        self.model = WhisperModel(stt_model, device=device, compute_type=compute_type)
        self.load_ms = (time.perf_counter() - load) * 1000
        self.device, self.compute_type = device, compute_type
        # Warm up so the first phrase doesn't pay one-time init costs.
        list(self.model.transcribe(io.BytesIO(Pcm(bytes(TARGET_RATE * 2)).to_wav()))[0])

    def describe(self) -> dict:
        return {"stt": f"faster-whisper {self.stt_model_name} ({self.device}/{self.compute_type})",
                "tts": f"piper {Path(self.piper.model or '').name}", "model_load_ms": round(self.load_ms)}

    async def turn(self, phrase: dict, pcm: Pcm) -> TurnResult:
        result = TurnResult(phrase["id"], self.name, pcm.duration_ms)
        t0 = time.perf_counter()  # batch STT: recognition starts when the user stops talking
        segments, _info = self.model.transcribe(io.BytesIO(pcm.to_wav()), language="en", beam_size=1)
        result.transcript = " ".join(s.text.strip() for s in segments).strip()
        result.stt_ms = (time.perf_counter() - t0) * 1000
        with tempfile.TemporaryDirectory() as tmp:
            # Non-streaming CLI: the whole reply is ready at once, so this is an upper bound.
            self.piper.synth(phrase["reply"], Path(tmp) / "reply.wav")
        result.first_audio_ms = (time.perf_counter() - t0) * 1000
        result.total_ms = result.first_audio_ms
        return result


class GeminiLiveBackend:
    name = "gemini"

    def __init__(self, model: str) -> None:
        from google import genai  # optional dependency: google-genai
        from google.genai import types

        if not os.environ.get("GEMINI_API_KEY"):
            raise RuntimeError("GEMINI_API_KEY is not set")
        self.types = types
        self.client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
        self.model = model

    def describe(self) -> dict:
        return {"model": self.model}

    async def turn(self, phrase: dict, pcm: Pcm) -> TurnResult:
        types = self.types
        result = TurnResult(phrase["id"], self.name, pcm.duration_ms)
        config = types.LiveConnectConfig(
            response_modalities=[types.Modality.AUDIO],
            system_instruction=f"You are a desktop assistant. Reply with exactly this sentence and nothing else: {phrase['reply']}",
            input_audio_transcription=types.AudioTranscriptionConfig(),
        )
        c0 = time.perf_counter()
        # One session per phrase: no carried context, so turns are independent.
        async with self.client.aio.live.connect(model=self.model, config=config) as session:
            result.connect_ms = (time.perf_counter() - c0) * 1000
            last_transcript_at: Optional[float] = None
            pieces: list[str] = []

            async def send() -> float:
                for chunk in pcm.chunks():
                    await session.send_realtime_input(
                        audio=types.Blob(data=chunk, mime_type=f"audio/pcm;rate={TARGET_RATE}"))
                    await asyncio.sleep(CHUNK_MS / 1000)  # real-time pacing, like a live mic
                end = time.perf_counter()
                await session.send_realtime_input(audio_stream_end=True)
                return end

            sender = asyncio.create_task(send())
            first_audio_at: Optional[float] = None
            async for message in session.receive():
                content = message.server_content
                if content is None:
                    continue
                if content.input_transcription and content.input_transcription.text:
                    pieces.append(content.input_transcription.text)
                    last_transcript_at = time.perf_counter()
                if first_audio_at is None and content.model_turn:
                    if any(p.inline_data and p.inline_data.data for p in content.model_turn.parts or []):
                        first_audio_at = time.perf_counter()
                if content.turn_complete:
                    break
            t0 = await sender
            done = time.perf_counter()

        result.transcript = "".join(pieces).strip()
        # Transcription streams while audio is still arriving, so this can be negative.
        result.stt_ms = None if last_transcript_at is None else (last_transcript_at - t0) * 1000
        result.first_audio_ms = None if first_audio_at is None else (first_audio_at - t0) * 1000
        result.total_ms = (done - t0) * 1000
        return result


class FakeBackend:
    """For --self-test: deterministic delays, no network, no models."""

    def __init__(self, name: str, stt_ms: float, tts_ms: float) -> None:
        self.name, self.stt, self.tts = name, stt_ms / 1000, tts_ms / 1000

    def describe(self) -> dict:
        return {"fake": True}

    async def turn(self, phrase: dict, pcm: Pcm) -> TurnResult:
        result = TurnResult(phrase["id"], self.name, pcm.duration_ms)
        t0 = time.perf_counter()
        await asyncio.sleep(self.stt)
        result.transcript = phrase["text"] if phrase["id"] != "p03" else phrase["text"] + " please"
        result.stt_ms = (time.perf_counter() - t0) * 1000
        await asyncio.sleep(self.tts)
        result.first_audio_ms = result.total_ms = (time.perf_counter() - t0) * 1000
        return result


# ---------------------------------------------------------------------------
# runner
# ---------------------------------------------------------------------------


def load_phrases(path: Path) -> list[dict]:
    phrases = json.loads(path.read_text(encoding="utf-8"))["phrases"]
    ids = [p["id"] for p in phrases]
    if len(ids) != len(set(ids)):
        raise ValueError("phrase ids must be unique")
    return phrases


def input_audio(phrase: dict, audio_dir: Path, piper: Optional[PiperCli]) -> tuple[Pcm, str]:
    recorded = audio_dir / f"{phrase['id']}.wav"
    if recorded.exists():
        return read_wav(recorded), "recorded"
    synth = audio_dir / "synth" / f"{phrase['id']}.wav"
    if not synth.exists():
        if piper is None:
            raise RuntimeError(f"no audio for {phrase['id']}: record {recorded} or pass --piper-model")
        piper.synth(phrase["text"], synth)
    return read_wav(synth), "piper-synth"


def silence_pcm(phrase: dict) -> Pcm:
    words = len(phrase["text"].split())
    return Pcm(bytes(int(TARGET_RATE * 2 * (0.4 + words * 0.3))))


def pct(values: list[float], q: float) -> float:
    values = sorted(values)
    if len(values) == 1:
        return values[0]
    k = (len(values) - 1) * q
    lo = int(k)
    hi = min(lo + 1, len(values) - 1)
    return values[lo] + (values[hi] - values[lo]) * (k - lo)


def summarize(results: list[TurnResult]) -> dict:
    by_backend: dict[str, dict] = {}
    for name in sorted({r.backend for r in results}):
        rows = [r for r in results if r.backend == name]
        ok = [r for r in rows if r.error is None]
        entry: dict = {"turns": len(rows), "errors": len(rows) - len(ok)}
        for metric in ("stt_ms", "first_audio_ms", "total_ms", "connect_ms", "wer"):
            vals = [getattr(r, metric) for r in ok if getattr(r, metric) is not None]
            if vals:
                entry[metric] = {"median": round(statistics.median(vals), 3 if metric == "wer" else 1),
                                 "p90": round(pct(vals, 0.9), 3 if metric == "wer" else 1)}
        by_backend[name] = entry
    return by_backend


def load_merged(paths: list[Path]) -> tuple[list[TurnResult], dict]:
    """Turns recorded elsewhere (webspeech.html downloads) in the same TurnResult shape."""
    turns: list[TurnResult] = []
    info: dict = {}
    allowed = set(TurnResult.__dataclass_fields__)
    for path in paths:
        doc = json.loads(path.read_text(encoding="utf-8"))
        for raw in doc["turns"]:
            turns.append(TurnResult(**{k: v for k, v in raw.items() if k in allowed}))
        for name, value in doc.get("meta", {}).get("backends", {}).items():
            info[name] = {**value, "file": path.name}
    return turns, info


def summary_markdown(summary: dict, meta: dict) -> str:
    def cell(entry: dict, metric: str) -> str:
        m = entry.get(metric)
        if not m:
            return "–"
        if metric == "wer":
            return f"{m['median']:.1%} (p90 {m['p90']:.1%})"
        return f"{m['median']:.0f} ms (p90 {m['p90']:.0f})"

    names = list(summary)
    lines = [
        f"# Voice bench summary ({meta['started_at']})",
        "",
        f"Machine: {meta['machine']} · phrases: {meta['phrases']} · runs: {meta['runs']} · input audio: {', '.join(sorted(set(meta['audio_sources'])))}",
        "",
        "| Metric | " + " | ".join(names) + " |",
        "|---|" + "---|" * len(names),
    ]
    for label, metric in [("End of speech → transcript", "stt_ms"),
                          ("End of speech → first reply audio", "first_audio_ms"),
                          ("End of speech → turn complete", "total_ms"),
                          ("Session connect", "connect_ms"),
                          ("Word error rate", "wer")]:
        lines.append(f"| {label} | " + " | ".join(cell(summary[n], metric) for n in names) + " |")
    lines += ["", "Errors: " + ", ".join(f"{n} {summary[n]['errors']}/{summary[n]['turns']}" for n in names), ""]
    stt = summary.get("webspeech", {}).get("stt_ms")
    tts = summary.get("piper-tts", {}).get("first_audio_ms")
    if stt and tts:
        lines += [f"**Option (a) estimate, end of speech → first reply audio, excluding the engine run:** "
                  f"{stt['median'] + tts['median']:.0f} ms (Web Speech STT median {stt['median']:.0f} + "
                  f"Piper median {tts['median']:.0f}).", ""]
    for name, info in meta["backends"].items():
        lines.append(f"- **{name}:** " + ", ".join(f"{k} = {v}" for k, v in info.items()))
    return "\n".join(lines) + "\n"


async def run(backends: list, phrases: list[dict], audio_for, runs: int) -> tuple[list[TurnResult], list[str]]:
    results: list[TurnResult] = []
    sources: list[str] = []
    for phrase in phrases:
        pcm, source = audio_for(phrase)
        sources.append(source)
        for backend in backends:
            for _ in range(runs):
                try:
                    result = await backend.turn(phrase, pcm)
                    if getattr(backend, "has_stt", True):
                        result.wer = wer(phrase["text"], result.transcript)
                except Exception as error:  # record and keep going: one bad turn shouldn't kill the run
                    result = TurnResult(phrase["id"], backend.name, pcm.duration_ms, error=repr(error))
                results.append(result)
                print(f"{backend.name:9} {phrase['id']} "
                      + (f"error {result.error}" if result.error else
                         f"stt {result.stt_ms or 0:7.0f} ms  first audio {result.first_audio_ms or 0:7.0f} ms  "
                         + (f"wer {result.wer:.0%}  '{result.transcript}'" if result.wer is not None else "")),
                      flush=True)
    return results, sources


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--backend", choices=["tts", "local", "gemini", "all", "none"], default="tts",
                    help="tts = Piper only (option a); all = tts + local + gemini; none = only --merge files")
    ap.add_argument("--merge", type=Path, nargs="*", default=[],
                    help="webspeech.html result files to include in the summary")
    ap.add_argument("--phrases", type=Path, default=HERE / "phrases.json")
    ap.add_argument("--audio-dir", type=Path, default=HERE / "audio")
    ap.add_argument("--out", type=Path, default=HERE / "results")
    ap.add_argument("--runs", type=int, default=1, help="repeats per phrase per backend")
    ap.add_argument("--stt-model", default="small.en")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--compute-type", default="int8")
    ap.add_argument("--piper-model", help="Piper voice name or .onnx path, e.g. en_US-lessac-medium")
    ap.add_argument("--piper-data-dir", help="where Piper voices were downloaded (python -m piper.download_voices)")
    ap.add_argument("--piper-bin", help="piper executable instead of `python -m piper`")
    ap.add_argument("--gemini-model", default="gemini-3.1-flash-live-preview")
    ap.add_argument("--self-test", action="store_true", help="fake backends and silent audio; no deps")
    args = ap.parse_args(argv)

    phrases = load_phrases(args.phrases)
    piper = PiperCli(args.piper_model, args.piper_data_dir, args.piper_bin) if args.piper_model else None

    if args.self_test:
        tts = FakeBackend("piper-tts", 0, 50)
        tts.has_stt = False
        backends = [tts, FakeBackend("local", 30, 60), FakeBackend("gemini", 10, 40)]
        audio_for = lambda p: (silence_pcm(p), "silence")
    else:
        backends = []
        if args.backend in ("tts", "local", "all") and piper is None:
            ap.error("--piper-model is required for the tts and local backends")
        if args.backend in ("tts", "all"):
            backends.append(TtsBackend(piper))
        if args.backend in ("local", "all"):
            backends.append(LocalBackend(args.stt_model, piper, args.device, args.compute_type))
        if args.backend in ("gemini", "all"):
            backends.append(GeminiLiveBackend(args.gemini_model))
        needs_audio = any(getattr(b, "has_stt", True) for b in backends)
        audio_for = (lambda p: input_audio(p, args.audio_dir, piper)) if needs_audio else (lambda p: (silence_pcm(p), "none (TTS only)"))

    started = datetime.now(timezone.utc)
    results, sources = asyncio.run(run(backends, phrases, audio_for, args.runs)) if backends else ([], [])
    merged, merged_info = load_merged(args.merge)
    results += merged
    if not results:
        ap.error("nothing to summarize: pick a --backend or pass --merge files")
    summary = summarize(results)
    meta = {
        "started_at": started.isoformat(timespec="seconds"),
        "machine": f"{platform.system()} {platform.machine()} · {platform.processor() or 'cpu'} · Python {platform.python_version()}",
        "phrases": len(phrases),
        "runs": args.runs,
        "audio_sources": sources + (["read aloud (webspeech.html)"] if merged else []),
        "self_test": args.self_test,
        "backends": {**{b.name: b.describe() for b in backends}, **merged_info},
    }

    args.out.mkdir(parents=True, exist_ok=True)
    stamp = started.strftime("%Y%m%dT%H%M%SZ") + ("-selftest" if args.self_test else "")
    (args.out / f"{stamp}.json").write_text(json.dumps(
        {"meta": meta, "summary": summary, "turns": [asdict(r) for r in results]}, indent=2), encoding="utf-8")
    markdown = summary_markdown(summary, meta)
    (args.out / ("summary-selftest.md" if args.self_test else "summary.md")).write_text(markdown, encoding="utf-8")
    print("\n" + markdown)
    return 0 if all(s["errors"] < s["turns"] for s in summary.values()) else 1


if __name__ == "__main__":
    sys.exit(main())

# Nexus OS — Issue Roadmap

This document is the readable, organized view of the full issue backlog: what each milestone
contains, how labeling works, and how you should pick work if you own a module.

The **source of truth is GitHub Issues**. This doc is a snapshot index — tick the checkboxes in
each issue's acceptance criteria there, and update the Status column here when an issue closes.

- Milestone 1 — MVP gaps: [#4](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/milestone/4)
- Milestone 2 — Integration, Gestures, Vision, Agents Manager: [#5](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/milestone/5)
- Milestone 3 — Android, Apps, Integration: [#6](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/milestone/6)

---

## 1. How labeling works

Every issue carries three kinds of labels: **module** (which feature area it belongs to),
**priority** (how urgent), and **milestone** (which release wave). Some also carry generic
type labels (`bug`, `testing`, `documentation`, `backend`, `frontend`, ...) inherited from the
repo's existing scheme.

### Module labels

| Label | Module | What lives here |
|---|---|---|
| `feat:os-layout` | OS Layout | Desktop shell, widget grid, internal apps (Settings, Files, Notes, Calc, Clock, Gallery, Tools manager, media widgets) |
| `feat:window-manager` | Window Manager | Layout/state persistence, move/resize/minimize controls, WM cleanup |
| `feat:voice` | Voice | STT, TTS, push-to-talk, echo handling, the full voice loop |
| `feat:automations` | Automations | Agent skills/tools, orchestrator, task runtime, schedulers, migrated automations |
| `feat:gestures` | Gestures | Hand tracking, gesture classifier, gesture-to-action mapping |
| `feat:vision` | Vision | Screen understanding, vision-guided actions, camera vision apps |
| `feat:agents-manager` | Agents Manager | Agent identity contract, duty roster, roster verbs, duties, permissions |
| `feat:search` | Web Search | Search providers, headless browser, search UI (pre-existing label) |

### Priority labels

| Label | Meaning |
|---|---|
| `p0` | Demo blocker — on the MVP/milestone critical path. Pick these first. |
| `p1` | Milestone scope — should land within the milestone. |
| `p2` | Nice to have — pick when p0/p1 work in your module is done. |

### Milestone labels + GitHub milestones

| Label | Milestone | Theme |
|---|---|---|
| `m1-gaps` | M1 - MVP gaps (#4) | Close every gap found in the MVP-plan audit (Nov 2026) |
| `m2-integration-gestures-vision-agents` | M2 (#5) | Engine↔shell integration, gestures, vision, agents manager, more apps |
| `m3-android-apps-integration` | M3 (#6) | Android device ecosystem, extended apps, integration layers |

### Which label should you look at?

If you work on **one module**, filter by that module's label. If you work on **one milestone**,
filter by the milestone label. Priorities tell you the order inside either filter.

---

## 2. Who works on what (module → team mapping)

Derived from the original MVP plan ownership, extended for the new modules:

| Module label | Suggested team |
|---|---|
| `feat:os-layout` | Jensen, Chetan |
| `feat:window-manager` | divy, yash, raghav |
| `feat:search` | ajax, raghav |
| `feat:voice` | divy, yash |
| `feat:automations` | Soham, jiawen, raghav (support) |
| `feat:gestures` | (assign at kickoff — works closely with vision) |
| `feat:vision` | (assign at kickoff — works closely with automations + gestures) |
| `feat:agents-manager` | (agent team — contract first, widget second) |

---

## 3. Milestone 1 — MVP gaps (issues #24–#41)

Goal: close every incomplete checkpoint from the original MVP plan before starting M2.

### Web search

| # | Issue | Pri | Status |
|---|---|---|---|
| [#29](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/29) | Expose web search tools behind the AI-Core execution gateway | p0 | ⬜ |
| [#24](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/24) | Add a fallback search provider (DuckDuckGo) | p1 | ⬜ |
| [#25](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/25) | Search results desktop widget | p0 | ⬜ |

### OS Layout & apps

| # | Issue | Pri | Status |
|---|---|---|---|
| [#30](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/30) | Tools manager app widget | p1 | ⬜ |
| [#31](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/31) | Upgrade Notes and Files into real file viewers | p1 | ⬜ |
| [#26](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/26) | Dedicated media widgets: VideoPlayer and ArticleReader | p1 | ⬜ |
| [#27](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/27) | Agent manager MVP widget (Level 0 preview) | p2 | ⬜ |
| [#32](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/32) | Multi-widget layout sign-off pass | p0 | ⬜ |

### Window Manager

| # | Issue | Pri | Status |
|---|---|---|---|
| [#28](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/28) | SQLite-backed workspace persistence (persist_workspace) | p2 | ⬜ |
| [#33](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/33) | Remove the superseded legacy window manager generation | p2 | ⬜ |

### Voice

| # | Issue | Pri | Status |
|---|---|---|---|
| [#34](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/34) | Voice architecture decision spike (STT/TTS stack) | p0 | ⬜ |
| [#35](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/35) | Speech-to-text mic capture wired to agent runs | p0 | ⬜ |
| [#36](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/36) | Text-to-speech output (Piper or edge-tts) | p1 | ⬜ |
| [#37](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/37) | Full voice loop end-to-end test | p0 | ⬜ |

### Automations

| # | Issue | Pri | Status |
|---|---|---|---|
| [#38](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/38) | Automation migration inventory + wave-1 ports (Brahma reference) | p1 | ⬜ |
| [#39](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/39) | Multi-step task runtime (planner / executor / task queue port) | p1 | ⬜ |
| [#40](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/40) | Fix or remove the legacy ReAct loop (/agent/invoke 503 paths) | p1 | ⬜ |

### Integration

| # | Issue | Pri | Status |
|---|---|---|---|
| [#41](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/41) | Wire the engine into the shell (engineClient) | p0 | ⬜ |

---

## 4. Milestone 2 — Integration, Gestures, Vision, Agents Manager (issues #42–#64)

### Integration

| # | Issue | Pri | Status |
|---|---|---|---|
| [#42](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/42) | Widget producers in the engine (run.response.widgets) | p0 | ⬜ |
| [#43](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/43) | Avatar reacts to voice and agent state | p0 | ⬜ |
| [#44](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/44) | Desktop bridge native transport (Tauri commands) | p1 | ⬜ |
| [#45](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/45) | Shared desktop event bus | p1 | ⬜ |

### Gestures

| # | Issue | Pri | Status |
|---|---|---|---|
| [#47](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/47) | Hand-landmark pipeline in the webview (MediaPipe Tasks) | p0 | ⬜ |
| [#48](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/48) | Port gesture classifier to TypeScript | p0 | ⬜ |
| [#49](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/49) | Gesture-to-desktop-action mapping | p1 | ⬜ |
| [#50](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/50) | Gesture settings, calibration and privacy | p2 | ⬜ |

### Vision

| # | Issue | Pri | Status |
|---|---|---|---|
| [#51](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/51) | Screen understanding tool for the agent | p1 | ⬜ |
| [#52](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/52) | Vision-guided click (screen_find / screen_click) | p2 | ⬜ |
| [#53](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/53) | Camera vision app (health counter MVP) | p2 | ⬜ |

### Agents Manager

| # | Issue | Pri | Status |
|---|---|---|---|
| [#54](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/54) | Agent identity contract (engine) | p0 | ⬜ |
| [#55](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/55) | Read-only roster widget (Level 1 MVP) | p0 | ⬜ |
| [#56](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/56) | Orb dressing from roster aggregate state | p1 | ⬜ |
| [#57](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/57) | Roster verbs: pause / resume / cancel / retry | p1 | ⬜ |
| [#58](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/58) | Waiting agents route into InterruptPanel | p1 | ⬜ |
| [#59](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/59) | Scheduled duties in the roster (Level 3 MVP slice) | p2 | ⬜ |
| [#60](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/60) | Agent artifacts linked into Files viewer | p2 | ⬜ |
| [#61](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/61) | Per-agent permissions in the ExecutionGateway | p2 | ⬜ |

### Apps (M2)

| # | Issue | Pri | Status |
|---|---|---|---|
| [#63](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/63) | Weather tool + daily briefing widget | p1 | ⬜ |
| [#64](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/64) | Reminders, calendar automations and background monitors | p1 | ⬜ |
| [#62](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/62) | Music / media control app and tools (Spotify) | p2 | ⬜ |

### Voice (M2)

| # | Issue | Pri | Status |
|---|---|---|---|
| [#46](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/46) | Voice ergonomics: push-to-talk, echo guard, device selection | p2 | ⬜ |

---

## 5. Milestone 3 — Android, Apps, Integration (issues #65–#82)

### Android device ecosystem

| # | Issue | Pri | Status |
|---|---|---|---|
| [#65](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/65) | Nexus Connect gateway (pairing, discovery, capability routing) | p1 | ⬜ |
| [#66](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/66) | Android companion app (Nexus Connect) | p1 | ⬜ |
| [#67](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/67) | Phone UI automation via accessibility service | p2 | ⬜ |
| [#68](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/68) | Mobile autopilot tool | p2 | ⬜ |
| [#69](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/69) | Phone-as-remote dashboard | p2 | ⬜ |
| [#70](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/70) | Smart home integration (provider registry) | p2 | ⬜ |

### Apps (M3)

| # | Issue | Pri | Status |
|---|---|---|---|
| [#71](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/71) | Email and workspace tools (Gmail read/send) | p2 | ⬜ |
| [#72](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/72) | Document builders (pptx / xlsx / docx / pdf) | p2 | ⬜ |
| [#73](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/73) | Notification / attention center | p2 | ⬜ |
| [#74](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/74) | Clipboard sentry + clipboard processor | p2 | ⬜ |
| [#75](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/75) | Proactive engine and sensorium | p2 | ⬜ |
| [#76](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/76) | Geospatial globe widget | p2 | ⬜ |

### Integration (M3)

| # | Issue | Pri | Status |
|---|---|---|---|
| [#78](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/78) | Unified undo + confirmation layers | p1 | ⬜ |
| [#79](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/79) | Memory and identity layer | p1 | ⬜ |
| [#80](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/80) | Learned rules -> policy feedback loop | p2 | ⬜ |
| [#81](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/81) | Updater and packaging pipeline | p2 | ⬜ |

### Spikes & sign-off

| # | Issue | Pri | Status |
|---|---|---|---|
| [#77](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/77) | Skill Forge (self-evolving tools) design spike | p2 | ⬜ |
| [#82](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/82) | Milestone 3 sign-off run-through | p0 | ⬜ |

---

## 6. How to pick issues (if you work on one module)

1. **Find your label.** Filter issues by your module label (see §1), or by the milestone
   label if you're milestone-scoped. The tables above (§3–§5) are grouped exactly this way.
2. **Pick by priority first.** Within your module, take the first open `p0`, then `p1`, then `p2`.
   Don't skip a `p0` to do a `p2` — the priorities map directly to the demo critical path.
3. **Check dependencies before claiming.** Every issue body has a **Dependencies** section.
   An issue is only pickable when its dependencies are closed (or you're doing the fixture-mode
   part explicitly allowed in some bodies, e.g. Tools manager can ship in fixture mode before
   the engine is wired).
4. **Claim it.** Assign yourself on the issue so nobody double-books. Move it on the project
   board (when available) to *In Progress*.
5. **Work to the acceptance criteria.** The `- [ ]` checklist in the issue body IS the
   definition of done. Tick items as you complete them — the checkboxes are live on GitHub.
   Reference the issue in your PR (`Closes #NN` or `Refs #NN`).
6. **Close honestly.** Close the issue only when every AC box is ticked (or the remaining ones
   are explicitly moved into a new issue with a note). Then flip the row's Status in this doc
   (⬜ → ✅) so the index stays accurate.
7. **Sign-off issues are for leads.** Sign-off/test-pass issues (#32, #82, and the per-milestone
   run-throughs) should be executed after their module's issues close, and require a written
   sign-off comment on the issue.

### Module quick-pick cheat sheet

| If you work on... | Start with (M1) | Then (M2) | Later (M3) |
|---|---|---|---|
| Web search | #29, #25, #24 | — (feeds #42) | — |
| OS layout | #32, #30, #31, #26 | apps #63, #62 | #73, #74, #76 |
| Window manager | #33, #28 | — | — |
| Voice | #34, #35, #37, #36 | #46 | #69 |
| Automations | #40, #38, #39 | #64, #42 | #71, #72, #75, #77, #80, #68 |
| Engine↔shell integration | #41 | #43, #45, #44 | #78, #79, #81, #82 |
| Gestures | — | #47, #48, #49, #50 | — |
| Vision | — | #51, #52, #53 | — |
| Agents manager | #27 (optional preview) | #54, #55, #56, #57, #58 | #59, #60, #61 |
| Android ecosystem | — | — | #65, #66, #67, #68, #69, #70 |

### Critical path (demo blockers, in order)

```
M1: #34 (voice decision) → #41 (engine wiring) → #29 (search tools) → #42 (widget producers)
    → #25/#26 (widgets) → #35 → #37 (voice loop) → #32 (layout sign-off)
M2: #54 → #55 → #56/#57/#58 (roster)     #47 → #48 → #49 (gestures) — independent track
M3: #65 → #66 → #67 → #68 (Android)      #82 (sign-off) last
```

---

## 7. Standing notes that apply to many issues

- **Brahma-Ai-Evo reference repo** (`C:\Users\ragha\OneDrive\Documents\Raghav Personal\myProjects\Brahma-Ai-Evo`)
  is **personal-use licensed** — treat it as a *spec*: port concepts and behavior, never copy
  code verbatim. Issues referencing it say "port-as-spec".
- **Known reference-repo defect:** `actions/cmd_control.py` is referenced by the Brahma
  planner/executor but does not exist there — anything citing it is spec-only.
- **Wake word:** the reference implementation is transcript-matching only and intentionally
  NOT ported; design a real one later (see #46).
- **One orchestrator principle:** new task/runtime features must compose with the existing
  LangGraph AI-Core (gateway, policy, graphs) — not introduce a competing orchestrator.

## 8. Related pre-existing issues

Issues #1–#9 are the search team's original work (mostly closed). Two remain open and
cross-reference the M1 backlog: #8 (Connect Search & Discover to the Backend) and #9
(Expose Web Search as an AI Agent Tool) — covered by #41 and #29 respectively.

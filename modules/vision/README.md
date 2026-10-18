# Vision Module (Cross-Cutting)

## Purpose
MediaPipe Tasks Vision pipeline for spatial hand tracking (open palm, pinch, swipe, closed fist) interpreted within the webview pipeline.

## Tech Stack
- MediaPipe Tasks Vision (WebAssembly / WebGL)

## Folder Layout
```
modules/vision/
├── gestures.ts          # Gesture classification constants
└── README.md
```

## How to Run
Initialized via `apps/shell/frontend/src/vision/index.ts`.

## How to Add a Feature
Add a gesture to `gestures.ts` and wire a handler in `src/hooks/useGesture.ts`.

## IPC / API Contracts
Emits gesture events consumed by `useGesture`.

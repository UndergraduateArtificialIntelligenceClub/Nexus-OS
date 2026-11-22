import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { installMatchMedia } from './a11y'

// jsdom has no matchMedia; every motion/theme contract reads it. Install the stub
// before any component renders.
installMatchMedia()

// jsdom has neither observer either. Library surfaces that use them (ScrollArea,
// media) must still mount; tests that need to fire entries install their own
// controllable class over these.
if (typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
if (typeof window.IntersectionObserver === 'undefined') {
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  } as unknown as typeof IntersectionObserver
}

// jsdom 25 has no PointerEvent, so fireEvent.pointer* would drop clientX, button
// and pointerId. A MouseEvent with the pointer fields is enough for scrubbing tests.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventStub extends MouseEvent {
    readonly pointerId: number
    readonly pointerType: string
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 0
      this.pointerType = init.pointerType ?? 'mouse'
    }
  }
  window.PointerEvent = PointerEventStub as unknown as typeof PointerEvent
}

// Vitest runs without globals, so Testing Library can't auto-register cleanup.
afterEach(() => cleanup())

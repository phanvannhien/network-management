import './src/i18n'
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

// jsdom lacks scrollIntoView (cmdk scrolls the active option into view).
Element.prototype.scrollIntoView ??= function scrollIntoView() {}

// jsdom lacks ResizeObserver (React Flow). Tests stub a richer one per test; this fallback stays when they unstub, so a
// canvas that finishes loading after its test ended does not throw into the next one.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

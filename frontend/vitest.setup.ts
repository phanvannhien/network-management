import './src/i18n'
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

// jsdom lacks scrollIntoView (cmdk scrolls the active option into view).
Element.prototype.scrollIntoView ??= function scrollIntoView() {}

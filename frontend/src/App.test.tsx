import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App'

// React Flow needs ResizeObserver and client rect geometry, which jsdom lacks.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverMock)
vi.stubGlobal(
  'DOMMatrixReadOnly',
  class {
    m22 = 1
    constructor() {}
  },
)

describe('App', () => {
  it('renders the canvas without crashing', () => {
    const { container } = render(<App />)
    expect(container.querySelector('.react-flow')).toBeInTheDocument()
  })
})

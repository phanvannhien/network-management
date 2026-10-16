import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from './App'

// React Flow needs ResizeObserver and client rect geometry, which jsdom lacks.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  vi.stubGlobal(
    'DOMMatrixReadOnly',
    class {
      m22 = 1
      constructor() {}
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('App', () => {
  it('home page shows the API health from /api/healthz', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: 'ok', version: 'test' }))),
    )
    renderAt('/')
    expect(await screen.findByText('API: ok · test')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/healthz')
  })

  it('home page reports an unreachable API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 502 })),
    )
    renderAt('/')
    expect(await screen.findByText(/không kết nối được/)).toBeInTheDocument()
  })

  it('editor route renders the canvas', () => {
    const { container } = renderAt('/editor')
    expect(container.querySelector('.react-flow')).toBeInTheDocument()
  })
})

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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('App', () => {
  it('home page shows the API health from the generated client', async () => {
    const fetchMock = vi.fn(async (_request: Request) =>
      jsonResponse({ status: 'ok', version: 'test', database: 'ok' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderAt('/')
    expect(await screen.findByText('API: ok · test · DB ok')).toBeInTheDocument()
    expect(new URL(fetchMock.mock.calls[0][0].url).pathname).toBe('/api/healthz')
  })

  it('home page shows degraded status when the database is down (503)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ status: 'degraded', version: 'test', database: 'unavailable' }, 503),
      ),
    )
    renderAt('/')
    expect(await screen.findByText('API: degraded · test · DB unavailable')).toBeInTheDocument()
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

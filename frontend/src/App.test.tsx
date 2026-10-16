import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from './App'
import { setCsrfToken } from './api/client'

// React Flow needs ResizeObserver and client rect geometry, which jsdom lacks.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const SESSION = {
  csrfToken: 'csrf-123',
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'admin@example.com',
    displayName: 'Admin',
    isSystemAdmin: true,
  },
  // Admin with MFA enrolled and verified this session → full access.
  mfa: { enabled: true, verified: true, required: true },
}

const withMfa = (mfa: { enabled: boolean; verified: boolean; required: boolean }) => ({
  ...SESSION,
  mfa,
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Minimal fake API keyed by "METHOD /path"; records every request. */
function fakeApi(routes: Record<string, () => Response>) {
  const calls: Request[] = []
  const fetchMock = vi.fn(async (request: Request) => {
    calls.push(request)
    const key = `${request.method} ${new URL(request.url).pathname}`
    const handler = routes[key]
    return handler ? handler() : new Response('', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

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

beforeEach(() => {
  setCsrfToken(null)
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

describe('auth guard', () => {
  it('redirects to the login page when there is no session', async () => {
    fakeApi({ 'GET /api/auth/me': () => json({ message: 'Chưa đăng nhập' }, 401) })
    renderAt('/editor')
    expect(await screen.findByRole('heading', { name: 'Đăng nhập' })).toBeInTheDocument()
  })

  it('shows the home page with user and API health when signed in', async () => {
    fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      'GET /api/healthz': () => json({ status: 'ok', version: 'test', database: 'ok' }),
    })
    renderAt('/')
    expect(await screen.findByText('Admin')).toBeInTheDocument()
    expect(await screen.findByText('API: ok · test · DB ok')).toBeInTheDocument()
  })

  it('shows degraded health when the database is down (503)', async () => {
    fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      'GET /api/healthz': () =>
        json({ status: 'degraded', version: 'test', database: 'unavailable' }, 503),
    })
    renderAt('/')
    expect(await screen.findByText('API: degraded · test · DB unavailable')).toBeInTheDocument()
  })

  it('renders the editor for a signed-in user', async () => {
    fakeApi({ 'GET /api/auth/me': () => json(SESSION) })
    const { container } = renderAt('/editor')
    await waitFor(() => expect(container.querySelector('.react-flow')).toBeInTheDocument())
  })
})

describe('login page', () => {
  it('signs in and continues to the requested page', async () => {
    let signedIn = false
    const calls = fakeApi({
      'GET /api/auth/me': () => (signedIn ? json(SESSION) : json({ message: 'x' }, 401)),
      'POST /api/auth/login': () => {
        signedIn = true
        return json(SESSION)
      },
      'GET /api/healthz': () => json({ status: 'ok', version: 'test', database: 'ok' }),
    })
    renderAt('/login?next=/')
    fireEvent.change(await screen.findByLabelText('Email'), {
      target: { value: 'admin@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'a-strong-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }))

    expect(await screen.findByText('Admin')).toBeInTheDocument()
    const loginCall = calls.find((r) => r.method === 'POST')!
    expect(await loginCall.clone().json()).toEqual({
      email: 'admin@example.com',
      password: 'a-strong-password',
    })
  })

  it('shows the server message on wrong credentials', async () => {
    fakeApi({
      'GET /api/auth/me': () => json({ message: 'x' }, 401),
      'POST /api/auth/login': () =>
        json({ message: 'Email hoặc mật khẩu không đúng, hoặc tài khoản đang tạm khóa' }, 401),
    })
    renderAt('/login')
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'a@b.co' } })
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'wrong-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('không đúng')
  })

  it('ignores external ?next= targets (no open redirect)', async () => {
    fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      'GET /api/healthz': () => json({ status: 'ok', version: 'test', database: 'ok' }),
    })
    renderAt('/login?next=//evil.example/phish')
    // Already signed in: redirected to "/" instead of the external URL.
    expect(await screen.findByText('Admin')).toBeInTheDocument()
  })
})

describe('logout', () => {
  it('sends the CSRF token and returns to the login page', async () => {
    let signedIn = true
    const calls = fakeApi({
      'GET /api/auth/me': () => (signedIn ? json(SESSION) : json({ message: 'x' }, 401)),
      'GET /api/healthz': () => json({ status: 'ok', version: 'test', database: 'ok' }),
      'POST /api/auth/logout': () => {
        signedIn = false
        return new Response(null, { status: 204 })
      },
    })
    renderAt('/')
    fireEvent.click(await screen.findByRole('button', { name: 'Đăng xuất' }))
    expect(await screen.findByRole('heading', { name: 'Đăng nhập' })).toBeInTheDocument()
    const logoutCall = calls.find((r) => r.method === 'POST')!
    expect(logoutCall.headers.get('X-CSRF-Token')).toBe('csrf-123')
  })
})

describe('MFA', () => {
  it('sends a session that still owes a code to /mfa, then on to the requested page', async () => {
    let verified = false
    const calls = fakeApi({
      'GET /api/auth/me': () => json(withMfa({ enabled: true, verified, required: true })),
      'POST /api/auth/mfa/verify': () => {
        verified = true
        return json(withMfa({ enabled: true, verified: true, required: true }))
      },
      'GET /api/healthz': () => json({ status: 'ok', version: 'test', database: 'ok' }),
    })
    renderAt('/')
    expect(await screen.findByRole('heading', { name: 'Xác thực hai lớp' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Mã 6 số từ ứng dụng xác thực'), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }))
    expect(await screen.findByText('Admin')).toBeInTheDocument()
    const verifyCall = calls.find((r) => r.url.endsWith('/auth/mfa/verify'))!
    expect(await verifyCall.clone().json()).toEqual({ code: '123456' })
    expect(verifyCall.headers.get('X-CSRF-Token')).toBe('csrf-123')
  })

  it('can verify with a recovery code instead', async () => {
    const calls = fakeApi({
      'GET /api/auth/me': () => json(withMfa({ enabled: true, verified: false, required: true })),
      'POST /api/auth/mfa/verify': () =>
        json({ message: 'Mã không đúng, đã hết hạn hoặc đã được dùng' }, 401),
    })
    renderAt('/mfa')
    fireEvent.click(await screen.findByRole('button', { name: 'Dùng mã khôi phục' }))
    fireEvent.change(screen.getByLabelText('Mã khôi phục'), {
      target: { value: 'ABCD-EFGH-IJKL-MNOP' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('đã được dùng')
    const verifyCall = calls.find((r) => r.url.endsWith('/auth/mfa/verify'))!
    expect(await verifyCall.clone().json()).toEqual({ recoveryCode: 'ABCD-EFGH-IJKL-MNOP' })
  })

  it('forces admins without MFA through setup and shows recovery codes once', async () => {
    let enabled = false
    fakeApi({
      'GET /api/auth/me': () => json(withMfa({ enabled, verified: enabled, required: true })),
      'POST /api/auth/mfa/setup': () =>
        json({
          secret: 'JBSWY3DPEHPK3PXP',
          otpauthUrl: 'otpauth://totp/x',
          qrCode: 'data:image/png;base64,AAAA',
        }),
      'POST /api/auth/mfa/enable': () => {
        enabled = true
        return json({ recoveryCodes: ['AAAA-BBBB-CCCC-DDDD', 'EEEE-FFFF-GGGG-HHHH'] })
      },
      'GET /api/healthz': () => json({ status: 'ok', version: 'test', database: 'ok' }),
    })
    renderAt('/editor')
    expect(
      await screen.findByRole('heading', { name: 'Thiết lập xác thực hai lớp' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/bắt buộc dùng MFA/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu' }))
    expect(await screen.findByAltText('Mã QR thiết lập MFA')).toBeInTheDocument()
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Nhập mã 6 số/), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: 'Bật MFA' }))

    // Codes stay on screen even though the session now reports MFA enabled.
    expect(await screen.findByRole('heading', { name: 'Lưu mã khôi phục' })).toBeInTheDocument()
    expect(screen.getByText('AAAA-BBBB-CCCC-DDDD')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Tôi đã lưu mã, tiếp tục' }))
    await waitFor(() => expect(document.body.querySelector('.react-flow')).toBeInTheDocument())
  })

  it('lets non-admin users with MFA off reach the app, with an enable link', async () => {
    fakeApi({
      'GET /api/auth/me': () =>
        json({
          ...withMfa({ enabled: false, verified: false, required: false }),
          user: { ...SESSION.user, isSystemAdmin: false },
        }),
      'GET /api/healthz': () => json({ status: 'ok', version: 'test', database: 'ok' }),
    })
    renderAt('/')
    expect(await screen.findByRole('link', { name: 'Bật xác thực hai lớp' })).toBeInTheDocument()
  })
})

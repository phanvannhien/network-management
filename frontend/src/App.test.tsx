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
  activeOrganizationId: null,
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

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const ORG_VIEW = {
  organization: {
    id: ORG_ID,
    name: 'Văn phòng mẫu',
    kind: 'internal',
    notes: '',
    version: 1,
    createdAt: '2026-10-16T00:00:00Z',
    updatedAt: '2026-10-16T00:00:00Z',
  },
  membership: { role: 'owner', permissions: [] },
}

/** Organization endpoints most pages need; individual tests override keys as required. */
const ORG_ROUTES: Record<string, () => Response> = {
  'GET /api/orgs': () =>
    json({
      organizations: [{ id: ORG_ID, name: 'Văn phòng mẫu', kind: 'internal', role: 'owner' }],
    }),
  [`GET /api/orgs/${ORG_ID}`]: () => json(ORG_VIEW),
  [`POST /api/orgs/${ORG_ID}/activate`]: () => new Response(null, { status: 204 }),
}

/** Minimal fake API keyed by "METHOD /path"; records every request. */
function fakeApi(routes: Record<string, () => Response>) {
  const calls: Request[] = []
  const all = { ...ORG_ROUTES, ...routes }
  const fetchMock = vi.fn(async (request: Request) => {
    calls.push(request)
    const key = `${request.method} ${new URL(request.url).pathname}`
    const handler = all[key]
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

describe('organizations', () => {
  it('opens the remembered organization and records it as active', async () => {
    const calls = fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      'GET /api/healthz': () => json({ status: 'ok', version: 'test', database: 'ok' }),
    })
    renderAt('/')
    expect(await screen.findByRole('heading', { name: 'Văn phòng mẫu' })).toBeInTheDocument()
    expect(screen.getByText(/Vai trò của bạn: Owner/)).toBeInTheDocument()
    await waitFor(() =>
      expect(calls.some((r) => r.url.endsWith(`/orgs/${ORG_ID}/activate`))).toBe(true),
    )
  })

  it('explains when the user has no organization yet', async () => {
    fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      'GET /api/orgs': () => json({ organizations: [] }),
    })
    renderAt('/')
    expect(
      await screen.findByRole('heading', { name: 'Bạn chưa thuộc tổ chức nào' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Quản trị tổ chức' })).toBeInTheDocument()
  })

  it('shows "not found" for organizations the user cannot access', async () => {
    fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      'GET /api/healthz': () => json({ status: 'ok', version: 'test', database: 'ok' }),
    })
    renderAt('/o/22222222-2222-4222-8222-222222222222')
    expect(
      await screen.findByRole('heading', { name: 'Không tìm thấy tổ chức' }),
    ).toBeInTheDocument()
  })

  it('owner renames the organization; a 409 is explained', async () => {
    let attempt = 0
    const calls = fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      'GET /api/healthz': () => json({ status: 'ok', version: 'test', database: 'ok' }),
      [`PATCH /api/orgs/${ORG_ID}`]: () =>
        ++attempt === 1
          ? json(
              {
                message:
                  'Tổ chức vừa được người khác sửa. Tải lại để xem bản mới nhất rồi sửa lại.',
              },
              409,
            )
          : json({
              ...ORG_VIEW,
              organization: { ...ORG_VIEW.organization, name: 'Công ty A', version: 2 },
            }),
    })
    renderAt(`/o/${ORG_ID}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa thông tin' }))
    fireEvent.change(screen.getByLabelText('Tên tổ chức'), { target: { value: 'Công ty A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('người khác sửa')

    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    expect(await screen.findByRole('heading', { name: 'Công ty A' })).toBeInTheDocument()
    const patch = calls.find((r) => r.method === 'PATCH')!
    expect(await patch.clone().json()).toEqual({ name: 'Công ty A', notes: '', version: 1 })
    expect(patch.headers.get('X-CSRF-Token')).toBe('csrf-123')
  })
})

describe('admin organizations', () => {
  it('system admin creates an organization', async () => {
    const calls = fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      'GET /api/admin/organizations': () =>
        json({
          organizations: [
            {
              id: ORG_ID,
              name: 'Văn phòng mẫu',
              kind: 'internal',
              notes: '',
              memberCount: 3,
              createdAt: '2026-10-16T00:00:00Z',
              version: 1,
            },
          ],
        }),
      'POST /api/admin/organizations': () =>
        json(
          {
            id: 'x',
            name: 'Khách hàng C',
            kind: 'customer',
            notes: '',
            memberCount: 1,
            createdAt: '2026-10-16T00:00:00Z',
            version: 1,
          },
          201,
        ),
    })
    renderAt('/admin/organizations')
    expect(await screen.findByText('Văn phòng mẫu')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Tên'), { target: { value: 'Khách hàng C' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tạo' }))
    await waitFor(() =>
      expect(calls.some((r) => r.method === 'POST' && r.url.endsWith('/admin/organizations'))).toBe(
        true,
      ),
    )
    const post = calls.find((r) => r.method === 'POST' && r.url.endsWith('/admin/organizations'))!
    expect(await post.clone().json()).toEqual({
      name: 'Khách hàng C',
      kind: 'customer',
      notes: '',
      addMeAsOwner: true,
    })
  })

  it('non-admins are sent away from the admin page', async () => {
    fakeApi({
      'GET /api/auth/me': () =>
        json({
          ...SESSION,
          user: { ...SESSION.user, isSystemAdmin: false },
          mfa: { enabled: true, verified: true, required: true },
        }),
      'GET /api/healthz': () => json({ status: 'ok', version: 'test', database: 'ok' }),
    })
    renderAt('/admin/organizations')
    expect(await screen.findByRole('heading', { name: 'Văn phòng mẫu' })).toBeInTheDocument()
  })
})

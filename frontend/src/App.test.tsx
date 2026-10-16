import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from './App'
import { setCsrfToken } from './api/client'
import { setLanguage } from './i18n'

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
  expiresAt: '2099-01-01T00:00:00Z',
}

const HEALTH = { status: 'ok', version: 'test', environment: 'development', database: 'ok' }

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

  it('shows the home page inside the shell with a badge outside production', async () => {
    fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      'GET /api/healthz': () => json(HEALTH),
    })
    renderAt('/')
    expect(await screen.findByText('Xin chào Admin')).toBeInTheDocument()
    expect(await screen.findByText('Development')).toBeInTheDocument()
    // The organization is always named in the topbar, even with a single membership.
    expect(screen.getByLabelText('Tổ chức hiện tại: Văn phòng mẫu')).toBeInTheDocument()
    expect(screen.queryByText(/API:/)).not.toBeInTheDocument()
  })

  it('hides the environment badge in production', async () => {
    fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      'GET /api/healthz': () => json({ ...HEALTH, environment: 'production' }),
    })
    renderAt('/')
    expect(await screen.findByText('Xin chào Admin')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Development')).not.toBeInTheDocument())
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
      'GET /api/healthz': () => json(HEALTH),
    })
    renderAt('/login?next=/')
    fireEvent.change(await screen.findByLabelText('Email'), {
      target: { value: 'admin@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'a-strong-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }))

    expect(await screen.findByText('Xin chào Admin')).toBeInTheDocument()
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
      'GET /api/healthz': () => json(HEALTH),
    })
    renderAt('/login?next=//evil.example/phish')
    // Already signed in: redirected to "/" instead of the external URL.
    expect(await screen.findByText('Xin chào Admin')).toBeInTheDocument()
  })
})

describe('logout', () => {
  it('sends the CSRF token and returns to the login page', async () => {
    let signedIn = true
    const calls = fakeApi({
      'GET /api/auth/me': () => (signedIn ? json(SESSION) : json({ message: 'x' }, 401)),
      'GET /api/healthz': () => json(HEALTH),
      'POST /api/auth/logout': () => {
        signedIn = false
        return new Response(null, { status: 204 })
      },
    })
    renderAt('/')
    fireEvent.click(await screen.findByRole('button', { name: 'Tài khoản: Admin' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Đăng xuất' }))
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
      'GET /api/healthz': () => json(HEALTH),
    })
    renderAt('/')
    expect(await screen.findByRole('heading', { name: 'Xác thực hai lớp' })).toBeInTheDocument()
    // The sixth digit submits on its own (no button press).
    fireEvent.change(screen.getByLabelText('Mã 6 số từ ứng dụng xác thực'), {
      target: { value: '123 456' },
    })
    expect(await screen.findByText('Xin chào Admin')).toBeInTheDocument()
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
      'GET /api/healthz': () => json(HEALTH),
    })
    renderAt('/editor')
    expect(
      await screen.findByRole('heading', { name: 'Thiết lập xác thực hai lớp' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/bắt buộc dùng MFA/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu' }))
    expect(await screen.findByAltText('Mã QR thiết lập MFA')).toBeInTheDocument()
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Nhập mã 6 số/), { target: { value: '654321' } })

    // Codes stay on screen even though the session now reports MFA enabled.
    expect(await screen.findByRole('heading', { name: 'Lưu mã khôi phục' })).toBeInTheDocument()
    expect(screen.getByText('AAAA-BBBB-CCCC-DDDD')).toBeInTheDocument()
    // Continue stays disabled until the user confirms the codes were saved.
    const cont = screen.getByRole('button', { name: 'Tiếp tục' })
    expect(cont).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tôi đã lưu mã khôi phục ở nơi an toàn' }))
    await waitFor(() => expect(cont).toBeEnabled())
    fireEvent.click(cont)
    await waitFor(() => expect(document.body.querySelector('.react-flow')).toBeInTheDocument())
  })

  it('lets non-admin users with MFA off reach the app, with an enable link', async () => {
    fakeApi({
      'GET /api/auth/me': () =>
        json({
          ...withMfa({ enabled: false, verified: false, required: false }),
          user: { ...SESSION.user, isSystemAdmin: false },
        }),
      'GET /api/healthz': () => json(HEALTH),
    })
    renderAt('/')
    expect(await screen.findByRole('link', { name: 'Bật xác thực hai lớp' })).toBeInTheDocument()
  })
})

describe('organizations', () => {
  it('opens the remembered organization and records it as active', async () => {
    const calls = fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      'GET /api/healthz': () => json(HEALTH),
    })
    renderAt('/')
    expect(await screen.findByRole('heading', { name: 'Văn phòng mẫu' })).toBeInTheDocument()
    const panel = screen.getByRole('region', { name: 'Tổ chức' })
    expect(within(panel).getByText('Vai trò của bạn').nextElementSibling).toHaveTextContent('Owner')
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
      'GET /api/healthz': () => json(HEALTH),
    })
    renderAt('/o/22222222-2222-4222-8222-222222222222')
    expect(await screen.findByRole('heading', { name: 'Không tìm thấy trang' })).toBeInTheDocument()
  })

  it('owner renames the organization; a 409 is explained', async () => {
    let attempt = 0
    const calls = fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      'GET /api/healthz': () => json(HEALTH),
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
    fireEvent.click(screen.getByRole('button', { name: 'Tạo tổ chức' }))
    fireEvent.change(await screen.findByLabelText('Tên'), { target: { value: 'Khách hàng C' } })
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

  it('deleting an organization requires typing its name', async () => {
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
      [`DELETE /api/admin/organizations/${ORG_ID}`]: () => new Response(null, { status: 204 }),
    })
    renderAt('/admin/organizations')
    fireEvent.click(await screen.findByRole('button', { name: 'Thao tác cho Văn phòng mẫu' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Xóa tổ chức' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Xóa tổ chức Văn phòng mẫu?' })
    expect(within(dialog).getByText('3 thành viên mất quyền truy cập')).toBeInTheDocument()
    const confirm = within(dialog).getByRole('button', { name: 'Xóa tổ chức' })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText(/Gõ chính xác/), {
      target: { value: 'Văn phòng mẫu' },
    })
    fireEvent.click(confirm)
    await waitFor(() => expect(calls.some((r) => r.method === 'DELETE')).toBe(true))
  })

  it('non-admins are sent away from the admin page', async () => {
    fakeApi({
      'GET /api/auth/me': () =>
        json({
          ...SESSION,
          user: { ...SESSION.user, isSystemAdmin: false },
          mfa: { enabled: true, verified: true, required: true },
        }),
      'GET /api/healthz': () => json(HEALTH),
    })
    renderAt('/admin/organizations')
    expect(await screen.findByRole('heading', { name: 'Văn phòng mẫu' })).toBeInTheDocument()
  })
})

const MEMBER = {
  userId: '00000000-0000-4000-8000-000000000002',
  email: 'viewer@example.com',
  displayName: 'Viewer',
  role: 'viewer',
  permissions: [],
  mfaEnabled: false,
  disabled: false,
  pendingInvite: false,
  version: 1,
}

describe('members', () => {
  it('owner invites a new member and sees the one-time link', async () => {
    const calls = fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      [`GET /api/orgs/${ORG_ID}/members`]: () => json({ members: [MEMBER] }),
      [`POST /api/orgs/${ORG_ID}/members`]: () =>
        json(
          {
            member: {
              ...MEMBER,
              userId: 'n',
              email: 'new@example.com',
              displayName: '',
              pendingInvite: true,
            },
            inviteToken: 'tok123',
          },
          201,
        ),
    })
    renderAt(`/o/${ORG_ID}/members`)
    expect(await screen.findByText('viewer@example.com')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Mời thành viên' }))
    fireEvent.change(await screen.findByLabelText('Email'), {
      target: { value: 'new@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }))
    expect(await screen.findByText(/\/invite\/tok123$/)).toBeInTheDocument()
    const post = calls.find((r) => r.method === 'POST' && r.url.endsWith('/members'))!
    expect(await post.clone().json()).toEqual({
      email: 'new@example.com',
      role: 'viewer',
      permissions: [],
    })
  })

  it('changing a role sends the version for the optimistic lock', async () => {
    const calls = fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      [`GET /api/orgs/${ORG_ID}/members`]: () => json({ members: [MEMBER] }),
      [`PATCH /api/orgs/${ORG_ID}/members/${MEMBER.userId}`]: () =>
        json({ ...MEMBER, role: 'editor', version: 2 }),
    })
    renderAt(`/o/${ORG_ID}/members`)
    fireEvent.click(await screen.findByRole('button', { name: 'Thao tác cho viewer@example.com' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sửa vai trò và quyền' }))
    fireEvent.change(await screen.findByLabelText('Vai trò của viewer@example.com'), {
      target: { value: 'editor' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Xem mật khẩu' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }))
    await waitFor(() => expect(calls.some((r) => r.method === 'PATCH')).toBe(true))
    const patch = calls.find((r) => r.method === 'PATCH')!
    expect(await patch.clone().json()).toEqual({
      role: 'editor',
      permissions: ['credential.reveal'],
      version: 1,
    })
  })

  it('removing a member asks for confirmation first', async () => {
    const calls = fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      [`GET /api/orgs/${ORG_ID}/members`]: () => json({ members: [MEMBER] }),
      [`DELETE /api/orgs/${ORG_ID}/members/${MEMBER.userId}`]: () =>
        new Response(null, { status: 204 }),
    })
    renderAt(`/o/${ORG_ID}/members`)
    fireEvent.click(await screen.findByRole('button', { name: 'Thao tác cho viewer@example.com' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Gỡ khỏi tổ chức' }))
    expect(
      await screen.findByRole('alertdialog', { name: 'Gỡ viewer@example.com khỏi tổ chức?' }),
    ).toBeInTheDocument()
    expect(calls.some((r) => r.method === 'DELETE')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Gỡ khỏi tổ chức' }))
    await waitFor(() => expect(calls.some((r) => r.method === 'DELETE')).toBe(true))
  })

  it('viewers see the list without management controls', async () => {
    fakeApi({
      'GET /api/auth/me': () =>
        json({ ...SESSION, user: { ...SESSION.user, isSystemAdmin: false } }),
      [`GET /api/orgs/${ORG_ID}`]: () =>
        json({ ...ORG_VIEW, membership: { role: 'viewer', permissions: [] } }),
      [`GET /api/orgs/${ORG_ID}/members`]: () => json({ members: [MEMBER] }),
    })
    renderAt(`/o/${ORG_ID}/members`)
    expect(await screen.findByText('viewer@example.com')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mời thành viên' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Thao tác cho viewer@example.com' }),
    ).not.toBeInTheDocument()
  })
})

describe('accept invite', () => {
  it('activates the account from a one-time link without signing in', async () => {
    const calls = fakeApi({
      'GET /api/account-tokens/tok123': () =>
        json({ email: 'new@example.com', purpose: 'invite', organizations: ['Văn phòng mẫu'] }),
      'POST /api/account-tokens/tok123': () => new Response(null, { status: 204 }),
    })
    renderAt('/invite/tok123')
    expect(await screen.findByRole('heading', { name: 'Kích hoạt tài khoản' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Họ tên'), { target: { value: 'Người Mới' } })
    fireEvent.change(screen.getByLabelText(/Mật khẩu mới/), {
      target: { value: 'a-strong-password' },
    })
    fireEvent.change(screen.getByLabelText('Nhập lại mật khẩu'), {
      target: { value: 'different-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Kích hoạt' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('không khớp')

    fireEvent.change(screen.getByLabelText('Nhập lại mật khẩu'), {
      target: { value: 'a-strong-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Kích hoạt' }))
    expect(await screen.findByRole('heading', { name: 'Hoàn tất' })).toBeInTheDocument()
    const post = calls.find((r) => r.method === 'POST')!
    expect(await post.clone().json()).toEqual({
      displayName: 'Người Mới',
      password: 'a-strong-password',
    })
  })

  it('explains an invalid or used link', async () => {
    fakeApi({
      'GET /api/account-tokens/old': () =>
        json({ message: 'Link không hợp lệ, đã dùng hoặc đã hết hạn' }, 404),
    })
    renderAt('/invite/old')
    expect(await screen.findByRole('heading', { name: 'Link không dùng được' })).toBeInTheDocument()
  })
})

const ADMIN_USER = {
  id: 'u1',
  email: 'ed@example.com',
  displayName: 'Ed',
  isSystemAdmin: false,
  mfaEnabled: true,
  disabled: false,
  pendingInvite: false,
  organizationCount: 1,
  createdAt: '2026-10-16T00:00:00Z',
}

describe('admin users', () => {
  it('issues a password-reset link', async () => {
    fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      'GET /api/admin/users': () =>
        json({
          users: [
            {
              id: 'u1',
              email: 'ed@example.com',
              displayName: 'Ed',
              isSystemAdmin: false,
              mfaEnabled: true,
              disabled: false,
              pendingInvite: false,
              organizationCount: 1,
              createdAt: '2026-10-16T00:00:00Z',
            },
          ],
        }),
      'POST /api/admin/users/u1/password-reset': () => json({ resetToken: 'reset456' }),
    })
    renderAt('/admin/users')
    fireEvent.click(await screen.findByRole('button', { name: 'Thao tác cho ed@example.com' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Link đặt lại mật khẩu' }))
    expect(await screen.findByText(/\/invite\/reset456$/)).toBeInTheDocument()
  })

  it('disabling a user asks for confirmation', async () => {
    const calls = fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      'GET /api/admin/users': () => json({ users: [ADMIN_USER] }),
      'POST /api/admin/users/u1/disable': () => new Response(null, { status: 204 }),
    })
    renderAt('/admin/users')
    fireEvent.click(await screen.findByRole('button', { name: 'Thao tác cho ed@example.com' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Vô hiệu hóa' }))
    await screen.findByRole('alertdialog', { name: 'Vô hiệu hóa ed@example.com?' })
    expect(calls.some((r) => r.url.endsWith('/disable'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Vô hiệu hóa' }))
    await waitFor(() => expect(calls.some((r) => r.url.endsWith('/disable'))).toBe(true))
  })
})

describe('system health', () => {
  it('shows API and database state for system admins', async () => {
    fakeApi({ 'GET /api/auth/me': () => json(SESSION), 'GET /api/healthz': () => json(HEALTH) })
    renderAt('/admin/health')
    expect(await screen.findByRole('heading', { name: 'Tình trạng hệ thống' })).toBeInTheDocument()
    expect(await screen.findAllByText('Hoạt động')).toHaveLength(2)
    expect(screen.getByText('development')).toBeInTheDocument()
  })

  it('reports a database outage (503 still carries the body)', async () => {
    fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      'GET /api/healthz': () =>
        json({ ...HEALTH, status: 'degraded', database: 'unavailable' }, 503),
    })
    renderAt('/admin/health')
    expect(await screen.findByText('Suy giảm')).toBeInTheDocument()
    expect(screen.getByText('Không kết nối được')).toBeInTheDocument()
  })
})

describe('app shell and device pages', () => {
  it('lists sample devices with server-style search and opens a device', async () => {
    fakeApi({ 'GET /api/auth/me': () => json(SESSION), 'GET /api/healthz': () => json(HEALTH) })
    renderAt(`/o/${ORG_ID}/devices`)
    expect(await screen.findByRole('heading', { name: 'Thiết bị' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'AP-DN-01' })).toBeInTheDocument()
    // Hostname is a regular-weight sans link, IPs are mono.
    expect(screen.getByRole('link', { name: 'AP-DN-01' }).className).not.toMatch(/font-mono/)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Tìm kiếm' }), {
      target: { value: 'FW-HQ' },
    })
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'AP-DN-01' })).not.toBeInTheDocument(),
    )
    fireEvent.click(await screen.findByRole('link', { name: 'FW-HQ-01' }))
    expect(await screen.findByRole('heading', { name: 'FW-HQ-01' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Vị trí trang' })).toHaveTextContent('Thiết bị')
  })

  it('opens the interfaces tab from ?tab= and masks credentials', async () => {
    fakeApi({ 'GET /api/auth/me': () => json(SESSION), 'GET /api/healthz': () => json(HEALTH) })
    renderAt(`/o/${ORG_ID}/devices/dev-hq-sw-acc-01?tab=interfaces`)
    expect(await screen.findByRole('heading', { name: 'SW-ACC-HQ-01' })).toBeInTheDocument()
    expect(screen.getByText('Gi1/0/1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Truy cập' }))
    expect(await screen.findByText(/Mật khẩu SSH: Đã che/)).toBeInTheDocument()
    expect(screen.queryByText('Sample-Ssh-Pa55w0rd')).not.toBeInTheDocument()
  })

  it('marks the system area with its own band and label', async () => {
    fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      'GET /api/healthz': () => json(HEALTH),
      'GET /api/admin/users': () => json({ users: [] }),
    })
    renderAt('/admin/users')
    expect(await screen.findByText('Khu vực hệ thống')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Tổ chức hiện tại/)).not.toBeInTheDocument()
  })

  it('collapses the sidebar to icons below 1440px', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    fakeApi({ 'GET /api/auth/me': () => json(SESSION), 'GET /api/healthz': () => json(HEALTH) })
    renderAt(`/o/${ORG_ID}`)
    expect(await screen.findByRole('button', { name: 'Mở rộng menu' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' })
    expect(within(nav).getByRole('link', { name: 'Thiết bị' })).toBeInTheDocument() // icon link keeps its name
  })

  it('Ctrl+K opens the command palette and jumps to a device', async () => {
    fakeApi({ 'GET /api/auth/me': () => json(SESSION), 'GET /api/healthz': () => json(HEALTH) })
    renderAt(`/o/${ORG_ID}`)
    await screen.findByText('Xin chào Admin')
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const input = await screen.findByPlaceholderText('Gõ tên trang, hostname, IP…')
    fireEvent.change(input, { target: { value: '10.72.114.1' } })
    fireEvent.click(await screen.findByRole('option', { name: /FW-HQ-01/ }))
    expect(await screen.findByRole('heading', { name: 'FW-HQ-01' })).toBeInTheDocument()
  })

  it('shows a 404 page for unknown addresses', async () => {
    fakeApi({})
    renderAt('/no-such-page')
    expect(await screen.findByRole('heading', { name: 'Không tìm thấy trang' })).toBeInTheDocument()
  })
})

const AUDIT_ENTRY = {
  id: 42,
  createdAt: '2026-10-16T02:03:04Z',
  actor: { id: SESSION.user.id, email: 'admin@example.com', displayName: 'Admin' },
  action: 'member.update',
  objectType: 'user',
  objectId: '00000000-0000-4000-8000-000000000002',
  before: { email: 'viewer@example.com', role: 'viewer', permissions: [] },
  after: { email: 'viewer@example.com', role: 'editor', permissions: [] },
  ip: '10.0.0.5',
  userAgent: 'Mozilla/5.0',
  requestId: 'req-1',
}

describe('audit log', () => {
  it('lists organization events and shows before/after with changed fields', async () => {
    const calls = fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      [`GET /api/orgs/${ORG_ID}/members`]: () => json({ members: [MEMBER] }),
      [`GET /api/orgs/${ORG_ID}/audit`]: () =>
        json({ entries: [AUDIT_ENTRY], total: 1, page: 1, pageSize: 50 }),
    })
    renderAt(`/o/${ORG_ID}/audit`)
    expect(await screen.findByText('Đổi vai trò/quyền')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Chi tiết #42' }))
    const sheet = await screen.findByRole('dialog', { name: 'Chi tiết sự kiện #42' })
    const roleRow = within(sheet).getByText('role').closest('tr')!
    expect(roleRow).toHaveAttribute('data-changed', 'true')
    expect(roleRow).toHaveTextContent('"viewer""editor"')
    expect(within(sheet).getByText('email').closest('tr')).not.toHaveAttribute('data-changed')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Đóng' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Server-side filters: category goes to the API as a query parameter.
    fireEvent.click(screen.getByRole('button', { name: /Nhóm/ }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Thành viên' }))
    await waitFor(() =>
      expect(
        calls.some((r) => new URL(r.url).searchParams.getAll('category').includes('member')),
      ).toBe(true),
    )
  })

  it('a period filter sends a from= bound and only one period at a time', async () => {
    const calls = fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      [`GET /api/orgs/${ORG_ID}/members`]: () => json({ members: [] }),
      [`GET /api/orgs/${ORG_ID}/audit`]: () =>
        json({ entries: [], total: 0, page: 1, pageSize: 50 }),
    })
    renderAt(`/o/${ORG_ID}/audit`)
    expect(await screen.findByText('Không có sự kiện khớp bộ lọc')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Khoảng thời gian/ }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '7 ngày qua' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '24 giờ qua' }))
    await waitFor(() => {
      const last = new URL(calls.filter((r) => r.url.includes('/audit')).at(-1)!.url)
      const from = Date.parse(last.searchParams.get('from') ?? '')
      expect(Date.now() - from).toBeGreaterThan(23 * 3600_000)
      expect(Date.now() - from).toBeLessThan(25 * 3600_000)
    })
    expect(screen.getByRole('menuitemcheckbox', { name: '7 ngày qua' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('viewers are sent back to the organization page', async () => {
    fakeApi({
      'GET /api/auth/me': () =>
        json({ ...SESSION, user: { ...SESSION.user, isSystemAdmin: false } }),
      [`GET /api/orgs/${ORG_ID}`]: () =>
        json({ ...ORG_VIEW, membership: { role: 'viewer', permissions: [] } }),
    })
    renderAt(`/o/${ORG_ID}/audit`)
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })

  it('system audit lists events without an organization', async () => {
    fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      'GET /api/admin/users': () => json({ users: [] }),
      'GET /api/admin/audit': () =>
        json({
          entries: [
            { ...AUDIT_ENTRY, id: 7, action: 'auth.login_failed', before: null, after: null },
          ],
          total: 1,
          page: 1,
          pageSize: 50,
        }),
    })
    renderAt('/admin/audit')
    expect(await screen.findByRole('heading', { name: 'Audit log hệ thống' })).toBeInTheDocument()
    expect(await screen.findByText('Đăng nhập thất bại')).toBeInTheDocument()
  })
})

describe('app shell (P1-06)', () => {
  afterEach(() => setLanguage('vi'))

  it('switches the UI language from the account menu and remembers it', async () => {
    fakeApi({ 'GET /api/auth/me': () => json(SESSION), 'GET /api/healthz': () => json(HEALTH) })
    renderAt(`/o/${ORG_ID}`)
    await screen.findByText('Xin chào Admin')
    fireEvent.click(screen.getByRole('button', { name: 'Tài khoản: Admin' }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'English' }))
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).getByRole('link', { name: 'Devices' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('en')
    expect(localStorage.getItem('ntb-lang')).toBe('en')
  })

  it('Ctrl+K switches organization and finds members', async () => {
    const OTHER = '33333333-3333-4333-8333-333333333333'
    fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      'GET /api/healthz': () => json(HEALTH),
      'GET /api/orgs': () =>
        json({
          organizations: [
            { id: ORG_ID, name: 'Văn phòng mẫu', kind: 'internal', role: 'owner' },
            { id: OTHER, name: 'Khách hàng B', kind: 'customer', role: 'viewer' },
          ],
        }),
      [`GET /api/orgs/${OTHER}`]: () =>
        json({
          ...ORG_VIEW,
          organization: { ...ORG_VIEW.organization, id: OTHER, name: 'Khách hàng B' },
        }),
      [`POST /api/orgs/${OTHER}/activate`]: () => new Response(null, { status: 204 }),
      [`GET /api/orgs/${ORG_ID}/members`]: () => json({ members: [MEMBER] }),
    })
    renderAt(`/o/${ORG_ID}`)
    await screen.findByText('Xin chào Admin')
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    fireEvent.change(await screen.findByPlaceholderText('Gõ tên trang, hostname, IP…'), {
      target: { value: 'viewer@example' },
    })
    fireEvent.click(await screen.findByRole('option', { name: /Viewer/ }))
    expect(await screen.findByRole('searchbox', { name: 'Tìm kiếm' })).toHaveValue(
      'viewer@example.com',
    )

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    fireEvent.change(await screen.findByPlaceholderText('Gõ tên trang, hostname, IP…'), {
      target: { value: 'Khách hàng B' },
    })
    fireEvent.click(await screen.findByRole('option', { name: /Khách hàng B/ }))
    expect(
      await screen.findByRole('button', { name: /Đổi tổ chức:.*Khách hàng B/ }),
    ).toBeInTheDocument()
  })

  it('Ctrl+K only offers pages the user may open', async () => {
    fakeApi({
      'GET /api/auth/me': () =>
        json({ ...SESSION, user: { ...SESSION.user, isSystemAdmin: false } }),
      'GET /api/healthz': () => json(HEALTH),
      [`GET /api/orgs/${ORG_ID}`]: () =>
        json({ ...ORG_VIEW, membership: { role: 'viewer', permissions: [] } }),
      [`GET /api/orgs/${ORG_ID}/members`]: () => json({ members: [] }),
    })
    renderAt(`/o/${ORG_ID}`)
    await screen.findByText('Xin chào Admin')
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(await screen.findByRole('option', { name: /Thành viên/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Audit log/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Hệ thống/ })).not.toBeInTheDocument()
  })
})

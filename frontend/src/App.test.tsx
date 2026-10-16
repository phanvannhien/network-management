import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { useScopeStore } from './modules/sites/access'
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
  membership: { role: 'owner', permissions: [], partnerGrants: [], unitGrants: [] },
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
        json({
          ...ORG_VIEW,
          membership: { role: 'viewer', permissions: [], partnerGrants: [], unitGrants: [] },
        }),
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
        json({
          ...ORG_VIEW,
          membership: { role: 'viewer', permissions: [], partnerGrants: [], unitGrants: [] },
        }),
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
        json({
          ...ORG_VIEW,
          membership: { role: 'viewer', permissions: [], partnerGrants: [], unitGrants: [] },
        }),
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

const SITE_ID = '44444444-4444-4444-8444-444444444444'
const SITE = {
  id: SITE_ID,
  code: 'SHARED-HN01',
  kind: 'office',
  businessUnitId: null,
  businessUnitCode: '',
  businessUnitName: '',
  partnerId: null,
  partnerCode: '',
  partnerName: '',
  isp: '',
  name: 'HQ Hà Nội',
  address: '1 Tràng Tiền',
  timezone: 'Asia/Ho_Chi_Minh',
  contactName: 'Anh Bảo vệ',
  contactPhone: '0900000000',
  contactEmail: '',
  notes: '',
  locationCount: 2,
  rackCount: 1,
  access: 'admin',
  version: 1,
  createdAt: '2026-10-16T00:00:00Z',
  updatedAt: '2026-10-16T00:00:00Z',
}
const LOCS = [
  { id: 'l-b', parentId: null, kind: 'building', name: 'Tòa A', sortOrder: 0, version: 1 },
  { id: 'l-r', parentId: 'l-b', kind: 'room', name: 'Phòng máy chủ', sortOrder: 0, version: 1 },
]
const RACK = { id: 'r-1', locationId: 'l-r', name: 'Rack A1', uHeight: 42, notes: '', version: 1 }
const siteRoutes = (extra: Record<string, () => Response> = {}) => ({
  'GET /api/auth/me': () => json(SESSION),
  'GET /api/healthz': () => json(HEALTH),
  [`GET /api/orgs/${ORG_ID}/sites`]: () => json({ sites: [SITE] }),
  [`GET /api/orgs/${ORG_ID}/sites/${SITE_ID}`]: () => json(SITE),
  [`GET /api/orgs/${ORG_ID}/sites/${SITE_ID}/locations`]: () => json({ locations: LOCS }),
  [`GET /api/orgs/${ORG_ID}/sites/${SITE_ID}/racks`]: () => json({ racks: [RACK] }),
  ...extra,
})

describe('sites (P1-07)', () => {
  it('creates a site and opens it', async () => {
    const calls = fakeApi(
      siteRoutes({
        [`POST /api/orgs/${ORG_ID}/sites`]: () => json(SITE, 201),
      }),
    )
    renderAt(`/o/${ORG_ID}/sites?tab=sites`)
    expect(await screen.findByRole('link', { name: 'SHARED-HN01' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Thêm site' }))
    fireEvent.change(await screen.findByLabelText('Tên site'), { target: { value: 'HQ Hà Nội' } })
    // ADR-030: a shared site needs the SHARED- prefix; a wrong code keeps Save disabled.
    fireEvent.change(screen.getByLabelText('Mã site'), { target: { value: 'hq' } })
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Mã site'), { target: { value: 'shared-hn01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    expect(
      await screen.findByRole('heading', { name: /SHARED-HN01 · HQ Hà Nội/ }),
    ).toBeInTheDocument()
    const post = calls.find((r) => r.method === 'POST' && r.url.endsWith('/sites'))!
    expect(await post.clone().json()).toMatchObject({
      code: 'SHARED-HN01',
      name: 'HQ Hà Nội',
      kind: 'office',
      businessUnitId: null,
      timezone: 'Asia/Ho_Chi_Minh',
    })
  })

  it('location tree offers only valid child kinds and sends the parent', async () => {
    const calls = fakeApi(
      siteRoutes({
        [`POST /api/orgs/${ORG_ID}/sites/${SITE_ID}/locations`]: () =>
          json(
            { id: 'l-f', parentId: 'l-b', kind: 'floor', name: 'Tầng 3', sortOrder: 0, version: 1 },
            201,
          ),
      }),
    )
    renderAt(`/o/${ORG_ID}/sites/${SITE_ID}`)
    expect(await screen.findByText('Phòng máy chủ')).toBeInTheDocument()
    // A building accepts floors and rooms; a room accepts nothing.
    expect(screen.getByRole('button', { name: 'Thêm tầng vào Tòa A' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /vào Phòng máy chủ/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Thêm tầng vào Tòa A' }))
    fireEvent.change(await screen.findByLabelText('Tên Tầng'), { target: { value: 'Tầng 3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    await waitFor(() =>
      expect(calls.some((r) => r.url.endsWith('/locations') && r.method === 'POST')).toBe(true),
    )
    const post = calls.find((r) => r.url.endsWith('/locations') && r.method === 'POST')!
    expect(await post.clone().json()).toEqual({ kind: 'floor', name: 'Tầng 3', parentId: 'l-b' })
  })

  it('rack tab shows the front view with numbered units', async () => {
    fakeApi(siteRoutes())
    renderAt(`/o/${ORG_ID}/sites/${SITE_ID}?tab=racks`)
    const view = await screen.findByRole('list', { name: 'Mặt trước Rack A1' })
    expect(within(view).getAllByRole('listitem')).toHaveLength(42)
    expect(screen.getByText(/Tòa A › Phòng máy chủ · 42U/)).toBeInTheDocument()
  })

  it('viewers get a read-only site', async () => {
    fakeApi(
      siteRoutes({
        [`GET /api/orgs/${ORG_ID}`]: () =>
          json({
            ...ORG_VIEW,
            membership: { role: 'viewer', permissions: [], partnerGrants: [], unitGrants: [] },
          }),
        // The server reports the caller's access on the site (ADR-031); the page follows it.
        [`GET /api/orgs/${ORG_ID}/sites/${SITE_ID}`]: () => json({ ...SITE, access: 'view' }),
      }),
    )
    renderAt(`/o/${ORG_ID}/sites/${SITE_ID}`)
    expect(await screen.findByText('Bạn chỉ có quyền xem')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Thêm tòa nhà/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sửa site' })).not.toBeInTheDocument()
  })

  it('deleting a site requires typing its code', async () => {
    const calls = fakeApi(
      siteRoutes({
        [`DELETE /api/orgs/${ORG_ID}/sites/${SITE_ID}`]: () => new Response(null, { status: 204 }),
      }),
    )
    renderAt(`/o/${ORG_ID}/sites/${SITE_ID}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm thao tác' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Xóa site' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Xóa site SHARED-HN01?' })
    const confirm = within(dialog).getByRole('button', { name: 'Xóa site' })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText(/Gõ chính xác/), {
      target: { value: 'SHARED-HN01' },
    })
    fireEvent.click(confirm)
    await waitFor(() => expect(calls.some((r) => r.method === 'DELETE')).toBe(true))
  })
})

const PARTNER_ID = '77777777-7777-4777-8777-777777777777'
const PARTNER = {
  id: PARTNER_ID,
  code: 'AGRI',
  name: 'Mẫu Agri',
  relation: 'partner',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  notes: '',
  unitCount: 1,
  siteCount: 1,
  access: 'admin',
  version: 1,
  createdAt: '2026-10-16T00:00:00Z',
}
const UNIT_ID = '55555555-5555-4555-8555-555555555555'
const UNIT = {
  id: UNIT_ID,
  partnerId: PARTNER_ID,
  partnerCode: 'AGRI',
  partnerName: 'Mẫu Agri',
  code: 'MAIN',
  name: 'Agri chính',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  notes: '',
  siteCount: 1,
  access: 'admin',
  version: 1,
  createdAt: '2026-10-16T00:00:00Z',
}
const AGRI_SITE = {
  ...SITE,
  id: '66666666-6666-4666-8666-666666666666',
  code: 'AGRI-BD01',
  name: 'Nhà máy Bình Định',
  kind: 'factory',
  businessUnitId: UNIT_ID,
  businessUnitCode: 'MAIN',
  businessUnitName: 'Agri chính',
  partnerId: PARTNER_ID,
  partnerCode: 'AGRI',
  partnerName: 'Mẫu Agri',
}

describe('partners and business units (P1-07b, ADR-031)', () => {
  const routes = (extra: Record<string, () => Response> = {}) =>
    siteRoutes({
      [`GET /api/orgs/${ORG_ID}/partners`]: () => json({ partners: [PARTNER] }),
      [`GET /api/orgs/${ORG_ID}/partners/${PARTNER_ID}`]: () => json(PARTNER),
      [`GET /api/orgs/${ORG_ID}/business-units`]: () => json({ businessUnits: [UNIT] }),
      [`GET /api/orgs/${ORG_ID}/business-units/${UNIT_ID}`]: () => json(UNIT),
      [`GET /api/orgs/${ORG_ID}/sites`]: () => json({ sites: [SITE, AGRI_SITE] }),
      ...extra,
    })

  it('lists partners with their counts and creates one with an upper-case code', async () => {
    const calls = fakeApi(
      routes({ [`POST /api/orgs/${ORG_ID}/partners`]: () => json(PARTNER, 201) }),
    )
    renderAt(`/o/${ORG_ID}/sites`)
    expect(await screen.findByRole('link', { name: 'AGRI' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Đối tác', selected: true })).toBeInTheDocument()
    expect(await screen.findByText(/Dùng chung: 1/)).toBeInTheDocument()
    // The organization is named: partners belong to the organization being viewed (taken from the URL).
    expect(
      screen.getByRole('heading', { name: 'Đơn vị & Sites — Văn phòng mẫu' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: /Quan hệ với Văn phòng mẫu/ }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Thêm đối tác' }))
    const dialog = await screen.findByRole('dialog', { name: 'Thêm đối tác vào Văn phòng mẫu' })
    expect(
      within(dialog).getByRole('option', { name: 'Đối tác của Văn phòng mẫu' }),
    ).toBeInTheDocument()
    fireEvent.change(await screen.findByLabelText('Mã đối tác'), { target: { value: 'agri-1' } })
    expect(screen.getByLabelText('Mã đối tác')).toHaveValue('AGRI1')
    fireEvent.change(screen.getByLabelText('Tên đối tác'), { target: { value: 'Mẫu Agri' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    await waitFor(() =>
      expect(calls.some((r) => r.method === 'POST' && r.url.endsWith('/partners'))).toBe(true),
    )
    const post = calls.find((r) => r.method === 'POST' && r.url.endsWith('/partners'))!
    expect(await post.clone().json()).toMatchObject({
      code: 'AGRI1',
      name: 'Mẫu Agri',
      relation: 'subsidiary',
    })
  })

  it('a unit is created under a chosen partner', async () => {
    const calls = fakeApi(
      routes({ [`POST /api/orgs/${ORG_ID}/business-units`]: () => json(UNIT, 201) }),
    )
    renderAt(`/o/${ORG_ID}/sites?tab=units`)
    // Unit codes repeat across partners, so the partner column is shown.
    expect(await screen.findByRole('link', { name: 'MAIN' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'AGRI' })).toHaveAttribute(
      'href',
      `/o/${ORG_ID}/partners/${PARTNER_ID}`,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Thêm đơn vị' }))
    const dialog = await screen.findByRole('dialog', { name: 'Thêm đơn vị vào Văn phòng mẫu' })
    fireEvent.change(within(dialog).getByLabelText('Mã đơn vị'), { target: { value: 'hn' } })
    fireEvent.change(within(dialog).getByLabelText('Tên đơn vị'), { target: { value: 'Agri HN' } })
    const save = within(dialog).getByRole('button', { name: 'Lưu' })
    expect(save).toBeDisabled() // no partner chosen yet
    fireEvent.change(within(dialog).getByLabelText('Đối tác'), { target: { value: PARTNER_ID } })
    fireEvent.click(save)
    const isPost = (r: Request) => r.method === 'POST' && r.url.endsWith('/business-units')
    await waitFor(() => expect(calls.some(isPost)).toBe(true))
    expect(await calls.find(isPost)!.clone().json()).toMatchObject({
      code: 'HN',
      name: 'Agri HN',
      partnerId: PARTNER_ID,
    })
  })

  it('the partner page lists its units and sites and adds a unit to it', async () => {
    fakeApi(routes())
    renderAt(`/o/${ORG_ID}/partners/${PARTNER_ID}`)
    expect(await screen.findByRole('heading', { name: /AGRI · Mẫu Agri/ })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'MAIN' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'AGRI-BD01' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'SHARED-HN01' })).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Thêm đơn vị' })[0])
    const dialog = await screen.findByRole('dialog', { name: 'Thêm đơn vị cho Mẫu Agri' })
    expect(within(dialog).getByLabelText('Đối tác')).toHaveValue(PARTNER_ID)
  })

  it('a site added from a unit gets the unit and a code suggested from its partner', async () => {
    const calls = fakeApi(
      routes({ [`GET /api/orgs/${ORG_ID}/sites/next-code`]: () => json({ code: 'AGRI-BD02' }) }),
    )
    renderAt(`/o/${ORG_ID}/units/${UNIT_ID}`)
    expect(await screen.findByRole('heading', { name: /MAIN · Agri chính/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'AGRI · Mẫu Agri' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'AGRI-BD01' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'SHARED-HN01' })).not.toBeInTheDocument() // other unit's / shared sites
    fireEvent.click(screen.getAllByRole('button', { name: 'Thêm site' })[0])
    const dialog = await screen.findByRole('dialog', { name: 'Thêm site vào Văn phòng mẫu' })
    expect(within(dialog).getByLabelText('Đơn vị')).toHaveValue(UNIT_ID)
    fireEvent.change(within(dialog).getByLabelText('Tên site'), {
      target: { value: 'Nhà máy Bình Định 2' },
    })
    await waitFor(() => expect(within(dialog).getByLabelText('Mã site')).toHaveValue('AGRI-BD02'))
    const nextCall = calls.find((r) => r.url.includes('/sites/next-code'))!
    const q = new URL(nextCall.url).searchParams
    expect([q.get('place'), q.get('partnerId')]).toEqual(['BD', PARTNER_ID])
    // The unit code is not the prefix: MAIN-… is rejected client-side.
    fireEvent.change(within(dialog).getByLabelText('Mã site'), { target: { value: 'MAIN-BD01' } })
    expect(within(dialog).getByRole('button', { name: 'Lưu' })).toBeDisabled()
  })
})

describe('partner / unit permissions and sharing (P1-07c, ADR-031)', () => {
  // A grant-only member who is partner_admin of AGRI.
  const memberView = {
    ...ORG_VIEW,
    membership: {
      role: 'member',
      permissions: [],
      partnerGrants: [{ partnerId: PARTNER_ID, role: 'partner_admin' }],
      unitGrants: [],
    },
  }
  const routes = (extra: Record<string, () => Response> = {}) =>
    siteRoutes({
      [`GET /api/orgs/${ORG_ID}`]: () => json(memberView),
      [`GET /api/orgs/${ORG_ID}/partners`]: () => json({ partners: [PARTNER] }),
      [`GET /api/orgs/${ORG_ID}/partners/${PARTNER_ID}`]: () => json(PARTNER),
      [`GET /api/orgs/${ORG_ID}/business-units`]: () => json({ businessUnits: [UNIT] }),
      [`GET /api/orgs/${ORG_ID}/business-units/${UNIT_ID}`]: () => json(UNIT),
      [`GET /api/orgs/${ORG_ID}/sites`]: () => json({ sites: [SITE, AGRI_SITE] }),
      [`GET /api/orgs/${ORG_ID}/partners/${PARTNER_ID}/members`]: () => json({ members: [] }),
      ...extra,
    })

  it('a partner admin manages the partner users but cannot delete the partner', async () => {
    const calls = fakeApi(
      routes({
        [`POST /api/orgs/${ORG_ID}/partners/${PARTNER_ID}/members`]: () =>
          json(
            {
              member: {
                userId: 'u-new',
                email: 'new@example.com',
                displayName: '',
                role: 'editor',
                pendingInvite: true,
                version: 1,
                createdAt: '2026-10-16T00:00:00Z',
              },
              inviteToken: 'tok123',
            },
            201,
          ),
      }),
    )
    renderAt(`/o/${ORG_ID}/partners/${PARTNER_ID}`)
    const panel = await screen.findByRole('region', { name: 'Người dùng của AGRI' })
    expect(screen.queryByRole('button', { name: 'Thêm thao tác' })).not.toBeInTheDocument()
    // No organization member list for grant-only members.
    expect(screen.queryByRole('link', { name: 'Thành viên' })).not.toBeInTheDocument()
    fireEvent.change(within(panel).getByLabelText('Email'), {
      target: { value: 'new@example.com' },
    })
    fireEvent.change(within(panel).getByLabelText('Quyền'), { target: { value: 'editor' } })
    fireEvent.click(within(panel).getByRole('button', { name: /Mời \/ cấp quyền/ }))
    expect(await screen.findByText(/\/invite\/tok123/)).toBeInTheDocument()
    const post = calls.find((r) => r.method === 'POST' && r.url.endsWith('/members'))!
    expect(await post.clone().json()).toEqual({ email: 'new@example.com', role: 'editor' })
  })

  it('site admins share a site; editors without admin see no sharing tab', async () => {
    const calls = fakeApi(
      routes({
        [`GET /api/orgs/${ORG_ID}/sites/${SITE_ID}/shares`]: () => json({ shares: [] }),
        [`POST /api/orgs/${ORG_ID}/sites/${SITE_ID}/shares`]: () =>
          json(
            {
              id: 'sh1',
              targetType: 'partner',
              targetId: PARTNER_ID,
              targetCode: 'AGRI',
              targetName: 'Mẫu Agri',
              access: 'view',
              grantedAt: '2026-10-16T00:00:00Z',
              version: 1,
            },
            201,
          ),
      }),
    )
    renderAt(`/o/${ORG_ID}/sites/${SITE_ID}?tab=shares`)
    const target = await screen.findByLabelText('Chia sẻ cho')
    fireEvent.change(target, { target: { value: `p:${PARTNER_ID}` } })
    fireEvent.click(screen.getByRole('button', { name: /^Chia sẻ$/ }))
    const isShare = (r: Request) => r.method === 'POST' && r.url.endsWith('/shares')
    await waitFor(() => expect(calls.some(isShare)).toBe(true))
    expect(await calls.find(isShare)!.clone().json()).toEqual({
      targetType: 'partner',
      targetId: PARTNER_ID,
      access: 'view',
    })
  })

  it('an editor through a share edits the site but cannot delete or share it', async () => {
    fakeApi(
      routes({
        [`GET /api/orgs/${ORG_ID}/sites/${SITE_ID}`]: () => json({ ...SITE, access: 'edit' }),
      }),
    )
    renderAt(`/o/${ORG_ID}/sites/${SITE_ID}`)
    expect(await screen.findByRole('button', { name: 'Sửa site' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Chia sẻ' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Thêm thao tác' })).not.toBeInTheDocument()
  })

  it('the topbar selector filters the hub to one partner / unit', async () => {
    fakeApi(routes())
    renderAt(`/o/${ORG_ID}/sites?tab=sites`)
    expect(await screen.findByRole('link', { name: 'SHARED-HN01' })).toBeInTheDocument()
    const selector = await screen.findByLabelText('Lọc theo đối tác / đơn vị')
    fireEvent.change(selector, { target: { value: `u:${UNIT_ID}` } })
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'SHARED-HN01' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('link', { name: 'AGRI-BD01' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('ntb-scope') ?? '{}')[ORG_ID]).toEqual({
      partnerId: PARTNER_ID,
      unitId: UNIT_ID,
    })
    act(() => useScopeStore.getState().set(ORG_ID, { partnerId: null, unitId: null }))
  })
})

describe('device inventory (P1-08)', () => {
  const DEVICE = {
    id: 'dev-1',
    hostname: 'AGRI-BD-FW01',
    type: 'firewall',
    vendor: 'Fortinet',
    model: 'FortiGate 60F',
    partNumber: 'FG-60F',
    serialNumber: 'FGT60F0001',
    assetTag: '',
    firmware: 'FortiOS 7.4',
    role: 'edge',
    lifecycle: 'active',
    managed: true,
    ownerName: 'Phạm Hùng',
    poNumber: '',
    purchaseDate: null,
    warrantyEnd: '2027-06-30',
    licenseEnd: null,
    eolDate: null,
    eosDate: null,
    notes: '',
    tags: ['edge'],
    customFields: {},
    siteId: AGRI_SITE.id,
    siteCode: 'AGRI-BD01',
    siteName: 'Nhà máy Bình Định',
    businessUnitId: UNIT_ID,
    unitCode: 'MAIN',
    unitName: 'Agri chính',
    partnerId: PARTNER_ID,
    partnerCode: 'AGRI',
    partnerName: 'Mẫu Agri',
    locationId: null,
    locationName: '',
    rackId: null,
    rackName: '',
    rackU: null,
    uHeight: 1,
    mgmtInterfaceId: null,
    mgmtInterfaceName: '',
    mgmtIp: '',
    pollAddress: null,
    clusterId: null,
    clusterName: '',
    clusterKind: '',
    clusterRole: null,
    clusterMemberNo: null,
    access: 'edit',
    version: 3,
    createdAt: '2026-10-16T00:00:00Z',
    updatedAt: '2026-10-16T00:00:00Z',
  }
  const SWITCH = { ...DEVICE, id: 'dev-2', hostname: 'AGRI-BD-SW01', type: 'l2_switch', tags: [] }
  const list = (devices: unknown[]) =>
    json({ devices, total: devices.length, facets: { type: { firewall: 1, l2_switch: 1 } } })
  const routes = (extra: Record<string, () => Response> = {}) =>
    siteRoutes({
      [`GET /api/orgs/${ORG_ID}/devices`]: () => list([DEVICE, SWITCH]),
      [`GET /api/orgs/${ORG_ID}/devices/dev-1`]: () => json(DEVICE),
      [`GET /api/orgs/${ORG_ID}/sites`]: () => json({ sites: [SITE, AGRI_SITE] }),
      [`GET /api/orgs/${ORG_ID}/partners`]: () => json({ partners: [PARTNER] }),
      [`GET /api/orgs/${ORG_ID}/business-units`]: () => json({ businessUnits: [UNIT] }),
      [`GET /api/orgs/${ORG_ID}/custom-fields`]: () => json({ fields: [] }),
      ...extra,
    })

  it('lists devices from the API, searches on the server and opens one', async () => {
    const calls = fakeApi(routes())
    renderAt(`/o/${ORG_ID}/devices`)
    expect(await screen.findByRole('link', { name: 'AGRI-BD-SW01' })).toBeInTheDocument()
    expect(screen.queryByText(/Dữ liệu mẫu/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Tìm kiếm' }), {
      target: { value: 'FW' },
    })
    await waitFor(() =>
      expect(
        calls.some(
          (r) => r.url.includes('/devices?') && new URL(r.url).searchParams.get('q') === 'FW',
        ),
      ).toBe(true),
    )
    const first = calls.find((r) => r.url.includes('/devices?'))!
    expect(new URL(first.url).searchParams.get('sort')).toBe('hostname')
    expect(new URL(first.url).searchParams.get('pageSize')).toBe('50')
    fireEvent.click(screen.getByRole('link', { name: 'AGRI-BD-FW01' }))
    expect(await screen.findByRole('heading', { name: 'AGRI-BD-FW01' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Vị trí trang' })).toHaveTextContent('Thiết bị')
  })

  it('a device in a shared site needs an owner unit', async () => {
    const calls = fakeApi(
      routes({ [`POST /api/orgs/${ORG_ID}/devices`]: () => json({ ...DEVICE, id: 'dev-9' }, 201) }),
    )
    renderAt(`/o/${ORG_ID}/devices`)
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm thiết bị' }))
    const dialog = await screen.findByRole('dialog', { name: 'Thêm thiết bị vào Văn phòng mẫu' })
    fireEvent.change(within(dialog).getByLabelText('Hostname'), { target: { value: 'IDC-FW01' } })
    fireEvent.change(within(dialog).getByLabelText('Site'), { target: { value: SITE_ID } })
    const unit = await within(dialog).findByLabelText('Đơn vị')
    expect(unit.tagName).toBe('SELECT') // shared site: choose the owner
    fireEvent.change(unit, { target: { value: UNIT_ID } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    const isPost = (r: Request) => r.method === 'POST' && r.url.endsWith('/devices')
    await waitFor(() => expect(calls.some(isPost)).toBe(true))
    expect(await calls.find(isPost)!.clone().json()).toMatchObject({
      hostname: 'IDC-FW01',
      siteId: SITE_ID,
      businessUnitId: UNIT_ID,
      locationId: null,
      rackId: null,
    })
  })

  it('bulk edit sends only the changed fields', async () => {
    const calls = fakeApi(
      routes({ [`POST /api/orgs/${ORG_ID}/devices/bulk-update`]: () => json({ count: 2 }) }),
    )
    renderAt(`/o/${ORG_ID}/devices`)
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Chọn AGRI-BD-FW01' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn AGRI-BD-SW01' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sửa hàng loạt' }))
    const dialog = await screen.findByRole('dialog', { name: 'Sửa 2 thiết bị' })
    fireEvent.change(within(dialog).getByLabelText('Vòng đời'), { target: { value: 'spare' } })
    fireEvent.change(within(dialog).getByLabelText('Thêm tag'), { target: { value: 'kho, 2026' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    const isBulk = (r: Request) => r.url.endsWith('/bulk-update')
    await waitFor(() => expect(calls.some(isBulk)).toBe(true))
    expect(await calls.find(isBulk)!.clone().json()).toEqual({
      ids: ['dev-1', 'dev-2'],
      lifecycle: 'spare',
      addTags: ['kho', '2026'],
    })
  })

  it('the detail page shows the history and is read-only without edit access', async () => {
    fakeApi(
      routes({
        [`GET /api/orgs/${ORG_ID}/devices/dev-1`]: () => json({ ...DEVICE, access: 'view' }),
        [`GET /api/orgs/${ORG_ID}/devices/dev-1/history`]: () =>
          json({
            entries: [
              {
                id: 2,
                at: '2026-10-16T03:00:00Z',
                action: 'device.update',
                actorEmail: 'admin@example.com',
                actorName: 'Admin',
                before: { lifecycle: 'planned', hostname: 'AGRI-BD-FW01' },
                after: { lifecycle: 'active', hostname: 'AGRI-BD-FW01' },
              },
            ],
          }),
      }),
    )
    renderAt(`/o/${ORG_ID}/devices/dev-1?tab=history`)
    expect(await screen.findByText('planned → active', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Bạn chỉ có quyền xem thiết bị này')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sửa' })).not.toBeInTheDocument()
  })

  it('Ctrl+K jumps to a device', async () => {
    fakeApi(routes())
    renderAt(`/o/${ORG_ID}`)
    await screen.findByText('Xin chào Admin')
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const input = await screen.findByPlaceholderText('Gõ tên trang, hostname, IP…')
    fireEvent.change(input, { target: { value: 'FGT60F' } })
    fireEvent.click(await screen.findByRole('option', { name: /AGRI-BD-FW01/ }))
    expect(await screen.findByRole('heading', { name: 'AGRI-BD-FW01' })).toBeInTheDocument()
  })

  const IFACE = {
    id: 'if-1',
    name: 'Vlan10',
    kind: 'svi',
    media: '',
    speed: '',
    duplex: 'auto',
    mode: '',
    accessVlan: null,
    nativeVlan: null,
    allowedVlans: '',
    poe: false,
    lagId: null,
    lagName: '',
    description: 'MGMT',
    adminUp: true,
    sortOrder: 1,
    isManagement: false,
    version: 1,
  }
  const PORT = {
    ...IFACE,
    id: 'if-2',
    name: 'Gi1/0/1',
    kind: 'physical',
    media: 'RJ45',
    description: '',
  }
  const IP = {
    id: 'ip-1',
    interfaceId: 'if-1',
    interfaceName: 'Vlan10',
    address: '10.72.114.2/24',
    vrf: '',
    role: 'primary',
    description: '',
    version: 1,
  }
  const ifaceRoutes = (extra: Record<string, () => Response> = {}) =>
    routes({
      [`GET /api/orgs/${ORG_ID}/devices/dev-1/interfaces`]: () =>
        json({ interfaces: [IFACE, PORT] }),
      [`GET /api/orgs/${ORG_ID}/devices/dev-1/ips`]: () => json({ ips: [IP] }),
      [`GET /api/orgs/${ORG_ID}/device-templates`]: () => json({ templates: [] }),
      ...extra,
    })

  it('interfaces tab lists ports with their IPs and sets the management interface', async () => {
    const calls = fakeApi(
      ifaceRoutes({
        [`PATCH /api/orgs/${ORG_ID}/devices/dev-1`]: () =>
          json({ ...DEVICE, mgmtInterfaceId: 'if-1', mgmtIp: '10.72.114.2/24', version: 4 }),
      }),
    )
    renderAt(`/o/${ORG_ID}/devices/dev-1?tab=interfaces`)
    expect(await screen.findByText('Gi1/0/1')).toBeInTheDocument()
    expect(screen.getByText('10.72.114.2/24')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Thao tác cho Vlan10' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Đặt làm interface quản trị' }))
    const isPatch = (r: Request) => r.method === 'PATCH' && r.url.endsWith('/devices/dev-1')
    await waitFor(() => expect(calls.some(isPatch)).toBe(true))
    expect(await calls.find(isPatch)!.clone().json()).toMatchObject({
      hostname: 'AGRI-BD-FW01',
      mgmtInterfaceId: 'if-1',
      version: 3,
    })
  })

  it('adds an IP on an interface', async () => {
    const calls = fakeApi(
      ifaceRoutes({ [`POST /api/orgs/${ORG_ID}/devices/dev-1/ips`]: () => json(IP, 201) }),
    )
    renderAt(`/o/${ORG_ID}/devices/dev-1?tab=ips`)
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm IP' }))
    const dialog = await screen.findByRole('dialog', { name: 'Thêm IP' })
    fireEvent.change(within(dialog).getByLabelText(/Địa chỉ/), {
      target: { value: ' 10.72.114.3/24 ' },
    })
    fireEvent.change(within(dialog).getByLabelText('Vai trò'), { target: { value: 'secondary' } })
    fireEvent.change(within(dialog).getByLabelText('Interface'), { target: { value: 'if-1' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    const isPost = (r: Request) => r.method === 'POST' && r.url.endsWith('/ips')
    await waitFor(() => expect(calls.some(isPost)).toBe(true))
    expect(await calls.find(isPost)!.clone().json()).toEqual({
      address: '10.72.114.3/24',
      interfaceId: 'if-1',
      role: 'secondary',
      vrf: '',
      description: '',
    })
  })

  it('a template preset fills the form and its ports are previewed', async () => {
    const calls = fakeApi(
      ifaceRoutes({
        [`POST /api/orgs/${ORG_ID}/device-templates`]: () =>
          json(
            {
              id: 'tp-1',
              name: 'x',
              type: 'firewall',
              vendor: '',
              model: '',
              partNumber: '',
              uHeight: 1,
              ports: [],
              portCount: 0,
              notes: '',
              version: 1,
            },
            201,
          ),
      }),
    )
    renderAt(`/o/${ORG_ID}/device-templates`)
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm template' }))
    const dialog = await screen.findByRole('dialog', { name: 'Thêm template' })
    fireEvent.change(within(dialog).getByLabelText('Điền từ mẫu có sẵn…'), {
      target: { value: 'Fortinet FortiGate 100F' },
    })
    expect(within(dialog).getByText('21 cổng: mgmt … x2')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    const isPost = (r: Request) => r.method === 'POST' && r.url.endsWith('/device-templates')
    await waitFor(() => expect(calls.some(isPost)).toBe(true))
    const body = await calls.find(isPost)!.clone().json()
    expect(body).toMatchObject({
      name: 'Fortinet FortiGate 100F',
      type: 'firewall',
      partNumber: 'FG-100F',
    })
    expect(body.ports).toHaveLength(4)
  })

  const CLUSTER = {
    id: 'cl-1',
    kind: 'ha_active_passive',
    name: 'BD-FW-HA',
    hostname: 'AGRI-BD-FW',
    mgmtIp: '10.72.114.1/24',
    notes: '',
    siteId: AGRI_SITE.id,
    siteCode: 'AGRI-BD01',
    siteName: 'Nhà máy Bình Định',
    businessUnitId: UNIT_ID,
    unitCode: 'MAIN',
    partnerCode: 'AGRI',
    memberCount: 0,
    memberHostnames: '',
    access: 'edit',
    version: 1,
  }

  it('creates a cluster from a device page and joins it', async () => {
    const calls = fakeApi(
      routes({
        [`GET /api/orgs/${ORG_ID}/clusters`]: () => json({ clusters: [] }),
        [`POST /api/orgs/${ORG_ID}/clusters`]: () => json({ ...CLUSTER, members: [] }, 201),
        [`PATCH /api/orgs/${ORG_ID}/devices/dev-1`]: () =>
          json({ ...DEVICE, clusterId: 'cl-1', version: 4 }),
      }),
    )
    renderAt(`/o/${ORG_ID}/devices/dev-1`)
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm vào cụm' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo cụm mới' }))
    const dialog = await screen.findByRole('dialog', { name: 'Thêm cụm' })
    await waitFor(() => expect(within(dialog).getByLabelText('Site')).toHaveValue(AGRI_SITE.id))
    fireEvent.change(within(dialog).getByLabelText('Tên cụm'), { target: { value: 'BD-FW-HA' } })
    fireEvent.change(within(dialog).getByLabelText(/IP quản trị cụm/), {
      target: { value: '10.72.114.1/24' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    const isPost = (r: Request) => r.method === 'POST' && r.url.endsWith('/clusters')
    await waitFor(() => expect(calls.some(isPost)).toBe(true))
    expect(await calls.find(isPost)!.clone().json()).toEqual({
      kind: 'ha_active_passive',
      name: 'BD-FW-HA',
      hostname: '',
      mgmtIp: '10.72.114.1/24',
      notes: '',
      siteId: AGRI_SITE.id,
      businessUnitId: null,
    })
    const isPatch = (r: Request) => r.method === 'PATCH'
    await waitFor(() => expect(calls.some(isPatch)).toBe(true))
    expect(await calls.find(isPatch)!.clone().json()).toMatchObject({
      clusterId: 'cl-1',
      clusterRole: 'primary',
      clusterMemberNo: 1,
    })
  })

  it('a device joins a cluster of its site from the device form', async () => {
    const calls = fakeApi(
      routes({
        [`GET /api/orgs/${ORG_ID}/clusters`]: () => json({ clusters: [CLUSTER] }),
        [`GET /api/orgs/${ORG_ID}/devices/dev-1/interfaces`]: () => json({ interfaces: [] }),
        [`PATCH /api/orgs/${ORG_ID}/devices/dev-1`]: () => json({ ...DEVICE, version: 4 }),
      }),
    )
    renderAt(`/o/${ORG_ID}/devices/dev-1`)
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }))
    const dialog = await screen.findByRole('dialog', { name: 'Sửa AGRI-BD-FW01' })
    const select = await within(dialog).findByLabelText('Cụm')
    await waitFor(() =>
      expect(within(select).getByRole('option', { name: /BD-FW-HA/ })).toBeInTheDocument(),
    )
    fireEvent.change(select, { target: { value: 'cl-1' } })
    fireEvent.change(within(dialog).getByLabelText('Vai trò trong cụm'), {
      target: { value: 'primary' },
    })
    fireEvent.change(within(dialog).getByLabelText('Số thứ tự'), { target: { value: '1' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    const isPatch = (r: Request) => r.method === 'PATCH'
    await waitFor(() => expect(calls.some(isPatch)).toBe(true))
    expect(await calls.find(isPatch)!.clone().json()).toMatchObject({
      clusterId: 'cl-1',
      clusterRole: 'primary',
      clusterMemberNo: 1,
    })
  })
})

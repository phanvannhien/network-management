import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { usePreferences } from './lib/preferences'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from './App'
import { setCsrfToken } from './api/client'
import { setLanguage } from './i18n'
import { memoryDraftStore, setDraftStore } from './editor/doc/drafts'

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
    code: 'VPM',
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
    // The editor is a lazy chunk with React Flow: give it time on a busy machine.
    await waitFor(() => expect(document.body.querySelector('.react-flow')).toBeInTheDocument(), {
      timeout: 5000,
    })
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
    expect(await patch.clone().json()).toEqual({
      name: 'Công ty A',
      code: 'VPM',
      confirmSiteCodes: false,
      notes: '',
      version: 1,
    })
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
    fireEvent.change(await screen.findByPlaceholderText('Gõ trang, hostname, S/N, IP, MAC…'), {
      target: { value: 'viewer@example' },
    })
    fireEvent.click(await screen.findByRole('option', { name: /Viewer/ }))
    expect(await screen.findByRole('searchbox', { name: 'Tìm kiếm' })).toHaveValue(
      'viewer@example.com',
    )

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    fireEvent.change(await screen.findByPlaceholderText('Gõ trang, hostname, S/N, IP, MAC…'), {
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
  code: 'VPM-HN01',
  localCode: 'HN01',
  kind: 'office',
  categoryId: null,
  categoryPath: '',
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
    expect(await screen.findByRole('link', { name: 'VPM-HN01' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Thêm site' }))
    fireEvent.change(await screen.findByLabelText('Tên site'), { target: { value: 'HQ Hà Nội' } })
    // ADR-032: the site's own code (A-Z, 0-9); a bad one keeps Save disabled; the full code is previewed.
    fireEvent.change(screen.getByLabelText(/Mã site/), { target: { value: 'hn 01' } })
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Mã site/), { target: { value: 'hn01' } })
    expect(within(screen.getByRole('dialog')).getByText('VPM-HN01')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    expect(await screen.findByRole('heading', { name: /VPM-HN01 · HQ Hà Nội/ })).toBeInTheDocument()
    const post = calls.find((r) => r.method === 'POST' && r.url.endsWith('/sites'))!
    expect(await post.clone().json()).toMatchObject({
      code: 'HN01',
      categoryId: null,
      name: 'HQ Hà Nội',
      kind: 'office',
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
    const dialog = await screen.findByRole('alertdialog', { name: 'Xóa site VPM-HN01?' })
    const confirm = within(dialog).getByRole('button', { name: 'Xóa site' })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText(/Gõ chính xác/), {
      target: { value: 'VPM-HN01' },
    })
    fireEvent.click(confirm)
    await waitFor(() => expect(calls.some((r) => r.method === 'DELETE')).toBe(true))
  })
})

const CAT_ID = '77777777-7777-4777-8777-777777777777'
const CHILD_ID = '55555555-5555-4555-8555-555555555555'
const CATEGORY = {
  id: CAT_ID,
  parentId: null,
  name: 'Mẫu Agri',
  code: 'AGRI',
  path: 'Mẫu Agri',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  notes: '',
  childCount: 1,
  siteCount: 1,
  version: 1,
}
const CHILD = {
  ...CATEGORY,
  id: CHILD_ID,
  parentId: CAT_ID,
  name: 'Nhà máy',
  code: 'NM',
  path: 'Mẫu Agri › Nhà máy',
  childCount: 0,
  siteCount: 0,
}
const AGRI_SITE = {
  ...SITE,
  id: '66666666-6666-4666-8666-666666666666',
  code: 'VPM-AGRI-BD01',
  localCode: 'BD01',
  name: 'Nhà máy Bình Định',
  kind: 'factory',
  categoryId: CAT_ID,
  categoryPath: 'Mẫu Agri',
}

describe('categories & sites (P1-27, ADR-032)', () => {
  const routes = (extra: Record<string, () => Response> = {}) =>
    siteRoutes({
      [`GET /api/orgs/${ORG_ID}/sites`]: () => json({ sites: [SITE, AGRI_SITE] }),
      [`GET /api/orgs/${ORG_ID}/categories`]: () => json({ categories: [CATEGORY, CHILD] }),
      ...extra,
    })

  it('the tree lists categories; a branch shows its sites; a site may sit under the organization', async () => {
    fakeApi(routes())
    renderAt(`/o/${ORG_ID}/sites`)
    const tree = await screen.findByRole('navigation', { name: 'Cây danh mục' })
    expect(await within(tree).findByRole('button', { name: /^Nhà máy/ })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'VPM-HN01' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'VPM-AGRI-BD01' })).toBeInTheDocument()
    fireEvent.click(within(tree).getByRole('button', { name: /^Mẫu Agri/ }))
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'VPM-HN01' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('link', { name: 'VPM-AGRI-BD01' })).toBeInTheDocument()
  })

  it('creates a sub-category and a site whose full code follows the tree', async () => {
    const created = {
      ...CHILD,
      id: 'c-new',
      code: 'VP1',
      name: 'Văn phòng',
      path: 'Mẫu Agri › Văn phòng',
    }
    let list = [CATEGORY, CHILD]
    const calls = fakeApi(
      routes({
        [`GET /api/orgs/${ORG_ID}/categories`]: () => json({ categories: list }),
        [`POST /api/orgs/${ORG_ID}/categories`]: () => {
          list = [...list, created]
          return json(created, 201)
        },
        [`POST /api/orgs/${ORG_ID}/sites`]: () => json({ ...AGRI_SITE, id: 's-new' }, 201),
      }),
    )
    renderAt(`/o/${ORG_ID}/sites?category=${CAT_ID}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm danh mục con' }))
    const dialog = await screen.findByRole('dialog', { name: 'Thêm danh mục' })
    fireEvent.change(within(dialog).getByLabelText(/Tên danh mục/), {
      target: { value: 'Văn phòng' },
    })
    fireEvent.change(within(dialog).getByLabelText(/^Mã/), { target: { value: 'vp-1' } })
    expect(within(dialog).getByLabelText(/Thuộc danh mục/)).toHaveValue(CAT_ID)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    const isCat = (r: Request) => r.method === 'POST' && r.url.endsWith('/categories')
    await waitFor(() => expect(calls.some(isCat)).toBe(true))
    expect(await calls.find(isCat)!.clone().json()).toMatchObject({
      name: 'Văn phòng',
      code: 'VP1',
      parentId: CAT_ID,
    })
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Thêm danh mục' })).not.toBeInTheDocument(),
    )
    // The page moves to the new category once the refetched tree has it (the site dialog starts there).
    expect(await screen.findByText('Mẫu Agri › Văn phòng', { selector: 'p' })).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Thêm site' })[0]!)
    const site = await screen.findByRole('dialog', { name: /^Thêm site/ })
    fireEvent.change(within(site).getByLabelText('Tên site'), { target: { value: 'Kho Bến Cát' } })
    fireEvent.change(within(site).getByLabelText(/Mã site/), { target: { value: 'bc01' } })
    expect(within(site).getByText('VPM-AGRI-VP1-BC01')).toBeInTheDocument()
    fireEvent.click(within(site).getByRole('button', { name: 'Lưu' }))
    const isSite = (r: Request) => r.method === 'POST' && r.url.endsWith('/sites')
    await waitFor(() => expect(calls.some(isSite)).toBe(true))
    expect(await calls.find(isSite)!.clone().json()).toMatchObject({
      code: 'BC01',
      name: 'Kho Bến Cát',
      categoryId: 'c-new',
    })
  })

  it('re-coding a category lists the site codes and saves only after confirmation', async () => {
    const calls = fakeApi(
      routes({
        [`POST /api/orgs/${ORG_ID}/categories/${CAT_ID}/preview`]: () =>
          json({
            changes: [
              {
                siteId: AGRI_SITE.id,
                name: AGRI_SITE.name,
                from: 'VPM-AGRI-BD01',
                to: 'VPM-AG-BD01',
              },
            ],
          }),
        [`PATCH /api/orgs/${ORG_ID}/categories/${CAT_ID}`]: () =>
          json({ ...CATEGORY, code: 'AG', version: 2 }),
      }),
    )
    renderAt(`/o/${ORG_ID}/sites`)
    const tree = await screen.findByRole('navigation', { name: 'Cây danh mục' })
    fireEvent.click(await within(tree).findByRole('button', { name: 'Sửa danh mục Mẫu Agri' }))
    const dialog = await screen.findByRole('dialog', { name: 'Sửa danh mục' })
    fireEvent.change(within(dialog).getByLabelText(/^Mã/), { target: { value: 'AG' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    const confirm = await screen.findByRole('dialog', { name: 'Đổi mã 1 site' })
    expect(within(confirm).getByText('VPM-AG-BD01')).toBeInTheDocument()
    expect(calls.some((r) => r.method === 'PATCH')).toBe(false)
    fireEvent.click(within(confirm).getByRole('button', { name: 'Đổi mã và lưu' }))
    const isPatch = (r: Request) => r.method === 'PATCH'
    await waitFor(() => expect(calls.some(isPatch)).toBe(true))
    expect(await calls.find(isPatch)!.clone().json()).toMatchObject({
      code: 'AG',
      confirmSiteCodes: true,
      version: 1,
    })
  })
})

const VLAN = {
  id: 'vl-1',
  siteId: '66666666-6666-4666-8666-666666666666',
  siteCode: 'VPM-AGRI-BD01',
  vid: 10,
  name: 'MGMT',
  color: '#0ea5e9',
  description: '',
  subnetCount: 1,
  access: 'edit',
  version: 1,
}
const SUBNET = {
  id: 'sn-1',
  cidr: '10.72.114.0/24',
  vrf: '',
  gateway: '10.72.114.1',
  description: 'Quản trị',
  siteId: '66666666-6666-4666-8666-666666666666',
  siteCode: 'VPM-AGRI-BD01',
  vlanId: 'vl-1',
  vlanVid: 10,
  vlanName: 'MGMT',
  vlanColor: '#0ea5e9',
  size: 254,
  usedCount: 240,
  rangeCount: 1,
  access: 'edit',
  version: 1,
}
const OTHER_SITE_SUBNET = {
  ...SUBNET,
  id: 'sn-2',
  cidr: '10.80.0.0/24',
  siteId: SITE_ID,
  siteCode: 'VPM-HN01',
  vlanId: null,
  vlanVid: null,
  vlanName: '',
  vlanColor: '',
  usedCount: 3,
  description: '',
}

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
    siteCode: 'VPM-AGRI-BD01',
    siteName: 'Nhà máy Bình Định',
    categoryId: CAT_ID,
    categoryPath: 'Mẫu Agri',
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
      [`GET /api/orgs/${ORG_ID}/categories`]: () => json({ categories: [CATEGORY, CHILD] }),
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

  it('a new device takes its category from the site', async () => {
    const calls = fakeApi(
      routes({ [`POST /api/orgs/${ORG_ID}/devices`]: () => json({ ...DEVICE, id: 'dev-9' }, 201) }),
    )
    renderAt(`/o/${ORG_ID}/devices`)
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm thiết bị' }))
    const dialog = await screen.findByRole('dialog', { name: 'Thêm thiết bị vào Văn phòng mẫu' })
    fireEvent.change(within(dialog).getByLabelText('Hostname'), {
      target: { value: 'AGRI-BD-FW02' },
    })
    fireEvent.change(within(dialog).getByLabelText('Site'), { target: { value: AGRI_SITE.id } })
    expect(await within(dialog).findByText('Danh mục (theo site): Mẫu Agri')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    const isPost = (r: Request) => r.method === 'POST' && r.url.endsWith('/devices')
    await waitFor(() => expect(calls.some(isPost)).toBe(true))
    const body = await calls.find(isPost)!.clone().json()
    expect(body).toMatchObject({
      hostname: 'AGRI-BD-FW02',
      siteId: AGRI_SITE.id,
      locationId: null,
      rackId: null,
    })
    expect(body).not.toHaveProperty('businessUnitId')
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

  it('Ctrl+K searches the server (P1-23) and jumps to a device', async () => {
    const calls = fakeApi(
      routes({
        [`GET /api/orgs/${ORG_ID}/search`]: () =>
          json({
            devices: [
              {
                id: 'dev-1',
                hostname: 'AGRI-BD-FW01',
                type: 'firewall',
                siteCode: 'AGRI-BD01',
                matched: 'partNumber',
                matchedValue: 'FGT60F',
                diagrams: [{ id: 'dg-1', name: 'LAN BD' }],
              },
            ],
            clusters: [],
            ips: [],
            macs: [],
            groups: [],
          }),
      }),
    )
    renderAt(`/o/${ORG_ID}`)
    await screen.findByText('Xin chào Admin')
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const input = await screen.findByPlaceholderText('Gõ trang, hostname, S/N, IP, MAC…')
    fireEvent.change(input, { target: { value: 'FGT60F' } })
    expect(
      await screen.findByRole('option', { name: /AGRI-BD-FW01 → mở trên sơ đồ «LAN BD»/ }),
    ).toBeInTheDocument()
    expect(calls.some((c) => c.url.includes('/search?q=FGT60F'))).toBe(true)
    fireEvent.click(screen.getByRole('option', { name: /^AGRI-BD-FW01.*Part number: FGT60F/ }))
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
    mac: null,
    vlanTag: null,
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

  it('takes the next free address of a site subnet for a new IP', async () => {
    const calls = fakeApi(
      ifaceRoutes({
        [`GET /api/orgs/${ORG_ID}/subnets`]: () =>
          json({
            subnets: [{ ...SUBNET, siteId: AGRI_SITE.id, vrf: 'CUST-B' }, OTHER_SITE_SUBNET],
          }),
        [`GET /api/orgs/${ORG_ID}/subnets/sn-1/next-free`]: () =>
          json({ address: '10.72.114.10/24', host: '10.72.114.10' }),
        [`POST /api/orgs/${ORG_ID}/devices/dev-1/ips`]: () => json(IP, 201),
      }),
    )
    renderAt(`/o/${ORG_ID}/devices/dev-1?tab=ips`)
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm IP' }))
    const dialog = await screen.findByRole('dialog', { name: 'Thêm IP' })
    const pick = await within(dialog).findByLabelText(/Lấy IP trống từ subnet/)
    // Only the device's site's subnets (and organization-wide ones) are offered.
    expect(within(pick).queryByText(/10\.80\.0\.0/)).not.toBeInTheDocument()
    fireEvent.change(pick, { target: { value: 'sn-1' } })
    await waitFor(() =>
      expect(within(dialog).getByLabelText(/Địa chỉ/)).toHaveValue('10.72.114.10/24'),
    )
    expect(within(dialog).getByText('Đã điền IP trống 10.72.114.10/24')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    const isPost = (r: Request) => r.method === 'POST' && r.url.endsWith('/ips')
    await waitFor(() => expect(calls.some(isPost)).toBe(true))
    expect(await calls.find(isPost)!.clone().json()).toMatchObject({
      address: '10.72.114.10/24',
      vrf: 'CUST-B',
    })
  })

  it('connections tab lists links and adds one on a free physical port', async () => {
    const LINK = {
      id: 'ln-1',
      a: {
        kind: 'device',
        id: 'dev-1',
        name: 'AGRI-BD-FW01',
        type: 'firewall',
        siteId: AGRI_SITE.id,
        siteCode: 'VPM-AGRI-BD01',
        interfaceId: 'if-2',
        interfaceName: 'Gi1/0/1',
        interfaceKind: 'physical',
        interfaceMedia: 'RJ45',
        interfaceMode: '',
        accessVlan: null,
        nativeVlan: null,
        allowedVlans: '',
        lagId: null,
        lagName: '',
      },
      b: {
        kind: 'device',
        id: 'dev-2',
        name: 'AGRI-BD-SW01',
        type: 'l2_switch',
        siteId: AGRI_SITE.id,
        siteCode: 'VPM-AGRI-BD01',
        interfaceId: null,
        interfaceName: '',
        interfaceKind: '',
        interfaceMedia: '',
        interfaceMode: '',
        accessVlan: null,
        nativeVlan: null,
        allowedVlans: '',
        lagId: null,
        lagName: '',
      },
      kind: 'ethernet',
      medium: 'Cat6',
      speed: '1G',
      lengthM: null,
      cableId: 'BD-C001',
      status: 'planned',
      provider: '',
      fiberMode: '',
      connector: '',
      service: '',
      circuitId: '',
      bandwidth: '',
      notes: '',
      access: 'edit',
      version: 1,
    }
    const PORT2 = { ...PORT, id: 'if-3', name: 'Gi1/0/2' }
    const calls = fakeApi(
      ifaceRoutes({
        [`GET /api/orgs/${ORG_ID}/devices/dev-1/interfaces`]: () =>
          json({ interfaces: [IFACE, PORT, PORT2] }),
        [`GET /api/orgs/${ORG_ID}/devices/dev-2/interfaces`]: () =>
          json({ interfaces: [{ ...PORT, id: 'sw-p1', name: 'Gi1/0/24' }] }),
        [`GET /api/orgs/${ORG_ID}/links`]: () => json({ links: [LINK] }),
        [`POST /api/orgs/${ORG_ID}/links`]: () => json(LINK, 201),
      }),
    )
    renderAt(`/o/${ORG_ID}/devices/dev-1?tab=links`)
    expect(await screen.findByRole('link', { name: 'AGRI-BD-SW01' })).toHaveAttribute(
      'href',
      `/o/${ORG_ID}/devices/dev-2`,
    )
    expect(screen.getByText('BD-C001')).toBeInTheDocument()
    expect(screen.getByText('Dự kiến')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Thêm kết nối' }))
    const dialog = await screen.findByRole('dialog', { name: 'Thêm kết nối' })
    const near = within(dialog).getByLabelText(/Cổng của thiết bị này/)
    await waitFor(() => expect(near).toContainHTML('Gi1/0/2'))
    // A cable cannot go into the SVI, and Gi1/0/1 already has one.
    expect(within(near).queryByText(/Vlan10/)).not.toBeInTheDocument()
    expect(within(near).getByText(/Gi1\/0\/1.*đã có dây/)).toBeDisabled()
    fireEvent.change(near, { target: { value: 'if-3' } })
    const far = within(dialog).getByLabelText(/^Nối tới/)
    await waitFor(() => expect(far).toContainHTML('AGRI-BD-SW01'))
    fireEvent.change(far, { target: { value: 'dev-2' } })
    const farPort = within(dialog).getByLabelText(/Cổng bên kia/)
    await waitFor(() => expect(farPort).toContainHTML('Gi1/0/24'))
    fireEvent.change(farPort, { target: { value: 'sw-p1' } })
    fireEvent.change(within(dialog).getByLabelText(/Mã cáp/), { target: { value: 'BD-C002' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    const isPost = (r: Request) => r.method === 'POST' && r.url.endsWith('/links')
    await waitFor(() => expect(calls.some(isPost)).toBe(true))
    expect(await calls.find(isPost)!.clone().json()).toMatchObject({
      a: { kind: 'device', id: 'dev-1', interfaceId: 'if-3' },
      b: { kind: 'device', id: 'dev-2', interfaceId: 'sw-p1' },
      kind: 'ethernet',
      cableId: 'BD-C002',
      status: 'up',
      lengthM: null,
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
    siteCode: 'VPM-AGRI-BD01',
    siteName: 'Nhà máy Bình Định',
    categoryPath: 'Mẫu Agri',
    memberCount: 0,
    memberHostnames: '',
    memberType: '',
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
        [`GET /api/orgs/${ORG_ID}/clusters`]: () =>
          json({
            clusters: [
              CLUSTER,
              { ...CLUSTER, id: 'cl-2', kind: 'stack', name: 'BD-STACK' },
              { ...CLUSTER, id: 'cl-3', name: 'SRV-HA', memberCount: 2, memberType: 'server' },
            ],
          }),
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
    // A switch stack and an HA pair of servers are not offered for a firewall (ADR-027).
    expect(within(select).queryByRole('option', { name: /BD-STACK/ })).not.toBeInTheDocument()
    expect(within(select).queryByRole('option', { name: /SRV-HA/ })).not.toBeInTheDocument()
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

  it('a sub-interface sends its VLAN tag and MAC, with plain-language hints', async () => {
    const calls = fakeApi(
      ifaceRoutes({
        [`POST /api/orgs/${ORG_ID}/devices/dev-1/interfaces`]: () => json(IFACE, 201),
      }),
    )
    renderAt(`/o/${ORG_ID}/devices/dev-1?tab=interfaces`)
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm interface' }))
    const dialog = await screen.findByRole('dialog', { name: 'Thêm interface' })
    fireEvent.change(within(dialog).getByLabelText('Tên'), { target: { value: 'Gi0/0.10' } })
    const tag = within(dialog).getByLabelText('VLAN tag (802.1Q)')
    expect(tag).toBeDisabled() // SVI by default
    fireEvent.change(within(dialog).getByLabelText('Loại'), { target: { value: 'subinterface' } })
    expect(within(dialog).getByText(/router-on-a-stick/)).toBeInTheDocument()
    fireEvent.change(tag, { target: { value: '10' } })
    fireEvent.change(within(dialog).getByLabelText('MAC'), { target: { value: 'aabb.ccdd.ee01' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    const isPost = (r: Request) => r.method === 'POST' && r.url.endsWith('/interfaces')
    await waitFor(() => expect(calls.some(isPost)).toBe(true))
    expect(await calls.find(isPost)!.clone().json()).toMatchObject({
      name: 'Gi0/0.10',
      kind: 'subinterface',
      vlanTag: 10,
      mac: 'aabb.ccdd.ee01',
    })
  })

  it('explains fields: (?) opens the glossary entry, guides can be turned off', async () => {
    fakeApi(ifaceRoutes())
    renderAt(`/o/${ORG_ID}/devices/dev-1?tab=interfaces`)
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm interface' }))
    const dialog = await screen.findByRole('dialog', { name: 'Thêm interface' })
    // The plain-language guide is shown by default…
    expect(within(dialog).getByText(/Access: cổng mang 1 VLAN/)).toBeInTheDocument()
    // …and (?) explains the term with an example and a glossary link.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Giải thích: Mode của cổng' }))
    expect(await screen.findByText(/Routed: cổng có IP như cổng router/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Xem trong bảng thuật ngữ' })).toHaveAttribute(
      'href',
      `/help/glossary#mode`,
    )
    act(() => usePreferences.getState().setShowGuides(false))
    expect(within(dialog).queryByText(/Access: cổng mang 1 VLAN/)).not.toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: 'Giải thích: Mode của cổng' }),
    ).toBeInTheDocument()
    act(() => usePreferences.getState().setShowGuides(true))
  })

  it('the glossary page lists and searches terms', async () => {
    fakeApi(routes())
    renderAt(`/o/${ORG_ID}/glossary#vrf`)
    expect(await screen.findByRole('heading', { name: 'Thuật ngữ mạng' })).toBeInTheDocument()
    expect(screen.getByText('VRF')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Tìm thuật ngữ…' }), {
      target: { value: 'trunk' },
    })
    expect(screen.getByText('Cổng trunk')).toBeInTheDocument()
    expect(screen.queryByText('VRF')).not.toBeInTheDocument()
  })
})

describe('step-up MFA (P2-14)', () => {
  it('a 428 on a sensitive admin action opens the MFA prompt instead of an error', async () => {
    fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      'GET /api/admin/backups': () =>
        json({
          enabled: true,
          dir: '/b',
          schedule: '02:00',
          keep: '7,4,12',
          stale: false,
          runs: [],
          files: [],
          targets: [],
        }),
      'POST /api/admin/backups/run': () =>
        json({ message: 'Nhập mã MFA để xác nhận thao tác này' }, 428),
    })
    renderAt('/admin/backups')
    fireEvent.click(await screen.findByRole('button', { name: 'Sao lưu ngay' }))
    expect(await screen.findByRole('dialog', { name: 'Xác nhận bằng mã MFA' })).toBeInTheDocument()
  })
})

describe('help centre (P2-24)', () => {
  it('lists articles by section, searches without accents, and opens an article', async () => {
    fakeApi({ 'GET /api/auth/me': () => json(SESSION) })
    renderAt('/help')
    expect(await screen.findByRole('heading', { name: 'Trợ giúp' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Quản trị hệ thống' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Tìm trong trợ giúp' }), {
      target: { value: 'nhap excel' },
    })
    expect(
      within(screen.getByRole('region', { name: 'Kết quả' })).getByRole('link', {
        name: /IPAM — quản lý IP/,
      }),
    ).toBeInTheDocument()
    cleanup()
    renderAt('/help/ipam')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'IPAM — quản lý IP' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Nhập IP plan từ Excel' })).toBeInTheDocument()
  })

  it('hides system administration from other users', async () => {
    fakeApi({
      'GET /api/auth/me': () =>
        json({ ...SESSION, user: { ...SESSION.user, isSystemAdmin: false } }),
    })
    renderAt('/help/sao-luu-khoi-phuc')
    expect(await screen.findByText('Không tìm thấy trang')).toBeInTheDocument()
    cleanup()
    renderAt('/help')
    expect(await screen.findByRole('region', { name: 'Hướng dẫn theo việc' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Quản trị hệ thống' })).not.toBeInTheDocument()
  })

  it('the ? in the top bar opens the article about the page on screen', async () => {
    fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      [`GET /api/orgs/${ORG_ID}`]: () => json(ORG_VIEW),
      [`GET /api/orgs/${ORG_ID}/members`]: () => json({ members: [MEMBER] }),
    })
    renderAt(`/o/${ORG_ID}/members`)
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Trợ giúp cho trang này' })).toHaveAttribute(
        'href',
        '/help/thanh-vien-phan-quyen',
      ),
    )
  })
})

describe('IPAM (P1-10)', () => {
  const DETAIL = {
    ...SUBNET,
    ranges: [
      {
        id: 'rg-1',
        startIp: '10.72.114.100',
        endIp: '10.72.114.200',
        kind: 'dhcp',
        purpose: 'Wi-Fi khách',
        size: 101,
        usedCount: 0,
        version: 1,
      },
    ],
    ips: [
      {
        address: '10.72.114.2/24',
        host: '10.72.114.2',
        role: 'primary',
        vrf: '',
        deviceId: 'dev-1',
        clusterId: null,
        hostname: 'AGRI-BD-SW01',
        interfaceName: 'Vlan10',
      },
      {
        address: '10.72.114.3/24',
        host: '10.72.114.3',
        role: 'primary',
        vrf: '',
        deviceId: null,
        clusterId: 'cl-1',
        hostname: 'BD-CORE-STACK',
        interfaceName: '',
      },
    ],
    hiddenCount: 2,
  }
  const ipamRoutes = (extra: Record<string, () => Response> = {}) =>
    siteRoutes({
      [`GET /api/orgs/${ORG_ID}/sites`]: () => json({ sites: [SITE, AGRI_SITE] }),
      [`GET /api/orgs/${ORG_ID}/subnets`]: () => json({ subnets: [SUBNET, OTHER_SITE_SUBNET] }),
      [`GET /api/orgs/${ORG_ID}/vlans`]: () =>
        json({
          vlans: [VLAN, { ...VLAN, id: 'vl-2', siteId: SITE_ID, siteCode: 'VPM-HN01', vid: 20 }],
        }),
      [`GET /api/orgs/${ORG_ID}/subnets/sn-1`]: () => json(DETAIL),
      ...extra,
    })

  it('lists subnets with usage, VLANs, and looks up who uses an IP', async () => {
    fakeApi(
      ipamRoutes({
        [`GET /api/orgs/${ORG_ID}/ipam/lookup`]: () =>
          json({
            ip: '10.72.114.2',
            subnets: [SUBNET],
            assignments: [
              {
                address: '10.72.114.2/24',
                host: '10.72.114.2',
                role: 'primary',
                vrf: '',
                deviceId: 'dev-1',
                clusterId: null,
                hostname: 'AGRI-BD-SW01',
                interfaceName: 'Vlan10',
              },
            ],
            hiddenCount: 1,
          }),
      }),
    )
    renderAt(`/o/${ORG_ID}/ipam`)
    expect(await screen.findByRole('link', { name: '10.72.114.0/24' })).toBeInTheDocument()
    // 240 / 254 = 94%: nearly full is said in words, not only colour.
    expect(screen.getByRole('meter', { name: 'Sử dụng 10.72.114.0/24' })).toHaveAttribute(
      'aria-valuenow',
      '94',
    )
    expect(screen.getByText('Gần đầy')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Địa chỉ IP cần tra'), {
      target: { value: '10.72.114.2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Tra' }))
    const lookup = await screen.findByRole('region', { name: 'Tra IP' })
    expect(await within(lookup).findByRole('link', { name: 'AGRI-BD-SW01' })).toHaveAttribute(
      'href',
      `/o/${ORG_ID}/devices/dev-1`,
    )
    expect(within(lookup).getByText(/1 thiết bị ngoài phạm vi/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'VLAN' }))
    expect(await screen.findByText('MGMT')).toBeInTheDocument()
  })

  it('creates a subnet with a live preview; the VLAN list follows the site', async () => {
    const calls = fakeApi(
      ipamRoutes({
        [`POST /api/orgs/${ORG_ID}/subnets`]: () => json(DETAIL, 201),
      }),
    )
    renderAt(`/o/${ORG_ID}/ipam`)
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm subnet' }))
    const dialog = await screen.findByRole('dialog', { name: 'Thêm subnet' })
    fireEvent.change(within(dialog).getByLabelText(/Subnet \(CIDR\)/), {
      target: { value: '10.72.114.7/24' },
    })
    expect(
      within(dialog).getByText(
        'Mạng 10.72.114.0/24 · dùng được 10.72.114.1 – 10.72.114.254 (254 địa chỉ) · mặt nạ 255.255.255.0',
      ),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Site')).toContainHTML('VPM-AGRI-BD01'),
    )
    fireEvent.change(within(dialog).getByLabelText('Site'), { target: { value: AGRI_SITE.id } })
    const vlanSelect = within(dialog).getByLabelText('VLAN')
    // VLAN 20 belongs to another site.
    expect(within(vlanSelect).queryByText(/^20/)).not.toBeInTheDocument()
    fireEvent.change(vlanSelect, { target: { value: 'vl-1' } })
    fireEvent.change(within(dialog).getByLabelText('Gateway'), { target: { value: '10.72.114.1' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    const isPost = (r: Request) => r.method === 'POST' && r.url.endsWith('/subnets')
    await waitFor(() => expect(calls.some(isPost)).toBe(true))
    expect(await calls.find(isPost)!.clone().json()).toEqual({
      cidr: '10.72.114.7/24',
      gateway: '10.72.114.1',
      vrf: '',
      description: '',
      siteId: AGRI_SITE.id,
      vlanId: 'vl-1',
    })
  })

  it('subnet page: next free address, ranges and hidden addresses', async () => {
    const calls = fakeApi(
      ipamRoutes({
        [`GET /api/orgs/${ORG_ID}/subnets/sn-1/next-free`]: () =>
          json({ address: '10.72.114.10/24', host: '10.72.114.10' }),
        [`POST /api/orgs/${ORG_ID}/subnets/sn-1/ranges`]: () => json(DETAIL.ranges[0], 201),
      }),
    )
    renderAt(`/o/${ORG_ID}/ipam/subnets/sn-1`)
    expect(await screen.findByRole('heading', { name: '10.72.114.0/24' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'AGRI-BD-SW01' })).toBeInTheDocument()
    // A cluster's shared IP is listed without a device link.
    expect(screen.getByText('BD-CORE-STACK')).not.toHaveAttribute('href')
    expect(screen.getByText('IP quản trị cụm')).toBeInTheDocument()
    expect(screen.getByText(/2 IP khác đang được thiết bị ngoài phạm vi/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Tìm IP trống' }))
    expect(await screen.findByText('10.72.114.10/24')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Thêm dải IP' }))
    const dialog = await screen.findByRole('dialog', { name: 'Thêm dải IP' })
    fireEvent.change(within(dialog).getByLabelText(/Loại dải/), { target: { value: 'reserved' } })
    expect(within(dialog).getByText(/Giữ lại, không cấp cho ai/)).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText(/Từ địa chỉ/), {
      target: { value: '10.72.114.250' },
    })
    fireEvent.change(within(dialog).getByLabelText(/Đến địa chỉ/), {
      target: { value: '10.72.114.254' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    const isPost = (r: Request) => r.method === 'POST' && r.url.endsWith('/ranges')
    await waitFor(() => expect(calls.some(isPost)).toBe(true))
    expect(await calls.find(isPost)!.clone().json()).toEqual({
      startIp: '10.72.114.250',
      endIp: '10.72.114.254',
      kind: 'reserved',
      purpose: '',
    })
  })

  it('a viewer sees the subnet without edit actions', async () => {
    fakeApi(
      ipamRoutes({
        [`GET /api/orgs/${ORG_ID}/subnets/sn-1`]: () => json({ ...DETAIL, access: 'view' }),
      }),
    )
    renderAt(`/o/${ORG_ID}/ipam/subnets/sn-1`)
    expect(await screen.findByRole('heading', { name: '10.72.114.0/24' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sửa subnet' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Thêm dải IP' })).not.toBeInTheDocument()
  })
})

describe('endpoint groups (P1-11)', () => {
  const GROUP = {
    id: 'eg-1',
    kind: 'ip_camera',
    name: 'Camera nhà xưởng',
    siteId: AGRI_SITE.id,
    siteCode: 'VPM-AGRI-BD01',
    siteName: 'Nhà máy Bình Định',
    categoryPath: 'Mẫu Agri',
    ipRangeId: 'rg-1',
    rangeStart: '10.72.114.100',
    rangeEnd: '10.72.114.119',
    rangeKind: 'static',
    rangePurpose: 'Camera',
    subnetId: 'sn-1',
    subnetCidr: '10.72.114.0/24',
    vrf: '',
    expectedCount: null,
    memberCount: 1,
    total: 20,
    notes: '',
    access: 'edit',
    version: 1,
  }
  const MEMBER = {
    id: 'em-1',
    name: 'CAM-01',
    ip: '10.72.114.100',
    address: '10.72.114.100/24',
    mac: 'aa:bb:cc:00:00:01',
    interfaceId: 'if-9',
    interfaceName: 'Gi1/0/5',
    portDeviceId: 'sw-1',
    portHostname: 'AGRI-BD-SW01',
    notes: '',
    version: 1,
  }
  const SW = { id: 'sw-1', hostname: 'AGRI-BD-SW01', type: 'poe_switch', siteId: AGRI_SITE.id }
  const PORTS = [
    { id: 'if-9', name: 'Gi1/0/5', kind: 'physical' },
    { id: 'if-10', name: 'Gi1/0/6', kind: 'physical' },
    { id: 'if-11', name: 'Vlan20', kind: 'svi' },
  ]
  const routes = (extra: Record<string, () => Response> = {}) =>
    siteRoutes({
      [`GET /api/orgs/${ORG_ID}/sites`]: () => json({ sites: [SITE, AGRI_SITE] }),
      [`GET /api/orgs/${ORG_ID}/categories`]: () => json({ categories: [] }),
      [`GET /api/orgs/${ORG_ID}/clusters`]: () => json({ clusters: [] }),
      [`GET /api/orgs/${ORG_ID}/devices`]: () => json({ devices: [SW], total: 1, facets: {} }),
      [`GET /api/orgs/${ORG_ID}/devices/sw-1/interfaces`]: () => json({ interfaces: PORTS }),
      [`GET /api/orgs/${ORG_ID}/endpoint-groups`]: () => json({ groups: [GROUP] }),
      [`GET /api/orgs/${ORG_ID}/endpoint-groups/eg-1`]: () => json({ ...GROUP, members: [MEMBER] }),
      [`GET /api/orgs/${ORG_ID}/subnets`]: () => json({ subnets: [SUBNET, OTHER_SITE_SUBNET] }),
      [`GET /api/orgs/${ORG_ID}/subnets/sn-1`]: () =>
        json({
          ...SUBNET,
          ranges: [
            {
              id: 'rg-1',
              startIp: '10.72.114.100',
              endIp: '10.72.114.119',
              kind: 'static',
              purpose: 'Camera',
              size: 20,
              usedCount: 1,
              version: 1,
            },
          ],
          ips: [],
          hiddenCount: 0,
        }),
      ...extra,
    })

  it('device page tab lists groups and creates one linked to a range', async () => {
    const calls = fakeApi(
      routes({
        [`POST /api/orgs/${ORG_ID}/endpoint-groups`]: () => json({ ...GROUP, members: [] }, 201),
      }),
    )
    renderAt(`/o/${ORG_ID}/devices?tab=groups`)
    expect(await screen.findByRole('link', { name: 'Camera nhà xưởng' })).toHaveAttribute(
      'href',
      `/o/${ORG_ID}/endpoint-groups/eg-1`,
    )
    expect(screen.getByRole('meter', { name: 'Đã dùng / tổng Camera nhà xưởng' })).toHaveAttribute(
      'aria-valuetext',
      '1 / 20 (5%)',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Thêm nhóm đầu cuối' }))
    const dialog = await screen.findByRole('dialog', { name: 'Thêm nhóm đầu cuối' })
    fireEvent.change(within(dialog).getByLabelText(/Tên nhóm/), {
      target: { value: ' Camera kho ' },
    })
    await waitFor(() =>
      expect(within(dialog).getByLabelText(/^Site/)).toContainHTML('VPM-AGRI-BD01'),
    )
    fireEvent.change(within(dialog).getByLabelText(/^Site/), { target: { value: AGRI_SITE.id } })
    const subnetSelect = within(dialog).getByLabelText('Subnet')
    // Only the site's subnets (and organization-wide ones).
    expect(within(subnetSelect).queryByText(/10\.80\.0\.0/)).not.toBeInTheDocument()
    fireEvent.change(subnetSelect, { target: { value: 'sn-1' } })
    const rangeSelect = within(dialog).getByLabelText('Dải IP')
    await waitFor(() => expect(rangeSelect).toContainHTML('10.72.114.100 – 10.72.114.119'))
    fireEvent.change(rangeSelect, { target: { value: 'rg-1' } })
    fireEvent.change(within(dialog).getByLabelText(/Số lượng dự kiến/), { target: { value: '12' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    const isPost = (r: Request) => r.method === 'POST' && r.url.endsWith('/endpoint-groups')
    await waitFor(() => expect(calls.some(isPost)).toBe(true))
    expect(await calls.find(isPost)!.clone().json()).toEqual({
      kind: 'ip_camera',
      name: 'Camera kho',
      siteId: AGRI_SITE.id,
      ipRangeId: 'rg-1',
      expectedCount: 12,
      notes: '',
    })
  })

  it('group page adds a member on a switch port and splits one off as a device', async () => {
    const calls = fakeApi(
      routes({
        [`POST /api/orgs/${ORG_ID}/endpoint-groups/eg-1/members`]: () => json(MEMBER, 201),
        [`POST /api/orgs/${ORG_ID}/endpoint-groups/eg-1/members/em-1/promote`]: () =>
          json({ id: 'dev-9', hostname: 'CAM-01' }, 201),
      }),
    )
    renderAt(`/o/${ORG_ID}/endpoint-groups/eg-1`)
    expect(await screen.findByRole('heading', { name: 'Camera nhà xưởng' })).toBeInTheDocument()
    expect(screen.getByText('10.72.114.100/24')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'AGRI-BD-SW01' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Thêm thành viên' }))
    const dialog = await screen.findByRole('dialog', { name: 'Thêm thành viên' })
    expect(
      within(dialog).getByText('Phải nằm trong dải 10.72.114.100 – 10.72.114.119.'),
    ).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText(/^Tên/), { target: { value: 'CAM-02' } })
    fireEvent.change(within(dialog).getByLabelText(/^IP/), { target: { value: '10.72.114.101' } })
    const sw = within(dialog).getByLabelText(/Cắm vào thiết bị/)
    await waitFor(() => expect(sw).toContainHTML('AGRI-BD-SW01'))
    fireEvent.change(sw, { target: { value: 'sw-1' } })
    const port = within(dialog).getByLabelText('Cổng')
    await waitFor(() => expect(port).toContainHTML('Gi1/0/6'))
    // Only physical ports: a device cannot plug into an SVI.
    expect(within(port).queryByText('Vlan20')).not.toBeInTheDocument()
    fireEvent.change(port, { target: { value: 'if-10' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    const isPost = (r: Request) => r.method === 'POST' && r.url.endsWith('/members')
    await waitFor(() => expect(calls.some(isPost)).toBe(true))
    expect(await calls.find(isPost)!.clone().json()).toEqual({
      name: 'CAM-02',
      ip: '10.72.114.101',
      mac: null,
      interfaceId: 'if-10',
      notes: '',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Tách thành thiết bị CAM-01' }))
    const promote = await screen.findByRole('dialog', { name: 'Tách CAM-01 thành thiết bị riêng' })
    expect(within(promote).getByRole('textbox')).toHaveValue('CAM-01')
    fireEvent.change(within(promote).getByRole('textbox'), {
      target: { value: 'AGRI-BD-CAM01' },
    })
    fireEvent.click(within(promote).getByRole('button', { name: 'Lưu' }))
    const isPromote = (r: Request) => r.url.endsWith('/promote')
    await waitFor(() => expect(calls.some(isPromote)).toBe(true))
    expect(await calls.find(isPromote)!.clone().json()).toEqual({ hostname: 'AGRI-BD-CAM01' })
  })

  it('a viewer sees the group without edit actions', async () => {
    fakeApi(
      routes({
        [`GET /api/orgs/${ORG_ID}/endpoint-groups/eg-1`]: () =>
          json({ ...GROUP, access: 'view', members: [MEMBER] }),
      }),
    )
    renderAt(`/o/${ORG_ID}/endpoint-groups/eg-1`)
    expect(await screen.findByRole('heading', { name: 'Camera nhà xưởng' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Thêm thành viên' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Tách thành thiết bị/ })).not.toBeInTheDocument()
  })
})

describe('diagrams (P1-13)', () => {
  const DIAGRAM = {
    id: 'dg-1',
    name: 'LAN Bình Định',
    layer: 'physical',
    description: '',
    nodeCount: 1,
    updatedAt: '2026-10-16T00:00:00Z',
    access: 'edit',
    version: 3,
  }
  const FW = {
    id: 'dev-1',
    hostname: 'AGRI-BD-FW01',
    mgmtIp: '10.72.114.1/24',
    type: 'firewall',
    siteId: AGRI_SITE.id,
    siteCode: 'VPM-AGRI-BD01',
  }
  const SW = {
    id: 'dev-2',
    hostname: 'AGRI-BD-SW01',
    type: 'l2_switch',
    siteId: AGRI_SITE.id,
    siteCode: 'VPM-AGRI-BD01',
  }
  const FGT = {
    id: 'tpl-1',
    name: 'FortiGate 100F',
    type: 'firewall',
    vendor: 'Fortinet',
    model: 'FortiGate 100F',
    partNumber: 'FG-100F',
    uHeight: 1,
    ports: [{ pattern: 'port{n}', start: 1, count: 2, media: 'RJ45', speed: '1G' }],
    portCount: 22,
    notes: '',
    version: 1,
  }
  const DETAIL = {
    diagram: DIAGRAM,
    view: {
      nodes: [{ id: 'n1', refKind: 'device', refId: 'dev-1', x: 0, y: 0 }],
      edges: [],
      annotations: [],
    },
    devices: [FW],
    endpointGroups: [],
    links: [],
    hiddenRefs: [],
  }
  const routes = (extra: Record<string, () => Response> = {}) =>
    siteRoutes({
      [`GET /api/orgs/${ORG_ID}/sites`]: () => json({ sites: [SITE, AGRI_SITE] }),
      [`GET /api/orgs/${ORG_ID}/categories`]: () => json({ categories: [] }),
      [`GET /api/orgs/${ORG_ID}/diagrams`]: () => json({ diagrams: [DIAGRAM] }),
      [`GET /api/orgs/${ORG_ID}/diagrams/dg-1`]: () => json(DETAIL),
      [`GET /api/orgs/${ORG_ID}/devices`]: () => json({ devices: [FW, SW], total: 2, facets: {} }),
      [`GET /api/orgs/${ORG_ID}/device-templates`]: () => json({ templates: [FGT] }),
      [`GET /api/orgs/${ORG_ID}/devices/dev-1`]: () =>
        json({
          ...FW,
          vendor: '',
          model: '',
          role: 'edge',
          lifecycle: 'active',
          managed: true,
          notes: '',
          tags: [],
          customFields: {},
          version: 3,
        }),
      ...extra,
    })
  beforeEach(() => {
    setDraftStore(memoryDraftStore())
    localStorage.removeItem('ntb-editor-prefs-v1')
    localStorage.removeItem('ntb-viewport:dg-1')
  })

  it('lists diagrams and creates one owned by the organization', async () => {
    const calls = fakeApi(
      routes({
        [`POST /api/orgs/${ORG_ID}/diagrams`]: () =>
          json({ ...DETAIL, diagram: { ...DIAGRAM, id: 'dg-2' } }, 201),
      }),
    )
    renderAt(`/o/${ORG_ID}/diagrams`)
    expect(await screen.findByRole('link', { name: 'LAN Bình Định' })).toHaveAttribute(
      'href',
      `/o/${ORG_ID}/diagrams/dg-1`,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Tạo sơ đồ' }))
    const dialog = await screen.findByRole('dialog', { name: 'Tạo sơ đồ' })
    fireEvent.change(within(dialog).getByLabelText(/Tên sơ đồ/), {
      target: { value: 'LAN tầng 3' },
    })
    expect(within(dialog).queryByLabelText(/^Site/)).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tạo' }))
    const isPost = (r: Request) => r.method === 'POST' && r.url.endsWith('/diagrams')
    await waitFor(() => expect(calls.some(isPost)).toBe(true))
    expect(await calls.find(isPost)!.clone().json()).toEqual({
      name: 'LAN tầng 3',
      layer: 'physical',
    })
  })

  it('library places an inventory device on the canvas; undo / redo; Ctrl+S saves view + version', async () => {
    const calls = fakeApi(
      routes({
        [`POST /api/orgs/${ORG_ID}/diagrams/dg-1/save`]: () =>
          json({
            detail: { ...DETAIL, diagram: { ...DIAGRAM, version: 4 }, devices: [FW, SW] },
            idMap: {},
          }),
      }),
    )
    renderAt(`/o/${ORG_ID}/diagrams/dg-1`)
    expect(await screen.findByRole('heading', { name: 'LAN Bình Định' })).toBeInTheDocument()
    // P1-14: the side menu folds while drawing; the canvas shows the drawn device.
    expect(screen.getByRole('button', { name: 'Mở rộng menu' })).toBeInTheDocument()
    const canvas = screen.getByRole('application')
    expect(within(canvas).getByText('AGRI-BD-FW01')).toBeInTheDocument()
    // Each device shows its management IP (without the prefix length) under the hostname.
    expect(within(canvas).getByText('10.72.114.1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Lưu/ })).toBeDisabled()
    // P1-15: the library is open; its inventory tab offers what is not drawn yet.
    const library = screen.getByRole('complementary', { name: 'Thư viện' })
    fireEvent.click(within(library).getByRole('tab', { name: /Trong kho/ }))
    const place = await within(library).findByRole('button', { name: /^Đặt AGRI\-BD\-SW01/ })
    expect(
      within(library).queryByRole('button', { name: /^Đặt AGRI\-BD\-FW01/ }),
    ).not.toBeInTheDocument()
    fireEvent.click(place)
    expect(await within(canvas).findByText('AGRI-BD-SW01')).toBeInTheDocument()
    expect(screen.getByText(/Có thay đổi chưa lưu/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }))
    await waitFor(() => expect(within(canvas).queryByText('AGRI-BD-SW01')).not.toBeInTheDocument())
    // Back at the saved state: nothing to save.
    expect(screen.getByRole('button', { name: /^Lưu/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Làm lại' }))
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    const isSave = (r: Request) => r.url.endsWith('/save')
    await waitFor(() => expect(calls.some(isSave)).toBe(true))
    const body = await calls.find(isSave)!.clone().json()
    expect(body.version).toBe(3)
    expect(body.changes).toEqual([])
    expect(body.view.nodes.map((n: { refId: string }) => n.refId)).toEqual(['dev-1', 'dev-2'])
    expect(await screen.findByText(/Đã lưu/, { selector: 'p' })).toBeInTheDocument()
  })

  it('a new device from a template gets the shared site; the hostname is typed or taken from the suggestion', async () => {
    const calls = fakeApi(
      routes({
        [`POST /api/orgs/${ORG_ID}/diagrams/dg-1/save`]: () => json({ detail: DETAIL, idMap: {} }),
      }),
    )
    renderAt(`/o/${ORG_ID}/diagrams/dg-1`)
    const library = await screen.findByRole('complementary', { name: 'Thư viện' })
    // Each type has a one-line description; templates come first.
    expect(
      within(library).getByText('Cấp nguồn qua dây mạng cho camera, AP, điện thoại IP'),
    ).toBeInTheDocument()
    fireEvent.change(within(library).getByLabelText('Tìm loại, model, hostname…'), {
      target: { value: 'fortigate' },
    })
    fireEvent.click(await within(library).findByRole('button', { name: /^Thêm FortiGate 100F/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Thiết bị mới' })
    // The diagram shows devices of one site only: that site is offered.
    await waitFor(() => expect(within(dialog).getByLabelText(/^Site/)).toHaveValue(AGRI_SITE.id))
    expect(within(dialog).getByLabelText(/^Template thiết bị|^Template/)).toHaveValue('org:tpl-1')
    // ADR-033: the user names the device; the site-path suggestion sits under the field.
    const host = within(dialog).getByLabelText(/^Hostname/)
    expect(host).toHaveValue('')
    expect(within(dialog).getByRole('button', { name: 'Đặt lên sơ đồ' })).toBeDisabled()
    fireEvent.click(
      await within(dialog).findByRole('button', { name: 'Dùng gợi ý AGRI-BD01-FW01' }),
    )
    expect(host).toHaveValue('AGRI-BD01-FW01')
    fireEvent.change(host, { target: { value: 'Tường lửa 2' } })
    expect(within(dialog).getByText(/chỉ dùng chữ A–Z không dấu/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Đặt lên sơ đồ' })).toBeDisabled()
    fireEvent.change(host, { target: { value: 'AGRI-BD01-FW02' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đặt lên sơ đồ' }))
    const canvas = screen.getByRole('application')
    expect(await within(canvas).findByText('AGRI-BD01-FW02')).toBeInTheDocument()
    expect(within(canvas).getByText('chưa lưu')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    const isSave = (r: Request) => r.url.endsWith('/save')
    await waitFor(() => expect(calls.some(isSave)).toBe(true))
    const body = await calls.find(isSave)!.clone().json()
    expect(body.changes).toEqual([
      {
        op: 'createDevice',
        tempId: expect.any(String),
        device: {
          hostname: 'AGRI-BD01-FW02',
          type: 'firewall',
          siteId: AGRI_SITE.id,
          templateId: 'tpl-1',
        },
        // P1-17: the template's ports, so cables drawn before saving can name them.
        portTempIds: [
          { name: 'port1', tempId: expect.any(String) },
          { name: 'port2', tempId: expect.any(String) },
        ],
      },
    ])
  })

  it('"/" quick add finds an inventory device; B hides the library; keys in the library do not touch the canvas', async () => {
    fakeApi(routes())
    renderAt(`/o/${ORG_ID}/diagrams/dg-1`)
    const canvas = await screen.findByRole('application')
    const library = screen.getByRole('complementary', { name: 'Thư viện' })
    // Delete / select all pressed while the library has the focus are ignored.
    const entry = within(library).getAllByRole('button', { name: /^Thêm / })[0]!
    fireEvent.keyDown(entry, { key: 'a', ctrlKey: true })
    fireEvent.keyDown(entry, { key: 'Delete' })
    expect(within(canvas).getByText('AGRI-BD-FW01')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: '/' })
    const quick = await screen.findByRole('dialog', { name: 'Thêm nhanh' })
    fireEvent.click(await within(quick).findByText('AGRI-BD-SW01'))
    expect(await within(canvas).findByText('AGRI-BD-SW01')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'b' })
    expect(screen.queryByRole('complementary', { name: 'Thư viện' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Thư viện' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('canvas keys: select all + Delete removes from the diagram only; ? lists shortcuts; hints can be hidden', async () => {
    const calls = fakeApi(routes())
    renderAt(`/o/${ORG_ID}/diagrams/dg-1`)
    const canvas = await screen.findByRole('application')
    expect(within(canvas).getByText('AGRI-BD-FW01')).toBeInTheDocument()
    // Every toolbar button names its shortcut for assistive tech too.
    expect(screen.getByRole('button', { name: 'Vừa màn hình' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Shift+1',
    )
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'Delete' })
    await waitFor(() => expect(within(canvas).queryByText('AGRI-BD-FW01')).not.toBeInTheDocument())
    expect(calls.some((r) => r.method === 'DELETE')).toBe(false)
    expect(screen.getByText(/Có thay đổi chưa lưu/)).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(await within(canvas).findByText('AGRI-BD-FW01')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: '?' })
    const sheet = await screen.findByRole('dialog', { name: 'Phím tắt' })
    expect(
      within(sheet).getByText('Gỡ mục đang chọn khỏi sơ đồ (kho giữ nguyên)'),
    ).toBeInTheDocument()
    fireEvent.keyDown(sheet, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(screen.getByRole('heading', { name: 'Mẹo dùng màn vẽ' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Đã hiểu, ẩn gợi ý' }))
    expect(screen.queryByRole('heading', { name: 'Mẹo dùng màn vẽ' })).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('ntb-editor-prefs-v1')!)).toMatchObject({ tips: false })
    expect(screen.getByRole('button', { name: 'Gợi ý thao tác' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('a stale save shows the conflict; a draft from an earlier session can be restored', async () => {
    const drafts = memoryDraftStore()
    setDraftStore(drafts)
    await drafts.put({
      diagramId: 'dg-1',
      baseVersion: 3,
      savedAt: '2026-10-16T08:00:00Z',
      doc: {
        view: { nodes: [], edges: [], annotations: [] },
        devices: {},
        groups: {},
        links: {},
        hidden: [],
        newDevices: {},
        newDeviceOrder: [],
        deviceEdits: {},
        deletedDevices: [],
        newLinks: {},
        newLinkOrder: [],
        linkEdits: {},
        deletedLinks: [],
      },
    })
    fakeApi(
      routes({
        [`POST /api/orgs/${ORG_ID}/diagrams/dg-1/save`]: () =>
          json({ message: 'Sơ đồ đã được người khác lưu sau khi bạn mở' }, 409),
      }),
    )
    renderAt(`/o/${ORG_ID}/diagrams/dg-1`)
    expect(await screen.findByText(/Có bản nháp chưa lưu/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Khôi phục nháp' }))
    expect(await screen.findByText(/Sơ đồ trống/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Lưu/ }))
    expect(await screen.findByText('Sơ đồ đã được người khác lưu')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tải bản mới/ })).toBeInTheDocument()
  })

  it('P1-16: Ctrl+D clones the selection as a new planned device with the next hostname', async () => {
    const calls = fakeApi(
      routes({
        [`GET /api/orgs/${ORG_ID}/devices/dev-1`]: () =>
          json({
            ...FW,
            vendor: 'Fortinet',
            model: '100F',
            serialNumber: 'FG-1',
            templateId: null,
          }),
        [`GET /api/orgs/${ORG_ID}/links`]: () => json({ links: [] }),
        [`POST /api/orgs/${ORG_ID}/diagrams/dg-1/save`]: () => json({ detail: DETAIL, idMap: {} }),
      }),
    )
    renderAt(`/o/${ORG_ID}/diagrams/dg-1`)
    const canvas = await screen.findByRole('application')
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'd', ctrlKey: true })
    expect(await within(canvas).findByText('AGRI-BD-FW02')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    const isSave = (r: Request) => r.url.endsWith('/save')
    await waitFor(() => expect(calls.some(isSave)).toBe(true))
    const body = await calls.find(isSave)!.clone().json()
    expect(body.changes).toEqual([
      {
        op: 'createDevice',
        tempId: expect.any(String),
        device: expect.objectContaining({
          hostname: 'AGRI-BD-FW02',
          type: 'firewall',
          vendor: 'Fortinet',
          model: '100F',
          lifecycle: 'planned',
        }),
      },
    ])
    expect(body.changes[0].device).not.toHaveProperty('serialNumber')
  })

  it('P1-16: the right-click menu locks a node; Delete leaves a locked node', async () => {
    fakeApi(routes())
    renderAt(`/o/${ORG_ID}/diagrams/dg-1`)
    const canvas = await screen.findByRole('application')
    fireEvent.contextMenu(within(canvas).getByText('AGRI-BD-FW01'))
    const menu = await screen.findByRole('menu', { name: 'Thao tác' })
    expect(within(menu).getByRole('menuitem', { name: /Xóa khỏi kho/ })).toBeInTheDocument()
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Khóa vị trí/ }))
    expect(await within(canvas).findByLabelText('Đã khóa vị trí')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Delete' })
    expect(within(canvas).getByText('AGRI-BD-FW01')).toBeInTheDocument()
    // Undo the lock: the node is free again and Delete removes it from the diagram.
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'Delete' })
    await waitFor(() => expect(within(canvas).queryByText('AGRI-BD-FW01')).not.toBeInTheDocument())
  })

  it('P1-16: Shift+Delete lists every cable and other diagrams before deleting from the inventory', async () => {
    const calls = fakeApi(
      routes({
        [`POST /api/orgs/${ORG_ID}/devices/delete-impact`]: () =>
          json({
            devices: [
              {
                id: 'dev-1',
                hostname: 'AGRI-BD-FW01',
                siteCode: 'VPM-AGRI-BD01',
                clusterName: 'BD-HA',
                clusterMembersLeft: 1,
                ipCount: 3,
              },
            ],
            links: [
              {
                id: 'lk-x',
                kind: 'ethernet',
                a: { kind: 'device', id: 'dev-1', name: 'AGRI-BD-FW01', interfaceName: 'wan1' },
                b: { kind: 'device', id: 'dev-9', name: 'ISP-R1', interfaceName: '' },
              },
            ],
            diagrams: [
              { id: 'dg-1', name: 'LAN Bình Định', deviceIds: ['dev-1'] },
              { id: 'dg-7', name: 'WAN tổng quan', deviceIds: ['dev-1'] },
            ],
          }),
        [`POST /api/orgs/${ORG_ID}/diagrams/dg-1/save`]: () => json({ detail: DETAIL, idMap: {} }),
      }),
    )
    renderAt(`/o/${ORG_ID}/diagrams/dg-1`)
    const canvas = await screen.findByRole('application')
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'Delete', shiftKey: true })
    const dialog = await screen.findByRole('dialog', { name: 'Xóa 1 thiết bị khỏi kho?' })
    expect(await within(dialog).findByText(/AGRI-BD-FW01 wan1 ↔ ISP-R1/)).toBeInTheDocument()
    expect(within(dialog).getByText(/không có trên sơ đồ này/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Cũng đang có trên sơ đồ: WAN tổng quan/)).toBeInTheDocument()
    expect(within(dialog).getByText(/cụm BD-HA: cụm còn 1 thành viên/)).toBeInTheDocument()
    expect(within(dialog).getByText(/3 địa chỉ IP/)).toBeInTheDocument()
    expect(calls.some((r) => r.method === 'DELETE')).toBe(false)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xóa khỏi kho' }))
    await waitFor(() => expect(within(canvas).queryByText('AGRI-BD-FW01')).not.toBeInTheDocument())
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    const isSave = (r: Request) => r.url.endsWith('/save')
    await waitFor(() => expect(calls.some(isSave)).toBe(true))
    expect((await calls.find(isSave)!.clone().json()).changes).toEqual([
      { op: 'deleteDevice', id: 'dev-1' },
    ])
  })

  it('P1-16 review: an inventory device placed on the diagram brings its cables to what is drawn', async () => {
    const calls = fakeApi(
      routes({
        [`GET /api/orgs/${ORG_ID}/links`]: () =>
          json({
            links: [
              {
                id: 'lk-1',
                kind: 'ethernet',
                a: { kind: 'device', id: 'dev-1', name: 'AGRI-BD-FW01', interfaceName: 'port1' },
                b: { kind: 'device', id: 'dev-2', name: 'AGRI-BD-SW01', interfaceName: 'Gi1/0/1' },
              },
            ],
          }),
        [`POST /api/orgs/${ORG_ID}/diagrams/dg-1/save`]: () => json({ detail: DETAIL, idMap: {} }),
      }),
    )
    renderAt(`/o/${ORG_ID}/diagrams/dg-1`)
    const library = await screen.findByRole('complementary', { name: 'Thư viện' })
    fireEvent.click(within(library).getByRole('tab', { name: /Trong kho/ }))
    fireEvent.click(await within(library).findByRole('button', { name: /^Đặt AGRI\-BD\-SW01/ }))
    expect(
      await within(screen.getByRole('application')).findByText('AGRI-BD-SW01'),
    ).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    const isSave = (r: Request) => r.url.endsWith('/save')
    await waitFor(() => expect(calls.some(isSave)).toBe(true))
    const body = await calls.find(isSave)!.clone().json()
    expect(body.view.edges.map((e: { linkId: string }) => e.linkId)).toEqual(['lk-1'])
  })

  it('P1-17: L then two clicks draws a cable; ports of a device not saved yet come from its template', async () => {
    const calls = fakeApi(
      routes({
        [`GET /api/orgs/${ORG_ID}/devices/dev-1/interfaces`]: () =>
          json({
            interfaces: [
              { id: 'if-1', name: 'port1', kind: 'physical', media: 'RJ45', speed: '1G' },
              { id: 'if-2', name: 'x1', kind: 'physical', media: 'SFP+', speed: '10G' },
              { id: 'if-3', name: 'console', kind: 'physical', media: 'Console', speed: '' },
            ],
          }),
        [`GET /api/orgs/${ORG_ID}/links`]: () => json({ links: [] }),
        [`POST /api/orgs/${ORG_ID}/diagrams/dg-1/save`]: () => json({ detail: DETAIL, idMap: {} }),
      }),
    )
    renderAt(`/o/${ORG_ID}/diagrams/dg-1`)
    const library = await screen.findByRole('complementary', { name: 'Thư viện' })
    fireEvent.change(within(library).getByLabelText('Tìm loại, model, hostname…'), {
      target: { value: 'fortigate' },
    })
    fireEvent.click(await within(library).findByRole('button', { name: /^Thêm FortiGate 100F/ }))
    const add = await screen.findByRole('dialog', { name: 'Thiết bị mới' })
    await waitFor(() => expect(within(add).getByLabelText(/^Site/)).toHaveValue(AGRI_SITE.id))
    fireEvent.change(within(add).getByLabelText(/^Hostname/), {
      target: { value: 'AGRI-BD01-FW02' },
    })
    fireEvent.click(within(add).getByRole('button', { name: 'Đặt lên sơ đồ' }))
    const canvas = screen.getByRole('application')
    await within(canvas).findByText('AGRI-BD01-FW02')

    fireEvent.keyDown(window, { key: 'l' })
    expect(screen.getByRole('status')).toHaveTextContent('bấm thiết bị thứ nhất')
    fireEvent.click(within(canvas).getByText('AGRI-BD-FW01'))
    fireEvent.click(within(canvas).getByText('AGRI-BD01-FW02'))
    const dialog = await screen.findByRole('dialog', { name: 'Nối dây' })
    const near = within(dialog).getByLabelText('Cổng ở AGRI-BD-FW01')
    await waitFor(() => expect(near).toContainHTML('port1'))
    // A console port cannot take an Ethernet cable (greyed out); SFP+ can (DAC, copper SFP).
    expect(
      within(near).getByRole('option', { name: /console · Console.*không cắm được/ }),
    ).toBeDisabled()
    expect(within(near).getByRole('option', { name: /^x1 · SFP\+ 10G$/ })).toBeEnabled()
    fireEvent.change(near, { target: { value: 'if-1' } })
    const far = within(dialog).getByLabelText('Cổng ở AGRI-BD01-FW02')
    const farPort = within(far).getByRole('option', { name: /^port2/ }) as HTMLOptionElement
    fireEvent.change(far, { target: { value: farPort.value } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Nối' }))
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    const isSave = (r: Request) => r.url.endsWith('/save')
    await waitFor(() => expect(calls.some(isSave)).toBe(true))
    const body = await calls.find(isSave)!.clone().json()
    const create = body.changes.find((c: { op: string }) => c.op === 'createDevice')
    const port2 = create.portTempIds.find((p: { name: string }) => p.name === 'port2').tempId
    expect(body.changes.find((c: { op: string }) => c.op === 'createLink').link).toMatchObject({
      a: { kind: 'device', id: 'dev-1', interfaceId: 'if-1' },
      b: { kind: 'device', id: create.tempId, interfaceId: port2 },
      kind: 'ethernet',
    })
    expect(port2).toBe(farPort.value)
  })

  it('P1-18: the property panel edits a device quickly; label template and colour are saved with the view', async () => {
    const calls = fakeApi(
      routes({
        [`GET /api/orgs/${ORG_ID}/devices/dev-1/interfaces`]: () =>
          json({
            interfaces: [
              { id: 'if-1', name: 'port1', kind: 'physical', media: 'RJ45', speed: '1G' },
            ],
          }),
        [`GET /api/orgs/${ORG_ID}/links`]: () => json({ links: [] }),
        [`POST /api/orgs/${ORG_ID}/diagrams/dg-1/save`]: () => json({ detail: DETAIL, idMap: {} }),
      }),
    )
    renderAt(`/o/${ORG_ID}/diagrams/dg-1`)
    const panel = await screen.findByRole('complementary', { name: 'Thuộc tính' })
    // Nothing selected: diagram settings.
    fireEvent.change(within(panel).getByLabelText(/^Nhãn dưới thiết bị/), {
      target: { value: 'model' },
    })
    const canvas = screen.getByRole('application')
    fireEvent.click(within(canvas).getByText('AGRI-BD-FW01'))
    const model = await within(panel).findByLabelText(/^Model/)
    expect(within(panel).getByText(/Cổng \(0\/1 đang nối\)/)).toBeInTheDocument()
    fireEvent.change(model, { target: { value: 'FortiGate 100F' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Áp dụng' }))
    // The label now shows the model (template "hostname + model").
    expect(await within(canvas).findByText('FortiGate 100F')).toBeInTheDocument()
    fireEvent.click(within(panel).getByRole('radio', { name: 'Xanh lá' }))
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    const isSave = (r: Request) => r.url.endsWith('/save')
    await waitFor(() => expect(calls.some(isSave)).toBe(true))
    const body = await calls.find(isSave)!.clone().json()
    expect(body.view.labelTemplate).toBe('{hostname}\n{model}')
    expect(body.view.nodes[0].labelStyle).toEqual({ color: 'green' })
    expect(body.changes).toEqual([
      {
        op: 'updateDevice',
        id: 'dev-1',
        deviceUpdate: expect.objectContaining({ model: 'FortiGate 100F', version: 3 }),
      },
    ])
  })

  it('P1-18: the port mode / VLAN and a next-free IP go straight to IPAM from the panel (ADR-034)', async () => {
    const IFACE = {
      id: 'if-1',
      name: 'port1',
      kind: 'physical',
      media: 'RJ45',
      speed: '1G',
      duplex: 'auto',
      mode: '',
      accessVlan: null,
      nativeVlan: null,
      allowedVlans: '',
      poe: false,
      lagId: null,
      lagName: '',
      description: '',
      adminUp: true,
      mac: '',
      vlanTag: null,
      sortOrder: 1,
      isManagement: false,
      version: 1,
    }
    const calls = fakeApi(
      routes({
        [`GET /api/orgs/${ORG_ID}/devices/dev-1/interfaces`]: () => json({ interfaces: [IFACE] }),
        [`GET /api/orgs/${ORG_ID}/devices/dev-1/ips`]: () => json({ ips: [] }),
        [`GET /api/orgs/${ORG_ID}/links`]: () => json({ links: [] }),
        [`GET /api/orgs/${ORG_ID}/vlans`]: () => json({ vlans: [VLAN] }),
        [`GET /api/orgs/${ORG_ID}/subnets`]: () => json({ subnets: [SUBNET] }),
        [`GET /api/orgs/${ORG_ID}/subnets/${SUBNET.id}/next-free`]: () =>
          json({ address: '10.72.114.10/24' }),
        [`GET /api/orgs/${ORG_ID}/ipam/lookup`]: () =>
          json({ ip: '10.72.114.10', subnets: [SUBNET], assignments: [], hiddenCount: 0 }),
        [`PATCH /api/orgs/${ORG_ID}/devices/dev-1/interfaces/if-1`]: () =>
          json({ ...IFACE, mode: 'access', accessVlan: 10, version: 2 }),
        [`POST /api/orgs/${ORG_ID}/devices/dev-1/ips`]: () =>
          json(
            {
              id: 'ip-1',
              interfaceId: 'if-1',
              interfaceName: 'port1',
              address: '10.72.114.10/24',
              vrf: '',
              role: 'primary',
              description: '',
              version: 1,
            },
            201,
          ),
      }),
    )
    renderAt(`/o/${ORG_ID}/diagrams/dg-1`)
    const canvas = await screen.findByRole('application')
    fireEvent.click(within(canvas).getByText('AGRI-BD-FW01'))
    const panel = screen.getByRole('complementary', { name: 'Thuộc tính' })
    fireEvent.click(await within(panel).findByRole('button', { name: /^port1/ }))
    fireEvent.change(await within(panel).findByLabelText(/^Chế độ cổng/), {
      target: { value: 'access' },
    })
    const vlan = within(panel).getByLabelText(/^VLAN của cổng/)
    await waitFor(() => expect(vlan).toContainHTML('MGMT'))
    fireEvent.change(vlan, { target: { value: '10' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Lưu cổng' }))
    const isPatch = (r: Request) => r.method === 'PATCH' && r.url.endsWith('/interfaces/if-1')
    await waitFor(() => expect(calls.some(isPatch)).toBe(true))
    expect(await calls.find(isPatch)!.clone().json()).toMatchObject({
      mode: 'access',
      accessVlan: 10,
      allowedVlans: '',
      nativeVlan: null,
      version: 1,
    })
    const subnet = within(panel).getByLabelText(/^Subnet/)
    await waitFor(() => expect(subnet).toContainHTML(SUBNET.cidr))
    fireEvent.change(subnet, { target: { value: SUBNET.id } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Lấy IP trống kế tiếp' }))
    await waitFor(() =>
      expect(within(panel).getByLabelText(/^Địa chỉ IP/)).toHaveValue('10.72.114.10/24'),
    )
    fireEvent.click(within(panel).getByRole('button', { name: 'Gán IP' }))
    const isIp = (r: Request) => r.method === 'POST' && r.url.endsWith('/devices/dev-1/ips')
    await waitFor(() => expect(calls.some(isIp)).toBe(true))
    // The VRF follows the chosen subnet (review fix).
    expect(await calls.find(isIp)!.clone().json()).toEqual({
      interfaceId: 'if-1',
      address: '10.72.114.10/24',
      role: 'primary',
      vrf: SUBNET.vrf,
    })
    // Not a diagram change: nothing to save.
    expect(
      within(screen.getByRole('toolbar', { name: 'Thanh công cụ sơ đồ' })).getByRole('button', {
        name: /^Lưu/,
      }),
    ).toBeDisabled()
  })

  it('P1-19: Ctrl+G frames the selection, bound to the site the devices share; the frame is saved with the view', async () => {
    const calls = fakeApi(
      routes({
        [`POST /api/orgs/${ORG_ID}/diagrams/dg-1/save`]: () => json({ detail: DETAIL, idMap: {} }),
      }),
    )
    renderAt(`/o/${ORG_ID}/diagrams/dg-1`)
    const canvas = await screen.findByRole('application')
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'g', ctrlKey: true })
    // Named after the site, selected, with its panel.
    await waitFor(() => {
      const names = within(canvas)
        .getAllByRole('button')
        .map((b) => b.textContent ?? '')
      expect(names.some((n) => n.startsWith('VPM-AGRI-BD01') && n.includes('— khung'))).toBe(true)
    })
    const panel = screen.getByRole('complementary', { name: 'Thuộc tính' })
    expect(within(panel).getByRole('heading', { name: 'Khung' })).toBeInTheDocument()
    await waitFor(() => expect(within(panel).getByLabelText(/^Site/)).toHaveValue(AGRI_SITE.id))
    fireEvent.change(within(panel).getByLabelText(/^Tiêu đề/), {
      target: { value: 'Nhà máy Bình Định' },
    })
    expect(
      await within(canvas).findByRole('button', { name: /^Nhà máy Bình Định.*khung/ }),
    ).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    const isSave = (r: Request) => r.url.endsWith('/save')
    await waitFor(() => expect(calls.some(isSave)).toBe(true))
    const body = await calls.find(isSave)!.clone().json()
    expect(body.view.annotations).toEqual([
      expect.objectContaining({
        kind: 'zone',
        siteId: AGRI_SITE.id,
        text: 'Nhà máy Bình Định',
        width: expect.any(Number),
      }),
    ])
  })

  it('P1-20: checks run on the diagram; the Problems panel lists them and a click selects the node', async () => {
    const calls = fakeApi(
      routes({
        [`POST /api/orgs/${ORG_ID}/validation-context`]: () =>
          json({
            devices: [],
            interfaces: [],
            ips: [],
            links: [],
            subnets: [],
            groups: [],
            conflicts: [
              {
                kind: 'ip',
                severity: 'error',
                deviceId: 'dev-1',
                value: '10.72.114.1',
                other: 'AGRI-BD-SW09',
                otherInterface: 'Vlan10',
              },
            ],
          }),
      }),
    )
    renderAt(`/o/${ORG_ID}/diagrams/dg-1`)
    const canvas = await screen.findByRole('application')
    // Saved devices on the view are sent; the result lands on the toolbar button and as a node badge.
    const button = await screen.findByRole(
      'button',
      { name: /Vấn đề trên sơ đồ: 1 lỗi, 0 cảnh báo, 1 ghi chú/ },
      { timeout: 3000 },
    )
    const ctxCall = calls.find((r) => r.url.endsWith('/validation-context'))!
    expect(await ctxCall.clone().json()).toEqual({
      deviceIds: ['dev-1'],
      groupIds: [],
      interfaceIds: [],
    })
    expect(within(canvas).getAllByText('Lỗi').length).toBeGreaterThan(0)
    fireEvent.click(button)
    const panel = screen.getByRole('region', { name: 'Vấn đề' })
    const line = within(panel).getByRole('button', {
      name: /AGRI-BD-FW01: IP 10\.72\.114\.1 trùng với AGRI-BD-SW09 Vlan10/,
    })
    expect(within(panel).getByText('AGRI-BD-FW01 chưa có dây nối nào')).toBeInTheDocument()
    fireEvent.click(line)
    const props = screen.getByRole('complementary', { name: 'Thuộc tính' })
    expect(await within(props).findByLabelText(/^Hostname/)).toHaveValue('AGRI-BD-FW01')
  })

  it('a viewer opens the diagram read-only', async () => {
    fakeApi(
      routes({
        [`GET /api/orgs/${ORG_ID}/diagrams/dg-1`]: () =>
          json({ ...DETAIL, diagram: { ...DIAGRAM, access: 'view' } }),
      }),
    )
    renderAt(`/o/${ORG_ID}/diagrams/dg-1`)
    expect(await screen.findByText(/Chỉ xem/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Lưu/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Thư viện' })).not.toBeInTheDocument()
    // Delete does nothing for a viewer.
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'Delete' })
    expect(within(screen.getByRole('application')).getByText('AGRI-BD-FW01')).toBeInTheDocument()
    expect(screen.queryByText(/Có thay đổi chưa lưu/)).not.toBeInTheDocument()
    // The property panel shows the device read-only.
    const panel = screen.getByRole('complementary', { name: 'Thuộc tính' })
    expect(await within(panel).findByLabelText(/^Hostname/)).toBeDisabled()
  })
})

describe('dashboard (P1-24)', () => {
  it('shows figures, problems with a link and devices by site', async () => {
    const calls = fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      [`GET /api/orgs/${ORG_ID}/dashboard`]: () =>
        json({
          generatedAt: '2026-10-17T03:00:00Z',
          totals: {
            devices: 12,
            active: 10,
            planned: 2,
            spare: 0,
            rma: 0,
            retired: 1,
            missingInfo: 3,
            expiring: 1,
            expired: 0,
            errors: 1,
            warnings: 0,
            subnetsFull: 0,
          },
          bySite: [
            {
              siteId: 'site-1',
              code: 'ORG-FV-HCM01',
              name: 'HCM',
              total: 12,
              active: 10,
              planned: 2,
              spare: 0,
              rma: 0,
              retired: 1,
            },
          ],
          byType: [{ type: 'l2_switch', count: 7 }],
          problems: [
            {
              kind: 'duplicate_ip',
              severity: 'error',
              subject: '10.136.4.101',
              detail: 'PRN-01, VPN_CJIDC',
              count: 2,
            },
          ],
          missingInfo: [],
          expiring: [],
        }),
    })
    renderAt(`/o/${ORG_ID}`)
    expect(await screen.findByText('Trùng IP 10.136.4.101: PRN-01, VPN_CJIDC')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ORG-FV-HCM01' })).toHaveAttribute(
      'href',
      `/o/${ORG_ID}/devices?site=site-1`,
    )
    expect(screen.getByRole('link', { name: 'Mở' })).toHaveAttribute(
      'href',
      `/o/${ORG_ID}/devices?q=10.136.4.101`,
    )
    expect(calls.some((c) => c.url.endsWith('/dashboard'))).toBe(true)
  })
})

describe('design templates (P2-23)', () => {
  it('walks scenario → options → preview, then creates and opens the diagram', async () => {
    const calls = fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      [`GET /api/orgs/${ORG_ID}/diagrams`]: () => json({ diagrams: [] }),
      [`GET /api/orgs/${ORG_ID}/sites`]: () => json({ sites: [] }),
      [`GET /api/orgs/${ORG_ID}/categories`]: () => json({ categories: [] }),
      [`POST /api/orgs/${ORG_ID}/design-templates/preview`]: () =>
        json({
          devices: [
            {
              site: 'Văn phòng',
              role: 'firewall',
              hostname: 'VP-FW01',
              model: 'FortiGate 60F',
              vendor: 'Fortinet',
            },
          ],
          groups: [{ site: 'Văn phòng', name: 'Máy tính nhân viên', kind: 'pc', count: 30 }],
          subnets: [
            {
              site: 'Văn phòng',
              vlan: 20,
              name: 'Nhân viên',
              cidr: '10.20.20.0/24',
              gateway: '10.20.20.1',
              dhcp: '',
            },
          ],
          warnings: [],
          notes: ['Lưu ý thử'],
          totals: { devices: 1, cables: 12, sites: 1 },
        }),
      [`POST /api/orgs/${ORG_ID}/design-templates/apply`]: () =>
        json({ diagramId: 'dg-new', devices: 1, cables: 12, sites: 1, warnings: [] }, 201),
    })
    renderAt(`/o/${ORG_ID}/diagrams`)
    fireEvent.click(await screen.findByRole('button', { name: /Tạo từ mẫu/ }))
    const dialog = await screen.findByRole('dialog', { name: /^Tạo sơ đồ từ mẫu/ })
    fireEvent.click(within(dialog).getByRole('button', { name: /Văn phòng nhỏ/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tiếp' }))
    // HA is offered for Fortinet stacks only.
    fireEvent.change(within(dialog).getByLabelText('Bộ hãng thiết bị'), {
      target: { value: 'ubiquiti' },
    })
    expect(within(dialog).getByLabelText('Dự phòng (HA)')).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Bộ hãng thiết bị'), {
      target: { value: 'fortinet_cisco' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xem trước' }))
    expect(
      await within(dialog).findByText(/Sẽ tạo 1 thiết bị, 12 dây ở 1 site/),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('Lưu ý thử')).toBeInTheDocument()
    expect(within(dialog).getByText('10.20.20.0/24')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tạo sơ đồ' }))
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/design-templates/apply'))).toBe(true),
    )
  })
})

describe('overview diagrams (P2-21)', () => {
  const GRAPH = {
    sites: [
      {
        id: 'hq',
        code: 'ORG-HQ',
        localCode: 'HQ',
        name: 'Trụ sở',
        kind: 'office',
        categoryPath: '',
        devices: 10,
        planned: 0,
        groups: 2,
        gateway: 'FortiGate 100F ×2 HA',
        wan: ['VNPT · Internet 300M'],
        diagrams: [],
        peers: 2,
      },
      {
        id: 'cn1',
        code: 'ORG-CN01',
        localCode: 'CN01',
        name: 'Chi nhánh 01',
        kind: 'office',
        categoryPath: '',
        devices: 5,
        planned: 5,
        groups: 1,
        gateway: 'FortiGate 60F',
        wan: [],
        diagrams: [],
        peers: 1,
      },
      {
        id: 'cn2',
        code: 'ORG-CN02',
        localCode: 'CN02',
        name: 'Chi nhánh 02',
        kind: 'office',
        categoryPath: '',
        devices: 5,
        planned: 0,
        groups: 1,
        gateway: 'FortiGate 60F',
        wan: [],
        diagrams: [],
        peers: 1,
      },
    ],
    edges: [],
  }
  it('suggests the hub and creates an overview diagram of site nodes', async () => {
    const calls = fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      [`GET /api/orgs/${ORG_ID}/diagrams`]: () => json({ diagrams: [] }),
      [`GET /api/orgs/${ORG_ID}/categories`]: () => json({ categories: [] }),
      [`GET /api/orgs/${ORG_ID}/site-graph`]: () => json(GRAPH),
      [`POST /api/orgs/${ORG_ID}/diagrams`]: () =>
        json(
          {
            diagram: {
              id: 'ov1',
              name: 'Tổng quan — Toàn tổ chức',
              layer: 'overview',
              description: '',
              nodeCount: 0,
              updatedAt: '2026-10-18T00:00:00Z',
              access: 'admin',
              version: 1,
            },
          },
          201,
        ),
      [`POST /api/orgs/${ORG_ID}/diagrams/ov1/save`]: () => json({ version: 2 }),
    })
    renderAt(`/o/${ORG_ID}/diagrams`)
    fireEvent.click(await screen.findByRole('button', { name: 'Sơ đồ tổng quan' }))
    const dialog = await screen.findByRole('dialog', { name: 'Sơ đồ tổng quan từ kho' })
    // The head office (most linked) is pre-ticked as hub.
    await waitFor(() => expect(within(dialog).getAllByRole('checkbox')[0]).toBeChecked())
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tạo sơ đồ (3 site)' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/diagrams/ov1/save'))).toBe(true))
    const save = calls.find((c) => c.url.endsWith('/diagrams/ov1/save'))!
    const body = (await save.clone().json()) as { view: { nodes: { refKind: string }[] } }
    expect(body.view.nodes).toHaveLength(3)
    expect(body.view.nodes.every((n) => n.refKind === 'site')).toBe(true)
  })
})

describe('expiry alerts (P2-05)', () => {
  const SETTINGS = {
    enabled: true,
    kinds: ['warranty', 'license', 'eos'],
    milestones: [90, 60, 30, 7],
    emailAdmins: true,
    extraEmails: [],
    version: 0,
    recipients: ['owner@example.com'],
    smtpConfigured: false,
  }

  it('settings say when e-mail is not set up and save what was chosen', async () => {
    const calls = fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      [`GET /api/orgs/${ORG_ID}/alert-settings`]: () => json(SETTINGS),
      [`PUT /api/orgs/${ORG_ID}/alert-settings`]: () =>
        json({
          ...SETTINGS,
          kinds: ['warranty', 'eos'],
          version: 1,
          recipients: ['noc@example.com'],
        }),
      [`GET /api/orgs/${ORG_ID}/notifications`]: () => json({ notifications: [], unread: 0 }),
    })
    renderAt(`/o/${ORG_ID}/alerts`)
    expect(await screen.findByText(/Hệ thống chưa cấu hình gửi email/)).toBeInTheDocument()
    expect(screen.getByText('owner@example.com')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: /Hết license/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Chủ sở hữu và quản trị/ }))
    fireEvent.change(screen.getByLabelText(/Thêm địa chỉ/), {
      target: { value: 'noc@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/Báo trước/), { target: { value: '30, 7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    const put = (r: Request) => r.method === 'PUT' && r.url.endsWith('/alert-settings')
    await waitFor(() => expect(calls.some(put)).toBe(true))
    expect(await calls.find(put)!.clone().json()).toEqual({
      enabled: true,
      kinds: ['warranty', 'eos'],
      milestones: [30, 7],
      emailAdmins: false,
      extraEmails: ['noc@example.com'],
      version: 0,
    })
  })

  it('the bell counts unread milestones and marks them read once seen', async () => {
    const calls = fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      [`GET /api/orgs/${ORG_ID}/devices`]: () => json({ devices: [], total: 0, facets: {} }),
      [`GET /api/orgs/${ORG_ID}/notifications`]: () =>
        json({
          unread: 1,
          notifications: [
            {
              id: 'n1',
              kind: 'eos',
              deviceId: 'dev-1',
              hostname: 'CORE-SW01',
              siteCode: 'HCM01',
              dueDate: '2026-10-31',
              milestone: 30,
              createdAt: '2026-10-18T01:00:00Z',
              unread: true,
            },
          ],
        }),
      [`POST /api/orgs/${ORG_ID}/notifications/seen`]: () => new Response(null, { status: 204 }),
    })
    renderAt(`/o/${ORG_ID}/devices`)
    const bell = await screen.findByRole('button', { name: 'Thông báo — 1 chưa đọc' })
    fireEvent.click(bell)
    expect(await screen.findByRole('link', { name: 'CORE-SW01' })).toHaveAttribute(
      'href',
      `/o/${ORG_ID}/devices/dev-1`,
    )
    expect(screen.getByText(/Hãng ngừng hỗ trợ/)).toBeInTheDocument()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/notifications/seen'))).toBe(
        true,
      ),
    )
  })
})

describe('vendors & contracts (P2-04)', () => {
  const VENDOR = {
    id: 'v1',
    kind: 'isp',
    name: 'FPT Telecom',
    taxCode: '',
    website: '',
    supportPhone: '1900 6600',
    supportEmail: '',
    supportPortal: '',
    notes: '',
    contactCount: 1,
    contractCount: 1,
    nextEnd: '2026-12-31',
    version: 1,
  }

  it('lists vendors with a callable hotline and saves a new contract', async () => {
    const calls = fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      [`GET /api/orgs/${ORG_ID}/vendors`]: () => json({ vendors: [VENDOR] }),
      [`GET /api/orgs/${ORG_ID}/notifications`]: () => json({ notifications: [], unread: 0 }),
      [`POST /api/orgs/${ORG_ID}/contracts`]: () =>
        json(
          {
            contract: { id: 'k1', name: 'Leased line' },
            devices: [],
            hiddenDevices: 0,
            links: [],
            files: [],
            contacts: [],
          },
          201,
        ),
      [`GET /api/orgs/${ORG_ID}/contracts/k1`]: () => new Response('', { status: 404 }),
    })
    renderAt(`/o/${ORG_ID}/vendors`)
    expect(await screen.findByRole('link', { name: 'FPT Telecom' })).toHaveAttribute(
      'href',
      `/o/${ORG_ID}/vendors/v1`,
    )
    expect(screen.getByRole('link', { name: '1900 6600' })).toHaveAttribute('href', 'tel:1900 6600')
    fireEvent.click(screen.getByRole('button', { name: 'Thêm hợp đồng' }))
    const dialog = await screen.findByRole('dialog', { name: 'Thêm hợp đồng' })
    await within(dialog).findByRole('option', { name: 'FPT Telecom' })
    fireEvent.change(within(dialog).getByLabelText(/Nhà cung cấp/), { target: { value: 'v1' } })
    fireEvent.change(within(dialog).getByLabelText('Loại', { exact: true }), {
      target: { value: 'isp' },
    })
    fireEvent.change(within(dialog).getByLabelText(/Tên hợp đồng/), {
      target: { value: 'Leased line' },
    })
    fireEvent.change(within(dialog).getByLabelText(/Ngày hết hạn/), {
      target: { value: '2027-03-31' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    const post = (r: Request) => r.method === 'POST' && r.url.endsWith('/contracts')
    await waitFor(() => expect(calls.some(post)).toBe(true))
    expect(await calls.find(post)!.clone().json()).toMatchObject({
      vendorId: 'v1',
      kind: 'isp',
      name: 'Leased line',
      endDate: '2027-03-31',
      startDate: null,
      deviceIds: [],
      linkIds: [],
    })
  })
})

describe('password vault (P2-02 / P2-03)', () => {
  it('a secret stays masked; showing it asks for an MFA code when needed, then shows it', async () => {
    let revealed = 0
    const calls = fakeApi({
      'GET /api/auth/me': () => json(SESSION),
      [`GET /api/orgs/${ORG_ID}/notifications`]: () => json({ notifications: [], unread: 0 }),
      [`GET /api/orgs/${ORG_ID}/credentials`]: () =>
        json({
          credentials: [
            {
              id: 'c1',
              name: 'Switch admin',
              kind: 'ssh',
              username: 'admin',
              hasSecret: true,
              rotateDays: 90,
              lastRotatedOn: '2026-10-01',
              rotateDue: '2026-12-30',
              deviceCount: 3,
              notes: '',
              version: 1,
            },
          ],
        }),
      // First look: MFA too old (428); after the code, the secret.
      [`POST /api/orgs/${ORG_ID}/credentials/c1/reveal`]: () =>
        revealed++ === 0
          ? json({ message: 'Nhập mã MFA để xác nhận trước khi xem mật khẩu' }, 428)
          : json({ secret: 'Sw1tch!pass', clearAfterSeconds: 30 }),
      'POST /api/auth/mfa/verify': () => json(SESSION),
    })
    renderAt(`/o/${ORG_ID}/vault`)
    expect(await screen.findByText('Switch admin')).toBeInTheDocument()
    expect(screen.getByText('••••••••')).toBeInTheDocument()
    expect(screen.queryByText('Sw1tch!pass')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hiện mật khẩu của Switch admin' }))
    const mfa = await screen.findByRole('dialog', { name: 'Xác nhận MFA' })
    fireEvent.change(within(mfa).getByLabelText('Mã MFA'), { target: { value: '123456' } })
    fireEvent.click(within(mfa).getByRole('button', { name: 'Xác nhận' }))
    expect(await screen.findByText('Sw1tch!pass')).toBeInTheDocument()
    const verify = calls.find((c) => c.url.endsWith('/auth/mfa/verify'))!
    expect(await verify.clone().json()).toEqual({ code: '123456' })
    expect(calls.filter((c) => c.url.endsWith('/reveal')).length).toBe(2)
  })
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { AcceptInvitePage } from './app/AcceptInvitePage'
import { ForgotPasswordPage } from './app/ForgotPasswordPage'
import { LoginPage } from './app/LoginPage'
import { MfaSetupPage } from './app/MfaSetupPage'
import { MfaVerifyPage } from './app/MfaVerifyPage'
import { NotFoundPage } from './app/NotFoundPage'
import { OrgHomePage } from './app/OrgHomePage'
import { RequireAuth } from './app/RequireAuth'
import { RootRedirect } from './app/RootRedirect'
import { OrgShell, SystemShell } from './components/AppShell'
import { Toaster } from './components/Toaster'

const queryClient = new QueryClient()

// Route-level code splitting: React Flow and the module pages load on first use.
const AdminOrganizationsPage = lazy(() =>
  import('./modules/admin/AdminOrganizationsPage').then((m) => ({
    default: m.AdminOrganizationsPage,
  })),
)
const AdminUsersPage = lazy(() =>
  import('./modules/admin/AdminUsersPage').then((m) => ({ default: m.AdminUsersPage })),
)
const MembersPage = lazy(() =>
  import('./modules/admin/MembersPage').then((m) => ({ default: m.MembersPage })),
)
const SystemHealthPage = lazy(() =>
  import('./modules/admin/SystemHealthPage').then((m) => ({ default: m.SystemHealthPage })),
)
const DeviceDetailPage = lazy(() =>
  import('./modules/inventory/DeviceDetailPage').then((m) => ({ default: m.DeviceDetailPage })),
)
const DeviceListPage = lazy(() =>
  import('./modules/inventory/DeviceListPage').then((m) => ({ default: m.DeviceListPage })),
)
const AuditLogPage = lazy(() =>
  import('./modules/audit/AuditLogPage').then((m) => ({ default: m.AuditLogPage })),
)
const SiteListPage = lazy(() =>
  import('./modules/sites/SiteListPage').then((m) => ({ default: m.SiteListPage })),
)
const SiteDetailPage = lazy(() =>
  import('./modules/sites/SiteDetailPage').then((m) => ({ default: m.SiteDetailPage })),
)
const EditorPage = lazy(() =>
  import('./editor/EditorPage').then((m) => ({ default: m.EditorPage })),
)

// Component gallery: only in dev builds (tree-shaken from production).
const DevUiPage = import.meta.env.DEV
  ? lazy(() => import('./dev/DevUiPage').then((m) => ({ default: m.DevUiPage })))
  : null

const guard = (el: ReactNode) => (
  <RequireAuth>
    <Suspense fallback={null}>{el}</Suspense>
  </RequireAuth>
)

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/mfa" element={<MfaVerifyPage />} />
      <Route path="/mfa/setup" element={<MfaSetupPage />} />
      <Route path="/invite/:token" element={<AcceptInvitePage />} />
      <Route path="/" element={guard(<RootRedirect />)} />
      <Route path="/o/:orgId" element={guard(<OrgShell />)}>
        <Route index element={<OrgHomePage />} />
        <Route path="devices" element={<DeviceListPage />} />
        <Route path="devices/:deviceId" element={<DeviceDetailPage />} />
        <Route path="sites" element={<SiteListPage />} />
        <Route path="sites/:siteId" element={<SiteDetailPage />} />
        <Route path="members" element={<MembersPage />} />
        <Route path="audit" element={<AuditLogPage scope="org" />} />
        <Route path="*" element={<NotFoundPage inShell />} />
      </Route>
      <Route path="/admin" element={guard(<SystemShell />)}>
        <Route path="organizations" element={<AdminOrganizationsPage />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="audit" element={<AuditLogPage scope="system" />} />
        <Route path="health" element={<SystemHealthPage />} />
        <Route path="*" element={<NotFoundPage inShell />} />
      </Route>
      <Route path="/editor" element={guard(<EditorPage />)} />
      {DevUiPage && (
        <Route
          path="/dev/ui"
          element={
            <Suspense fallback={null}>
              <DevUiPage />
            </Suspense>
          }
        />
      )}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  )
}

export default App

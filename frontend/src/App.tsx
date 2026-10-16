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
import { CanvasView } from './editor/canvas/CanvasView'
import { Palette } from './editor/panels/Palette'
import { Sidebar } from './editor/panels/Sidebar'
import { AdminOrganizationsPage } from './modules/admin/AdminOrganizationsPage'
import { AdminUsersPage } from './modules/admin/AdminUsersPage'
import { MembersPage } from './modules/admin/MembersPage'
import { SystemHealthPage } from './modules/admin/SystemHealthPage'
import { DeviceDetailPage } from './modules/inventory/DeviceDetailPage'
import { DeviceListPage } from './modules/inventory/DeviceListPage'

const queryClient = new QueryClient()

// Component gallery: only in dev builds (tree-shaken from production).
const DevUiPage = import.meta.env.DEV
  ? lazy(() => import('./dev/DevUiPage').then((m) => ({ default: m.DevUiPage })))
  : null

/** Diagram editor screen; becomes /diagrams/:id once diagrams are served by the API (P1-13). */
function EditorPage() {
  return (
    <main className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Palette />
      <div className="flex-1">
        <CanvasView />
      </div>
      <Sidebar />
    </main>
  )
}

const guard = (el: ReactNode) => <RequireAuth>{el}</RequireAuth>

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
        <Route path="members" element={<MembersPage />} />
        <Route path="*" element={<NotFoundPage inShell />} />
      </Route>
      <Route path="/admin" element={guard(<SystemShell />)}>
        <Route path="organizations" element={<AdminOrganizationsPage />} />
        <Route path="users" element={<AdminUsersPage />} />
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

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router'
import { OrgHomePage } from './app/OrgHomePage'
import { LoginPage } from './app/LoginPage'
import { MfaSetupPage } from './app/MfaSetupPage'
import { MfaVerifyPage } from './app/MfaVerifyPage'
import { RequireAuth } from './app/RequireAuth'
import { RootRedirect } from './app/RootRedirect'
import { AdminOrganizationsPage } from './modules/admin/AdminOrganizationsPage'
import { AdminUsersPage } from './modules/admin/AdminUsersPage'
import { MembersPage } from './modules/admin/MembersPage'
import { AcceptInvitePage } from './app/AcceptInvitePage'
import { CanvasView } from './editor/canvas/CanvasView'
import { Palette } from './editor/panels/Palette'
import { Sidebar } from './editor/panels/Sidebar'

const queryClient = new QueryClient()

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

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/mfa" element={<MfaVerifyPage />} />
      <Route path="/mfa/setup" element={<MfaSetupPage />} />
      <Route path="/invite/:token" element={<AcceptInvitePage />} />
      <Route
        path="/o/:orgId/members"
        element={
          <RequireAuth>
            <MembersPage />
          </RequireAuth>
        }
      />
      <Route
        path="/admin/users"
        element={
          <RequireAuth>
            <AdminUsersPage />
          </RequireAuth>
        }
      />
      <Route
        path="/"
        element={
          <RequireAuth>
            <RootRedirect />
          </RequireAuth>
        }
      />
      <Route
        path="/o/:orgId"
        element={
          <RequireAuth>
            <OrgHomePage />
          </RequireAuth>
        }
      />
      <Route
        path="/admin/organizations"
        element={
          <RequireAuth>
            <AdminOrganizationsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/editor"
        element={
          <RequireAuth>
            <EditorPage />
          </RequireAuth>
        }
      />
    </Routes>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App

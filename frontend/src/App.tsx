import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router'
import { HomePage } from './app/HomePage'
import { LoginPage } from './app/LoginPage'
import { RequireAuth } from './app/RequireAuth'
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
      <Route
        path="/"
        element={
          <RequireAuth>
            <HomePage />
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

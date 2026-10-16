import { CanvasView } from './canvas/CanvasView'
import { Palette } from './panels/Palette'
import { Sidebar } from './panels/Sidebar'

/** Diagram editor screen; becomes /diagrams/:id once diagrams are served by the API (P1-13). */
export function EditorPage() {
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

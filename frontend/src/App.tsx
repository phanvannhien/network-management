import { CanvasView } from './editor/canvas/CanvasView'
import { Palette } from './editor/panels/Palette'
import { Sidebar } from './editor/panels/Sidebar'

function App() {
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

export default App

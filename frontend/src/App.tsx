import { CanvasView } from './canvas/CanvasView'
import { Palette } from './panels/Palette'
import { Sidebar } from './panels/Sidebar'

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

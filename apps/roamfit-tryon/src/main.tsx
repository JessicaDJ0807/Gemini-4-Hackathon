import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { Viewer3D } from './Viewer3D'
import './viewer3d.css'
import StudioApp from './studio/StudioApp'
import TwoModeStudio from './studio2/TwoModeStudio'
import TurnaroundStudio from './studio2/TurnaroundStudio'
import SceneStudio from './scene/SceneStudio'
import TryOnStudio from './tryon/TryOnStudio'

// Routes: #/tryon → integration-ready try-on studio (team contracts, Pieces/Looks sidebar) · #/studio → simplified full-scene try-on (current) · #/studio-turnaround → cut-out turnaround studio (previous)
//         #/studio-3d → experimental GLB studio · #/studio-legacy → procedural avatar · #/3d → video spin spike · default → original app
const h = location.hash
const view = h.startsWith('#/tryon') ? <TryOnStudio />
  : h.startsWith('#/studio-legacy') ? <StudioApp />
  : h.startsWith('#/studio-3d') ? <TwoModeStudio />
  : h.startsWith('#/studio-turnaround') ? <TurnaroundStudio />
  : h.startsWith('#/studio') ? <SceneStudio />
  : h.startsWith('#/3d') ? <Viewer3D glbUrl="/demo/person.glb" backdropUrl="/demo/montreal.jpg" fallbackVideoUrl="/demo/turnaround.mp4" />
  : <App />
createRoot(document.getElementById('root')!).render(<StrictMode>{view}</StrictMode>)

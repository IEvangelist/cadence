import { appName, tagline } from './appInfo'
import './App.css'

function App() {
  return (
    <main className="app">
      <h1>{appName}</h1>
      <p className="tagline">{tagline}</p>
      <p className="status">Phase 0 foundations · scaffolding online.</p>
    </main>
  )
}

export default App

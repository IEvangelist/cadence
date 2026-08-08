import { appName, tagline } from './appInfo'
import './App.css'

function App() {
  return (
    <main className="app">
      <div className="brand">
        <img className="brand-mark" src="/favicon.svg" alt="" aria-hidden="true" />
        <h1>{appName}</h1>
      </div>
      <p className="tagline">{tagline}</p>
      <p className="hook">Every idea, resolved.</p>
      <p className="status">Phase 0 foundations · scaffolding online.</p>
    </main>
  )
}

export default App

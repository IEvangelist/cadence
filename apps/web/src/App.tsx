import { appName, tagline } from './appInfo'
import { Composer } from './composer/Composer'
import './App.css'

function App() {
  return (
    <main className="app">
      <header className="app-header">
        <div className="brand">
          <img className="brand-mark" src="/favicon.svg" alt="" aria-hidden="true" />
          <h1>{appName}</h1>
        </div>
        <p className="tagline">{tagline}</p>
        <p className="hook">Every idea, resolved.</p>
      </header>
      <Composer />
    </main>
  )
}

export default App

import { RouterProvider, type RouterProviderProps } from 'react-router-dom'
import { createAppBrowserRouter } from './app/router'
import './auth/auth.css'
import './App.css'

const browserRouter = typeof document === 'undefined' ? null : createAppBrowserRouter()

interface AppProps {
  router?: RouterProviderProps['router']
}

function App({ router = browserRouter ?? createAppBrowserRouter() }: AppProps) {
  return <RouterProvider router={router} />
}

export default App

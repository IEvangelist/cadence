import {
  createBrowserRouter,
  createMemoryRouter,
  type InitialEntry,
  type RouteObject,
} from 'react-router-dom'
import { AppFrame } from './AppFrame'
import { AppProviders } from './AppProviders'
import type { ProjectStore } from '../composer/model/storage'
import {
  loadLicensesRoute,
  loadPricingRoute,
  loadProfileRoute,
  loadStemsRoute,
} from './routeLoaders'

function appRoutes(): RouteObject[] {
  return [
  {
    path: '/',
    hydrateFallbackElement: <p role="status">Loading Cadence…</p>,
    element: (
      <AppProviders>
        <AppFrame />
      </AppProviders>
    ),
    children: [
      {
        index: true,
        handle: { title: 'Cadence', announcement: 'Studio' },
        lazy: async () => {
          const { StudioRoute } = await import('./routes/StudioRoute')
          return { Component: StudioRoute }
        },
      },
      {
        path: 'stems',
        handle: { title: 'Stems | Cadence', announcement: 'Stems' },
        lazy: loadStemsRoute,
      },
      {
        path: 'pricing',
        handle: { title: 'Pricing | Cadence', announcement: 'Pricing' },
        lazy: loadPricingRoute,
      },
      {
        path: 'profile',
        handle: { title: 'Profile | Cadence', announcement: 'Profile' },
        lazy: loadProfileRoute,
      },
      {
        path: 'licenses',
        handle: { title: 'Licenses | Cadence', announcement: 'Licenses' },
        lazy: loadLicensesRoute,
      },
      {
        path: '*',
        handle: { title: 'Page not found | Cadence', announcement: 'Page not found' },
        lazy: async () => {
          const { NotFoundRoute } = await import('./routes/NotFoundRoute')
          return { Component: NotFoundRoute }
        },
      },
    ],
  },
  ]
}

export function createAppBrowserRouter() {
  return createBrowserRouter(appRoutes())
}

export function createAppMemoryRouter(
  initialEntries: InitialEntry[] = ['/'],
  store?: ProjectStore,
) {
  const routes = appRoutes()
  if (store) {
    routes[0].element = (
      <AppProviders store={store}>
        <AppFrame />
      </AppProviders>
    )
  }
  return createMemoryRouter(routes, { initialEntries })
}

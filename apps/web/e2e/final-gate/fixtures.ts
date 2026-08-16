import type { Page, Route } from '@playwright/test'
import type { Project } from '../../src/composer/model/project'

export type FinalGateTheme = 'light' | 'dark'
export type FinalGateAccount = 'anonymous' | 'free' | 'pro'

export interface FinalGateFixtureOptions {
  account?: FinalGateAccount
  project?: Project | null
  theme?: FinalGateTheme
}

interface RemoteProject {
  id: string
  name: string
  schemaVersion: number
  data: string
  createdAt: string
  updatedAt: string
}

export interface FinalGateMockState {
  projects: Map<string, RemoteProject>
}

const FIXED_DATE = '2025-02-03T04:05:06.000Z'
const FIXED_UPDATED_AT = Date.parse(FIXED_DATE)

export const finalGateUser = {
  id: 'final-gate-user',
  email: 'ada@example.test',
  displayName: 'Ada Test',
  tier: 'Pro',
} as const

export const finalGateEntitlements = {
  anonymous: {
    tier: 'Free',
    watermarkExports: true,
    maxProjects: 3,
    aiGenerationsPerDay: 5,
    advancedFormats: false,
    stemSeparation: false,
    collaborationSeats: 1,
  },
  free: {
    tier: 'Free',
    watermarkExports: true,
    maxProjects: 3,
    aiGenerationsPerDay: 5,
    advancedFormats: false,
    stemSeparation: false,
    collaborationSeats: 1,
  },
  pro: {
    tier: 'Pro',
    watermarkExports: false,
    maxProjects: -1,
    aiGenerationsPerDay: -1,
    advancedFormats: true,
    stemSeparation: true,
    collaborationSeats: 5,
  },
} as const

export function buildDeterministicProject(): Project {
  return {
    schemaVersion: 2,
    id: 'final-gate-project',
    name: 'Final Gate Fixture',
    tempo: 108,
    ppq: 480,
    lengthBeats: 16,
    loop: { enabled: false, start: 0, end: 16 },
    tracks: [
      {
        id: 'track-chords',
        name: 'Night Chords',
        instrumentId: 'poly-synth',
        muted: false,
        color: '#7a2ff0',
        notes: [
          {
            id: 'note-c4',
            pitch: 60,
            start: 0,
            duration: 2,
            velocity: 0.72,
          },
          {
            id: 'note-e4',
            pitch: 64,
            start: 2,
            duration: 2,
            velocity: 0.76,
          },
        ],
      },
      {
        id: 'track-bass',
        name: 'Pulse Bass',
        instrumentId: 'fm-synth',
        muted: false,
        color: '#12bddc',
        notes: [
          {
            id: 'note-c2',
            pitch: 36,
            start: 0,
            duration: 1,
            velocity: 0.84,
          },
        ],
      },
      {
        id: 'track-drums',
        name: 'Pocket Drums',
        instrumentId: 'drum-kit',
        muted: false,
        color: '#2563eb',
        notes: [
          {
            id: 'note-kick',
            pitch: 36,
            start: 0,
            duration: 0.5,
            velocity: 0.9,
          },
        ],
      },
    ],
    automation: [],
  }
}

export const finalGateStemJob = {
  id: 'final-gate-stems',
  status: 'Completed',
  originalFileName: 'final-gate-mix.wav',
  contentType: 'audio/wav',
  sizeBytes: 8192,
  createdAt: FIXED_DATE,
  updatedAt: FIXED_DATE,
  completedAt: FIXED_DATE,
  errorMessage: null,
  stems: [
    {
      label: 'bass',
      sizeBytes: 4096,
      url: '/api/stems/jobs/final-gate-stems/stems/bass',
    },
    {
      label: 'drums',
      sizeBytes: 4096,
      url: '/api/stems/jobs/final-gate-stems/stems/drums',
    },
  ],
} as const

function toRemoteProject(project: Project): RemoteProject {
  return {
    id: project.id,
    name: project.name,
    schemaVersion: project.schemaVersion,
    data: JSON.stringify(project),
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
  }
}

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

async function mockFinalGateApi(
  route: Route,
  account: FinalGateAccount,
  state: FinalGateMockState,
): Promise<void> {
  const request = route.request()
  const url = new URL(request.url())
  const path = url.pathname
  const method = request.method()
  const authenticated = account !== 'anonymous'

  if (path === '/api/auth/me') {
    return authenticated
      ? json(route, {
          ...finalGateUser,
          tier: account === 'pro' ? 'Pro' : 'Free',
        })
      : json(route, {}, 401)
  }
  if (path === '/api/auth/providers') return json(route, { providers: ['GitHub'] })
  if (path === '/api/auth/logout') return json(route, {}, 204)
  if (path === '/api/profile') {
    return authenticated
      ? json(route, {
          displayName: finalGateUser.displayName,
          bio: 'Composer and deterministic test fixture.',
          avatarUrl: '',
        })
      : json(route, {}, 401)
  }
  if (path === '/api/entitlements') {
    return json(route, finalGateEntitlements[account])
  }
  if (path === '/api/billing/checkout') {
    return json(route, { url: 'https://example.test/checkout' })
  }
  if (path === '/api/billing/portal') {
    return json(route, { url: 'https://example.test/portal' })
  }

  if (path === '/api/projects' && method === 'GET') {
    return json(
      route,
      authenticated
        ? [...state.projects.values()].map((project) => ({
            id: project.id,
            name: project.name,
            schemaVersion: project.schemaVersion,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
          }))
        : [],
    )
  }
  if (path === '/api/projects' && method === 'POST') {
    const payload = request.postDataJSON() as {
      id: string
      name: string
      schemaVersion: number
      data: string
    }
    const project = { ...payload, createdAt: FIXED_DATE, updatedAt: FIXED_DATE }
    state.projects.set(project.id, project)
    return json(route, project, 201)
  }

  const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/)
  if (projectMatch) {
    const id = decodeURIComponent(projectMatch[1])
    if (method === 'GET') {
      const project = state.projects.get(id)
      return project ? json(route, project) : json(route, {}, 404)
    }
    if (method === 'PUT') {
      const payload = request.postDataJSON() as {
        id: string
        name: string
        schemaVersion: number
        data: string
      }
      const project = { ...payload, createdAt: FIXED_DATE, updatedAt: FIXED_DATE }
      state.projects.set(id, project)
      return json(route, project)
    }
    if (method === 'DELETE') {
      state.projects.delete(id)
      return json(route, {}, 204)
    }
  }

  if (/^\/api\/projects\/[^/]+\/shares$/.test(path)) {
    return json(
      route,
      authenticated
        ? [
            {
              token: 'final-gate-editor',
              role: 'editor',
              createdAt: FIXED_DATE,
            },
            {
              token: 'final-gate-viewer',
              role: 'viewer',
              createdAt: FIXED_DATE,
            },
          ]
        : [],
    )
  }

  if (path === '/api/stems/jobs' && method === 'GET') {
    return json(route, account === 'pro' ? [finalGateStemJob] : [])
  }
  if (path === '/api/stems/jobs/final-gate-stems') {
    return json(route, finalGateStemJob)
  }
  if (/^\/api\/stems\/jobs\/final-gate-stems\/stems\/[^/]+$/.test(path)) {
    return route.fulfill({
      status: 200,
      contentType: 'audio/wav',
      body: Buffer.alloc(44),
    })
  }

  return json(route, {}, method === 'GET' ? 200 : 204)
}

export async function installFinalGateFixture(
  page: Page,
  options: FinalGateFixtureOptions = {},
): Promise<FinalGateMockState> {
  const account = options.account ?? 'pro'
  const project =
    options.project === undefined ? buildDeterministicProject() : options.project
  const theme = options.theme ?? 'light'
  const state: FinalGateMockState = {
    projects: new Map(project ? [[project.id, toRemoteProject(project)]] : []),
  }

  await page.addInitScript(
    ({ selectedTheme, localProject, updatedAt }) => {
      localStorage.clear()
      sessionStorage.clear()
      localStorage.setItem('cadence.v1.onboarding.seen', '1')
      localStorage.setItem('cadence.v1.theme', selectedTheme)
      if (localProject) {
        localStorage.setItem(
          `cadence.v1.project.${localProject.id}`,
          JSON.stringify(localProject),
        )
        localStorage.setItem(
          'cadence.v1.index',
          JSON.stringify([
            {
              id: localProject.id,
              name: localProject.name,
              updatedAt,
            },
          ]),
        )
        localStorage.setItem('cadence.v1.last', localProject.id)
      }
      ;(
        window as unknown as {
          __CADENCE_AI_MOCK__: boolean
        }
      ).__CADENCE_AI_MOCK__ = true
    },
    {
      selectedTheme: theme,
      localProject: account === 'anonymous' ? project : null,
      updatedAt: FIXED_UPDATED_AT,
    },
  )
  await page.route('**/api/**', (route) =>
    mockFinalGateApi(route, account, state),
  )
  return state
}

export const defaultProject = {
  schemaVersion: 1,
  id: 'e2e-returning-project',
  name: 'E2E Returning Project',
  tempo: 120,
  ppq: 480,
  lengthBeats: 16,
  loop: { enabled: false, start: 0, end: 16 },
  tracks: [
    {
      id: 'e2e-track',
      name: 'Synth',
      instrumentId: 'poly-synth',
      notes: [
        {
          id: 'e2e-note',
          pitch: 60,
          start: 0,
          duration: 1,
          velocity: 0.8,
        },
      ],
      muted: false,
      color: '#7a2ff0',
    },
    {
      id: 'e2e-context-track',
      name: 'Drums',
      instrumentId: 'drum-kit',
      notes: [
        {
          id: 'e2e-drum-note',
          pitch: 36,
          start: 0,
          duration: 0.25,
          velocity: 0.85,
        },
      ],
      muted: false,
      color: '#2563eb',
    },
  ],
  automation: [],
}

export const defaultProjectMeta = {
  id: defaultProject.id,
  name: defaultProject.name,
  updatedAt: 1_735_689_600_000,
}

export const returningProjectStorage = [
  {
    name: `cadence.v1.project.${defaultProject.id}`,
    value: JSON.stringify(defaultProject),
  },
  {
    name: 'cadence.v1.index',
    value: JSON.stringify([defaultProjectMeta]),
  },
  {
    name: 'cadence.v1.last',
    value: defaultProject.id,
  },
]

export const defaultProjectSummaryDto = {
  id: defaultProject.id,
  name: defaultProject.name,
  schemaVersion: defaultProject.schemaVersion,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
}

export const defaultProjectDetailDto = {
  ...defaultProjectSummaryDto,
  data: JSON.stringify(defaultProject),
}

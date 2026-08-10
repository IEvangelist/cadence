import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { StemsClient, StemsError, type StemJob } from './stemsClient'
import { StemsPage } from './StemsPage'

const queuedJob: StemJob = {
  id: 'job-1',
  status: 'Queued',
  originalFileName: 'mix.wav',
  contentType: 'audio/wav',
  sizeBytes: 2048,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  completedAt: null,
  errorMessage: null,
  stems: [],
}

const completedJob: StemJob = {
  ...queuedJob,
  status: 'Completed',
  completedAt: '2025-01-01T00:01:00Z',
  stems: [
    { label: 'bass', sizeBytes: 4096, url: '/api/stems/jobs/job-1/stems/bass' },
    { label: 'drums', sizeBytes: 8192, url: '/api/stems/jobs/job-1/stems/drums' },
  ],
}

function fakeClient(overrides: Partial<Record<keyof StemsClient, unknown>> = {}) {
  const client = new StemsClient(async () => new Response(null, { status: 500 }), '')
  return Object.assign(client, {
    createJob: vi.fn(async () => completedJob),
    getJob: vi.fn(async () => completedJob),
    listJobs: vi.fn(async () => []),
    downloadUrl: (stem: { url: string }) => `https://cdn.test${stem.url}`,
    ...overrides,
  }) as StemsClient
}

function selectFile(name = 'mix.wav') {
  const input = screen.getByLabelText('Choose a mix to separate')
  const file = new File([new Uint8Array([1, 2, 3, 4])], name, { type: 'audio/wav' })
  fireEvent.change(input, { target: { files: [file] } })
}

describe('<StemsPage />', () => {
  it('prompts anonymous visitors to sign in and never calls the API', () => {
    const client = fakeClient()
    render(<StemsPage authenticated={false} entitled={false} client={client} />)

    expect(screen.getByText(/Sign in to separate/i)).toBeInTheDocument()
    expect(client.listJobs).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Choose a mix to separate')).not.toBeInTheDocument()
  })

  it('shows an upgrade CTA to signed-in free users', () => {
    const onUpgrade = vi.fn()
    const client = fakeClient()
    render(
      <StemsPage authenticated entitled={false} onUpgrade={onUpgrade} client={client} />,
    )

    expect(screen.getByRole('heading', { name: /Pro feature/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'See Pro plans' }))
    expect(onUpgrade).toHaveBeenCalledOnce()
    expect(client.listJobs).not.toHaveBeenCalled()
  })

  it('loads and renders previous separations for entitled users', async () => {
    const client = fakeClient({
      listJobs: vi.fn(async () => [
        { id: 'job-1', status: 'Completed', originalFileName: 'mix.wav', sizeBytes: 2048, createdAt: '', updatedAt: '', completedAt: '' },
      ]),
    })
    render(<StemsPage authenticated entitled client={client} />)

    expect(await screen.findByRole('heading', { name: 'mix.wav' })).toBeInTheDocument()
    const download = await screen.findByRole('link', { name: /Download bass/i })
    expect(download).toHaveAttribute('href', 'https://cdn.test/api/stems/jobs/job-1/stems/bass')
    expect(screen.getByLabelText('bass stem preview')).toBeInTheDocument()
  })

  it('shows an empty state when there are no separations', async () => {
    const client = fakeClient()
    render(<StemsPage authenticated entitled client={client} />)

    expect(await screen.findByText(/No separations yet/i)).toBeInTheDocument()
  })

  it('uploads a selected mix and shows the completed stems', async () => {
    const client = fakeClient()
    render(<StemsPage authenticated entitled client={client} />)
    await screen.findByText(/No separations yet/i)

    selectFile()
    fireEvent.click(screen.getByRole('button', { name: 'Separate stems' }))

    expect(await screen.findByRole('heading', { name: 'mix.wav' })).toBeInTheDocument()
    expect(client.createJob).toHaveBeenCalledOnce()
    expect(screen.getByRole('link', { name: /Download drums/i })).toBeInTheDocument()
  })

  it('surfaces a typed upload error (e.g. 402) as an alert', async () => {
    const client = fakeClient({
      createJob: vi.fn(async () => {
        throw new StemsError(402, 'Stem separation is a Pro feature.')
      }),
    })
    render(<StemsPage authenticated entitled client={client} />)
    await screen.findByText(/No separations yet/i)

    selectFile()
    fireEvent.click(screen.getByRole('button', { name: 'Separate stems' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Pro feature/i)
  })

  it('surfaces an unexpected upload error as an alert', async () => {
    const client = fakeClient({
      createJob: vi.fn(async () => {
        throw new Error('network down')
      }),
    })
    render(<StemsPage authenticated entitled client={client} />)
    await screen.findByText(/No separations yet/i)

    selectFile()
    fireEvent.click(screen.getByRole('button', { name: 'Separate stems' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t start/i)
  })

  it('polls an in-flight job until it completes', async () => {
    const client = fakeClient({
      createJob: vi.fn(async () => queuedJob),
      getJob: vi
        .fn()
        .mockResolvedValueOnce({ ...queuedJob, status: 'Processing' })
        .mockResolvedValue(completedJob),
    })
    render(<StemsPage authenticated entitled client={client} pollIntervalMs={5} />)
    await screen.findByText(/No separations yet/i)

    selectFile()
    fireEvent.click(screen.getByRole('button', { name: 'Separate stems' }))

    // First the queued/processing state, then the completed stems after polling.
    expect(await screen.findByText('Queued')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Download bass/i })).toBeInTheDocument()
    expect(client.getJob).toHaveBeenCalled()
  })

  it('renders a failed job with its error message', async () => {
    const failed: StemJob = {
      ...queuedJob,
      status: 'Failed',
      errorMessage: 'Unsupported channel layout.',
    }
    const client = fakeClient({
      listJobs: vi.fn(async () => [
        { id: 'job-1', status: 'Failed', originalFileName: 'mix.wav', sizeBytes: 2048, createdAt: '', updatedAt: '', completedAt: null },
      ]),
      getJob: vi.fn(async () => failed),
    })
    render(<StemsPage authenticated entitled client={client} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Unsupported channel layout.')
  })

  it('reports when previous separations fail to load', async () => {
    const client = fakeClient({
      listJobs: vi.fn(async () => {
        throw new StemsError(500, 'boom')
      }),
    })
    render(<StemsPage authenticated entitled client={client} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t load your previous/i)
  })

  it('calls onClose from the back button', () => {
    const onClose = vi.fn()
    render(<StemsPage authenticated entitled client={fakeClient()} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Back to composer' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

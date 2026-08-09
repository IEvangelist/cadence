import { describe, expect, it, vi } from 'vitest'
import { StemsClient, StemsError, type StemJob } from './stemsClient'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const sampleJob: StemJob = {
  id: 'job-1',
  status: 'Queued',
  originalFileName: 'mix.wav',
  contentType: 'audio/wav',
  sizeBytes: 1024,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  completedAt: null,
  errorMessage: null,
  stems: [],
}

function wavFile(name = 'mix.wav', type = 'audio/wav'): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type })
}

describe('StemsClient', () => {
  it('createJob() posts the raw file with the auth cookie and returns the job', async () => {
    const fetchImpl = vi.fn(async () => json(sampleJob, 202))
    const client = new StemsClient(fetchImpl, '')

    const result = await client.createJob(wavFile())

    expect(result).toEqual(sampleJob)
    const [path, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(path).toBe('/api/stems/jobs?name=mix.wav')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('audio/wav')
    expect(init.body).toBeInstanceOf(File)
  })

  it('createJob() falls back to octet-stream and a default name', async () => {
    const fetchImpl = vi.fn(async () => json(sampleJob, 202))
    const client = new StemsClient(fetchImpl, '')

    await client.createJob(new File([new Uint8Array([1])], '', { type: '' }))

    const [path, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(path).toBe('/api/stems/jobs?name=mix')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/octet-stream')
  })

  it.each([
    [401, /sign in/i],
    [402, /Pro feature/i],
    [413, /too large or too long/i],
    [415, /format isn’t supported/i],
    [500, /couldn’t start/i],
  ])('createJob() maps %i to a StemsError', async (status, matcher) => {
    const client = new StemsClient(async () => new Response(null, { status }), '')

    const error = await client.createJob(wavFile()).catch((caught) => caught)

    expect(error).toBeInstanceOf(StemsError)
    expect((error as StemsError).status).toBe(status)
    expect((error as StemsError).message).toMatch(matcher)
  })

  it('getJob() returns the typed job on 200', async () => {
    const fetchImpl = vi.fn(async () => json(sampleJob))
    const client = new StemsClient(fetchImpl, '')

    const result = await client.getJob('job-1')

    expect(result).toEqual(sampleJob)
    expect(fetchImpl).toHaveBeenCalledWith('/api/stems/jobs/job-1', { credentials: 'include' })
  })

  it('getJob() throws a StemsError on 404', async () => {
    const client = new StemsClient(async () => new Response(null, { status: 404 }), '')
    await expect(client.getJob('missing')).rejects.toBeInstanceOf(StemsError)
  })

  it('listJobs() returns the summaries on 200', async () => {
    const summaries = [{ id: 'job-1', status: 'Completed' }]
    const fetchImpl = vi.fn(async () => json(summaries))
    const client = new StemsClient(fetchImpl, '')

    const result = await client.listJobs()

    expect(result).toEqual(summaries)
    expect(fetchImpl).toHaveBeenCalledWith('/api/stems/jobs', { credentials: 'include' })
  })

  it('listJobs() throws a StemsError on failure', async () => {
    const client = new StemsClient(async () => new Response(null, { status: 500 }), '')
    await expect(client.listJobs()).rejects.toBeInstanceOf(StemsError)
  })

  it('downloadUrl() resolves a stem URL against the base URL', () => {
    const client = new StemsClient(async () => json({}), 'https://api.example.com')
    const url = client.downloadUrl({ label: 'bass', sizeBytes: 1, url: '/api/stems/jobs/1/stems/bass' })
    expect(url).toBe('https://api.example.com/api/stems/jobs/1/stems/bass')
  })

  it('honours a configured base URL for uploads', async () => {
    const fetchImpl = vi.fn(async () => json(sampleJob, 202))
    const client = new StemsClient(fetchImpl, 'https://api.example.com')

    await client.createJob(wavFile())

    const [path] = fetchImpl.mock.calls[0] as unknown as [string]
    expect(path).toBe('https://api.example.com/api/stems/jobs?name=mix.wav')
  })
})

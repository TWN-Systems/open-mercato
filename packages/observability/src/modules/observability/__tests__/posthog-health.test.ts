import { createPosthogHealthCheck } from '../lib/health/posthog'

describe('posthogHealthCheck', () => {
  it('returns healthy when capture succeeds', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200 })) as any
    const fn = createPosthogHealthCheck({ fetch: fetchMock })
    const res = await fn({ host: 'https://us.i.posthog.com', projectKey: 'phc_test' } as any)
    expect(res.status).toBe('healthy')
  })

  it('returns unhealthy on non-ok response', async () => {
    const fetchMock = jest.fn(async () => ({ ok: false, status: 401 })) as any
    const fn = createPosthogHealthCheck({ fetch: fetchMock })
    const res = await fn({ host: 'https://us.i.posthog.com', projectKey: 'phc_test' } as any)
    expect(res.status).toBe('unhealthy')
    expect(res.message).toContain('401')
  })

  it('returns unhealthy on thrown error', async () => {
    const fetchMock = jest.fn(async () => { throw new Error('DNS failure') }) as any
    const fn = createPosthogHealthCheck({ fetch: fetchMock })
    const res = await fn({ host: 'https://bad', projectKey: 'phc_test' } as any)
    expect(res.status).toBe('unhealthy')
    expect(res.message).toContain('DNS')
  })
})

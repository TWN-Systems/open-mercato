import { createSentryHealthCheck } from '../lib/health/sentry'

describe('sentryHealthCheck', () => {
  it('rejects malformed DSN', async () => {
    const fn = createSentryHealthCheck({ fetch: jest.fn() as any })
    const res = await fn({ dsn: 'not-a-url' } as any)
    expect(res.status).toBe('unhealthy')
  })

  it('returns healthy when DSN is parseable and host reachable', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200 })) as any
    const fn = createSentryHealthCheck({ fetch: fetchMock })
    const res = await fn({ dsn: 'https://abc@sentry.io/123' } as any)
    expect(res.status).toBe('healthy')
  })

  it('accepts HTTP 405 (HEAD not allowed) as healthy', async () => {
    const fetchMock = jest.fn(async () => ({ ok: false, status: 405 })) as any
    const fn = createSentryHealthCheck({ fetch: fetchMock })
    const res = await fn({ dsn: 'https://abc@sentry.io/123' } as any)
    expect(res.status).toBe('healthy')
  })

  it('returns unhealthy on thrown error', async () => {
    const fetchMock = jest.fn(async () => { throw new Error('DNS failure') }) as any
    const fn = createSentryHealthCheck({ fetch: fetchMock })
    const res = await fn({ dsn: 'https://abc@sentry.io/123' } as any)
    expect(res.status).toBe('unhealthy')
    expect(res.message).toContain('DNS')
  })
})

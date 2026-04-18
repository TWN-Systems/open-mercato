const authMock = jest.fn()
const containerMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => authMock(...args),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => containerMock(...args),
}))

import { GET } from '../api/get/observability/client-config'

function makeReq(): Request {
  return new Request('http://test/observability/client-config')
}

function makeContainer(cfg: unknown) {
  return {
    resolve: jest.fn(() => ({ get: async () => cfg })),
  }
}

describe('GET /api/observability/client-config', () => {
  beforeEach(() => {
    authMock.mockReset()
    containerMock.mockReset()
  })

  it('returns nulls when tenant absent', async () => {
    authMock.mockResolvedValue(null)
    const res = await GET(makeReq())
    expect(await res.json()).toEqual({ posthog: null, sentry: null, langfuse: null })
  })

  it('omits Langfuse secret key from payload', async () => {
    authMock.mockResolvedValue({ tenantId: 't-1' })
    containerMock.mockResolvedValue(
      makeContainer({
        posthog: null,
        sentry: null,
        langfuse: { publicKey: 'pk', secretKey: 'SECRET', host: 'https://cloud.langfuse.com' },
      })
    )
    const res = await GET(makeReq())
    const text = await res.text()
    expect(text).not.toContain('SECRET')
    expect(JSON.parse(text).langfuse).toEqual({ enabled: true })
  })

  it('returns merged enabled config', async () => {
    authMock.mockResolvedValue({ tenantId: 't-1' })
    containerMock.mockResolvedValue(
      makeContainer({
        posthog: {
          projectKey: 'phc_x',
          host: 'https://us.i.posthog.com',
          sessionRecording: true,
        },
        sentry: {
          dsn: 'https://abc@sentry.io/1',
          environment: 'prod',
          tracesSampleRate: 0.25,
        },
        langfuse: null,
      })
    )
    const body = await (await GET(makeReq())).json()
    expect(body.posthog).toEqual({
      enabled: true,
      key: 'phc_x',
      host: 'https://us.i.posthog.com',
      sessionRecording: true,
    })
    expect(body.sentry).toEqual({
      enabled: true,
      dsn: 'https://abc@sentry.io/1',
      environment: 'prod',
      tracesSampleRate: 0.25,
    })
    expect(body.langfuse).toBeNull()
  })
})

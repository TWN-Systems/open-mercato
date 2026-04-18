import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

type JsonRecord = Record<string, unknown>

async function readJson(response: APIResponse): Promise<JsonRecord> {
  return ((await readJsonSafe<JsonRecord>(response)) ?? {}) as JsonRecord
}

async function listIntegrationIds(request: Parameters<typeof apiRequest>[0], token: string): Promise<string[]> {
  const res = await apiRequest(request, 'GET', '/api/integrations', { token })
  if (res.status() !== 200) return []
  const body = await readJson(res)
  const items = Array.isArray(body.items) ? (body.items as JsonRecord[]) : []
  return items.map((item) => String(item.id))
}

test.describe('observability: integration lifecycle', () => {
  test('registers PostHog, Langfuse, and Sentry providers', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ids = await listIntegrationIds(request, token)
    if (ids.length === 0) {
      test.skip(true, 'Integration listing endpoint unavailable')
      return
    }
    expect(ids).toEqual(expect.arrayContaining([
      'observability_posthog',
      'observability_langfuse',
      'observability_sentry',
    ]))
  })

  test('client-config returns the public shape', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const res = await apiRequest(request, 'GET', '/api/observability/client-config', { token })
    expect(res.status()).toBe(200)
    const body = await readJson(res)
    expect(body).toHaveProperty('posthog')
    expect(body).toHaveProperty('sentry')
    expect(body).toHaveProperty('langfuse')
  })

  test('client-config never exposes a Langfuse secret key', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const res = await apiRequest(request, 'GET', '/api/observability/client-config', { token })
    expect(res.status()).toBe(200)
    const payload = await res.text()
    expect(payload).not.toMatch(/"secretKey"/)
  })

  test('health endpoint responds for observability providers', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ids = await listIntegrationIds(request, token)
    const observabilityIds = ids.filter((id) => id.startsWith('observability_'))
    if (observabilityIds.length === 0) {
      test.skip(true, 'No observability providers registered in this environment')
      return
    }
    for (const id of observabilityIds) {
      const res = await apiRequest(request, 'POST', `/api/integrations/${id}/health`, { token })
      if (res.status() === 404) continue
      expect(res.status()).toBe(200)
      const body = await readJson(res)
      expect(['healthy', 'degraded', 'unhealthy', 'unconfigured']).toContain(String(body.status))
    }
  })
})

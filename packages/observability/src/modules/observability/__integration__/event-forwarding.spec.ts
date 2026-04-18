import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

type JsonRecord = Record<string, unknown>

async function readJson(response: APIResponse): Promise<JsonRecord> {
  return ((await readJsonSafe<JsonRecord>(response)) ?? {}) as JsonRecord
}

async function integrationExists(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  integrationId: string,
): Promise<boolean> {
  const res = await apiRequest(request, 'GET', '/api/integrations', { token })
  if (res.status() !== 200) return false
  const body = await readJson(res)
  const items = Array.isArray(body.items) ? (body.items as JsonRecord[]) : []
  return items.some((item) => String(item.id) === integrationId)
}

test.describe('observability: event forwarding wiring', () => {
  test('PostHog credentials and state round-trip via the integrations API', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    if (!(await integrationExists(request, token, 'observability_posthog'))) {
      test.skip(true, 'PostHog observability provider not registered')
      return
    }

    const credentials = {
      projectKey: 'phc_integration_test',
      host: 'http://127.0.0.1:0',
    }
    const saveRes = await apiRequest(
      request,
      'PUT',
      '/api/integrations/observability_posthog/credentials',
      { token, data: credentials },
    )
    if (saveRes.status() === 404) {
      test.skip(true, 'Integration credentials endpoint unavailable in this environment')
      return
    }
    expect([200, 204]).toContain(saveRes.status())

    const enableRes = await apiRequest(
      request,
      'PUT',
      '/api/integrations/observability_posthog/state',
      { token, data: { isEnabled: true } },
    )
    expect([200, 204]).toContain(enableRes.status())

    const cfgRes = await apiRequest(request, 'GET', '/api/observability/client-config', { token })
    expect(cfgRes.status()).toBe(200)
    const cfg = await readJson(cfgRes)
    expect(cfg.posthog).toBeTruthy()
    const posthog = cfg.posthog as JsonRecord
    expect(posthog.key).toBe(credentials.projectKey)
    expect(posthog.host).toBe(credentials.host)

    const payload = await cfgRes.text()
    expect(payload).not.toContain('secretKey')
  })

  test('disabling PostHog returns posthog=null from client-config', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    if (!(await integrationExists(request, token, 'observability_posthog'))) {
      test.skip(true, 'PostHog observability provider not registered')
      return
    }

    const disableRes = await apiRequest(
      request,
      'PUT',
      '/api/integrations/observability_posthog/state',
      { token, data: { isEnabled: false } },
    )
    if (disableRes.status() === 404) {
      test.skip(true, 'Integration state endpoint unavailable')
      return
    }
    expect([200, 204]).toContain(disableRes.status())

    const cfgRes = await apiRequest(request, 'GET', '/api/observability/client-config', { token })
    expect(cfgRes.status()).toBe(200)
    const cfg = await readJson(cfgRes)
    expect(cfg.posthog).toBeNull()
  })
})

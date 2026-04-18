import type { AwilixContainer } from 'awilix'
import { getPosthogClient } from '../lib/posthog-client'
import { DEFAULT_ALLOWLIST, DEFAULT_DENYLIST, mapEventToCapture, shouldForward } from '../lib/event-mapper'
import type { TenantConfigResolver } from '../lib/tenant-config'

export const metadata = {
  event: '*',
  persistent: false,
  id: 'observability.posthog.forward',
}

export default async function forwardEvents(
  event: { id: string; payload: Record<string, unknown>; tenantId?: string },
  container: AwilixContainer
): Promise<void> {
  if (!event.tenantId) return
  const resolver = container.resolve<TenantConfigResolver>('observabilityTenantConfig')
  const cfg = (await resolver.get(event.tenantId)).posthog
  if (!cfg) return

  const allowlist = (cfg as any).allowlist ?? DEFAULT_ALLOWLIST
  const denylist = (cfg as any).denylist ?? DEFAULT_DENYLIST
  if (!shouldForward(event.id, { allowlist, denylist })) return

  try {
    const version = process.env.OM_VERSION ?? 'unknown'
    const payload = mapEventToCapture({
      eventId: event.id,
      payload: event.payload,
      tenantId: event.tenantId,
      openMercatoVersion: version,
      extraRedactionKeys: (cfg as any).redactionKeys,
    })
    const client = getPosthogClient(event.tenantId, cfg)
    client.capture({
      distinctId: payload.distinctId,
      event: payload.event,
      properties: payload.properties,
      groups: payload.groups,
    })
  } catch (err) {
    try {
      const log = container.resolve<any>('integrationLogService')
      await log.write({
        integrationId: 'observability_posthog',
        tenantId: event.tenantId,
        level: 'error',
        message: 'PostHog event forwarding failed',
        payload: { eventId: event.id, error: err instanceof Error ? err.message : String(err) },
      })
    } catch {
      /* integrationLogService not available */
    }
  }
}

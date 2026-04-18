import { scrub } from './redaction'

export const DEFAULT_ALLOWLIST = [
  'auth.user.loggedIn',
  'sales.order.created',
  'sales.quote.accepted',
  'catalog.product.created',
  'customers.person.created',
  'integrations.state.updated',
  'workflows.instance.completed',
]

export const DEFAULT_DENYLIST = [
  'credentials',
  'secret',
  'password',
  'integrations.log',
]

export type FilterConfig = { allowlist: string[]; denylist: string[] }
export type CapturePayload = {
  distinctId: string
  event: string
  properties: Record<string, unknown>
  groups: { tenant: string; organization?: string }
}

export function shouldForward(eventId: string, filter: FilterConfig): boolean {
  for (const denied of filter.denylist) {
    if (eventId.toLowerCase().includes(denied.toLowerCase())) return false
  }
  if (filter.allowlist.length === 0) return true
  return filter.allowlist.includes(eventId)
}

type MapInput = {
  eventId: string
  payload: Record<string, unknown>
  tenantId: string
  openMercatoVersion: string
  extraRedactionKeys?: string[]
}

export function mapEventToCapture(input: MapInput): CapturePayload {
  const actorUserId = typeof input.payload.actorUserId === 'string' ? input.payload.actorUserId : undefined
  const userId = typeof input.payload.userId === 'string' ? input.payload.userId : undefined
  const organizationId = typeof input.payload.organizationId === 'string' ? input.payload.organizationId : undefined
  const distinctId = actorUserId ?? userId ?? `tenant:${input.tenantId}:system`
  const scrubbed = scrub(input.payload, { extraKeys: input.extraRedactionKeys ?? [] }) as Record<string, unknown>
  return {
    distinctId,
    event: input.eventId,
    properties: {
      ...scrubbed,
      tenant_id: input.tenantId,
      organization_id: organizationId,
      open_mercato_version: input.openMercatoVersion,
    },
    groups: { tenant: input.tenantId, organization: organizationId },
  }
}

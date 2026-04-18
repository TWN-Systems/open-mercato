import { mapEventToCapture, shouldForward } from '../lib/event-mapper'

describe('shouldForward', () => {
  it('allows events in the allowlist', () => {
    expect(shouldForward('sales.order.created', { allowlist: ['sales.order.created'], denylist: [] })).toBe(true)
  })
  it('denies events not in allowlist when allowlist is non-empty', () => {
    expect(shouldForward('sales.order.updated', { allowlist: ['sales.order.created'], denylist: [] })).toBe(false)
  })
  it('allows all when allowlist is empty', () => {
    expect(shouldForward('anything.foo.bar', { allowlist: [], denylist: [] })).toBe(true)
  })
  it('denies events matching denylist substring', () => {
    expect(shouldForward('integrations.log.created', { allowlist: [], denylist: ['integrations.log'] })).toBe(false)
    expect(shouldForward('auth.credentials.rotated', { allowlist: [], denylist: ['credentials'] })).toBe(false)
  })
  it('denylist takes precedence over allowlist', () => {
    expect(shouldForward('auth.credentials.rotated', { allowlist: ['auth.credentials.rotated'], denylist: ['credentials'] })).toBe(false)
  })
})

describe('mapEventToCapture', () => {
  it('uses actor user id as distinctId when available', () => {
    const p = mapEventToCapture({
      eventId: 'sales.order.created',
      payload: { orderId: '1', actorUserId: 'u-1', organizationId: 'o-1' },
      tenantId: 't-1',
      openMercatoVersion: '1.0.0',
    })
    expect(p.distinctId).toBe('u-1')
    expect(p.event).toBe('sales.order.created')
    expect(p.groups).toEqual({ tenant: 't-1', organization: 'o-1' })
  })

  it('falls back to system distinctId when no actor', () => {
    const p = mapEventToCapture({
      eventId: 'auth.system.cleanup',
      payload: {},
      tenantId: 't-1',
      openMercatoVersion: '1.0.0',
    })
    expect(p.distinctId).toBe('tenant:t-1:system')
  })

  it('scrubs sensitive keys from properties', () => {
    const p = mapEventToCapture({
      eventId: 'auth.user.loggedIn',
      payload: { userId: 'u-1', password: 'nope', token: 't' },
      tenantId: 't-1',
      openMercatoVersion: '1.0.0',
    })
    expect((p.properties as any).password).toBe('[REDACTED]')
    expect((p.properties as any).token).toBe('[REDACTED]')
  })

  it('stamps version and tenant/org onto properties', () => {
    const p = mapEventToCapture({
      eventId: 'sales.order.created',
      payload: { organizationId: 'o-1' },
      tenantId: 't-1',
      openMercatoVersion: '1.0.0',
    })
    expect(p.properties).toMatchObject({ tenant_id: 't-1', organization_id: 'o-1', open_mercato_version: '1.0.0' })
  })
})

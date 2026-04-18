import { createTenantConfigResolver } from '../lib/tenant-config'

const makeDeps = () => {
  const credentials = new Map<string, unknown>()
  const enabled = new Map<string, boolean>()
  return {
    credentials,
    enabled,
    credentialsService: {
      findOneWithDecryption: jest.fn(async (q: { integrationId: string; tenantId: string }) => {
        const k = `${q.integrationId}:${q.tenantId}`
        return credentials.has(k) ? { data: credentials.get(k) } : null
      }),
    },
    stateService: {
      findOne: jest.fn(async (q: { integrationId: string; tenantId: string }) => {
        const k = `${q.integrationId}:${q.tenantId}`
        return enabled.has(k) ? { enabled: enabled.get(k) } : null
      }),
    },
  }
}

describe('tenant config resolver', () => {
  it('returns disabled entries as null', async () => {
    const deps = makeDeps()
    const resolver = createTenantConfigResolver(deps)
    const cfg = await resolver.get('tenant-1')
    expect(cfg.posthog).toBeNull()
    expect(cfg.langfuse).toBeNull()
    expect(cfg.sentry).toBeNull()
  })

  it('returns credentials when enabled', async () => {
    const deps = makeDeps()
    deps.enabled.set('observability_posthog:tenant-1', true)
    deps.credentials.set('observability_posthog:tenant-1', { projectKey: 'k', host: 'https://us.i.posthog.com' })
    const resolver = createTenantConfigResolver(deps)
    const cfg = await resolver.get('tenant-1')
    expect(cfg.posthog).toEqual({ projectKey: 'k', host: 'https://us.i.posthog.com' })
  })

  it('caches results', async () => {
    const deps = makeDeps()
    for (const id of ['observability_posthog', 'observability_langfuse', 'observability_sentry']) {
      deps.enabled.set(`${id}:tenant-1`, true)
      deps.credentials.set(`${id}:tenant-1`, {})
    }
    const resolver = createTenantConfigResolver(deps)
    await resolver.get('tenant-1')
    await resolver.get('tenant-1')
    expect(deps.credentialsService.findOneWithDecryption).toHaveBeenCalledTimes(3)
  })

  it('invalidates on invalidate(tenantId)', async () => {
    const deps = makeDeps()
    for (const id of ['observability_posthog', 'observability_langfuse', 'observability_sentry']) {
      deps.enabled.set(`${id}:tenant-1`, true)
      deps.credentials.set(`${id}:tenant-1`, {})
    }
    const resolver = createTenantConfigResolver(deps)
    await resolver.get('tenant-1')
    resolver.invalidate('tenant-1')
    await resolver.get('tenant-1')
    expect(deps.credentialsService.findOneWithDecryption).toHaveBeenCalledTimes(6)
  })
})

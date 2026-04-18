import type { PosthogCredentials, LangfuseCredentials, SentryCredentials } from '../data/validators'

const INTEGRATION_IDS = {
  posthog: 'observability_posthog',
  langfuse: 'observability_langfuse',
  sentry: 'observability_sentry',
} as const

export type TenantObservabilityConfig = {
  posthog: PosthogCredentials | null
  langfuse: LangfuseCredentials | null
  sentry: SentryCredentials | null
}

type CredentialsService = {
  findOneWithDecryption: (q: { integrationId: string; tenantId: string }) => Promise<{ data: unknown } | null>
}

type StateService = {
  findOne: (q: { integrationId: string; tenantId: string }) => Promise<{ enabled: boolean } | null>
}

type Deps = { credentialsService: CredentialsService; stateService: StateService }

export function createTenantConfigResolver(deps: Deps) {
  const cache = new Map<string, TenantObservabilityConfig>()

  async function resolveOne<T>(integrationId: string, tenantId: string): Promise<T | null> {
    const state = await deps.stateService.findOne({ integrationId, tenantId })
    if (!state?.enabled) return null
    const creds = await deps.credentialsService.findOneWithDecryption({ integrationId, tenantId })
    return (creds?.data ?? null) as T | null
  }

  async function load(tenantId: string): Promise<TenantObservabilityConfig> {
    const [posthog, langfuse, sentry] = await Promise.all([
      resolveOne<PosthogCredentials>(INTEGRATION_IDS.posthog, tenantId),
      resolveOne<LangfuseCredentials>(INTEGRATION_IDS.langfuse, tenantId),
      resolveOne<SentryCredentials>(INTEGRATION_IDS.sentry, tenantId),
    ])
    return { posthog, langfuse, sentry }
  }

  return {
    async get(tenantId: string): Promise<TenantObservabilityConfig> {
      const hit = cache.get(tenantId)
      if (hit) return hit
      const cfg = await load(tenantId)
      cache.set(tenantId, cfg)
      return cfg
    },
    invalidate(tenantId: string) {
      cache.delete(tenantId)
    },
    invalidateAll() {
      cache.clear()
    },
  }
}

export type TenantConfigResolver = ReturnType<typeof createTenantConfigResolver>

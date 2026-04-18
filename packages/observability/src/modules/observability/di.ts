import { asFunction, asValue, type AwilixContainer } from 'awilix'
import { createTenantConfigResolver, type TenantConfigResolver } from './lib/tenant-config'
import { getLangfuseClient } from './lib/langfuse-client'
import { getPosthogClient } from './lib/posthog-client'
import { createLangfuseTracer } from './lib/llm-tracer'
import {
  noopTracer,
  type LLMTracer,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/llm-tracer-types'
import { posthogHealthCheck } from './lib/health/posthog'
import { langfuseHealthCheck } from './lib/health/langfuse'
import { sentryHealthCheck } from './lib/health/sentry'
import { withTenantScope, sentryInitialized } from './lib/sentry-server'

export function register(container: AwilixContainer): void {
  container.register({
    observabilityTenantConfig: asFunction(
      ({ integrationCredentialsService, integrationStateService }) =>
        createTenantConfigResolver({
          credentialsService: integrationCredentialsService,
          stateService: integrationStateService,
        })
    ).singleton(),

    posthogClientFactory: asValue(getPosthogClient),
    langfuseClientFactory: asValue(getLangfuseClient),

    sentryScopeHelper: asValue({ withTenantScope, isInitialized: sentryInitialized }),

    llmTracer: asFunction(
      ({ observabilityTenantConfig, langfuseClientFactory }): LLMTracer => ({
        async traceLLM(opts, fn) {
          if (!opts.tenantId) return noopTracer.traceLLM(opts, fn)
          const resolver = observabilityTenantConfig as TenantConfigResolver
          const cfg = (await resolver.get(opts.tenantId)).langfuse
          if (!cfg) return noopTracer.traceLLM(opts, fn)
          const tracer = createLangfuseTracer(() => langfuseClientFactory(opts.tenantId!, cfg))
          return tracer.traceLLM(opts, fn)
        },
      })
    ).singleton(),

    posthogHealthCheck: asValue(posthogHealthCheck),
    langfuseHealthCheck: asValue(langfuseHealthCheck),
    sentryHealthCheck: asValue(sentryHealthCheck),
  })

  try {
    const events = container.resolve<any>('eventBus')
    const invalidate = (evt: { tenantId?: string }) => {
      if (!evt?.tenantId) return
      const resolver = container.resolve<TenantConfigResolver>('observabilityTenantConfig')
      resolver.invalidate(evt.tenantId)
    }
    events.on?.('integrations.credentials.updated', invalidate)
    events.on?.('integrations.state.updated', invalidate)
  } catch {
    /* eventBus not registered in this container */
  }
}

import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import type {
  LangfuseCredentials,
  PosthogCredentials,
  SentryCredentials,
} from '../data/validators'

export const POSTHOG_INTEGRATION_ID = 'observability_posthog'
export const LANGFUSE_INTEGRATION_ID = 'observability_langfuse'
export const SENTRY_INTEGRATION_ID = 'observability_sentry'

export type PresetOutput = {
  posthog: Partial<PosthogCredentials> | null
  langfuse: Partial<LangfuseCredentials> | null
  sentry: Partial<SentryCredentials> | null
}

export type ApplyPresetDeps = {
  credentialsService: CredentialsService
  stateService: IntegrationStateService
}

export type ApplyPresetResult = {
  applied: Array<'posthog' | 'langfuse' | 'sentry'>
}

export function readPresetFromEnv(env: Record<string, string | undefined>): PresetOutput {
  const posthogKey = env.OM_INTEGRATION_POSTHOG_PROJECT_KEY
  const posthog = posthogKey
    ? {
        projectKey: posthogKey,
        host: env.OM_INTEGRATION_POSTHOG_HOST ?? 'https://us.i.posthog.com',
      }
    : null

  const lfPub = env.OM_INTEGRATION_LANGFUSE_PUBLIC_KEY
  const lfSec = env.OM_INTEGRATION_LANGFUSE_SECRET_KEY
  const langfuse =
    lfPub && lfSec
      ? {
          publicKey: lfPub,
          secretKey: lfSec,
          host: env.OM_INTEGRATION_LANGFUSE_HOST ?? 'https://cloud.langfuse.com',
        }
      : null

  const dsn = env.OM_INTEGRATION_SENTRY_DSN
  const tracesRaw = env.OM_INTEGRATION_SENTRY_TRACES_SAMPLE_RATE
  const sentry = dsn
    ? {
        dsn,
        environment: env.OM_INTEGRATION_SENTRY_ENVIRONMENT ?? env.NODE_ENV,
        tracesSampleRate: tracesRaw != null && tracesRaw !== '' ? Number(tracesRaw) : 0.1,
      }
    : null

  return { posthog, langfuse, sentry }
}

export async function applyPreset(
  deps: ApplyPresetDeps,
  scope: IntegrationScope,
  preset: PresetOutput,
): Promise<ApplyPresetResult> {
  const applied: ApplyPresetResult['applied'] = []

  if (preset.posthog) {
    await deps.credentialsService.save(
      POSTHOG_INTEGRATION_ID,
      preset.posthog as Record<string, unknown>,
      scope,
    )
    await deps.stateService.upsert(POSTHOG_INTEGRATION_ID, { isEnabled: true }, scope)
    applied.push('posthog')
  }

  if (preset.langfuse) {
    await deps.credentialsService.save(
      LANGFUSE_INTEGRATION_ID,
      preset.langfuse as Record<string, unknown>,
      scope,
    )
    await deps.stateService.upsert(LANGFUSE_INTEGRATION_ID, { isEnabled: true }, scope)
    applied.push('langfuse')
  }

  if (preset.sentry) {
    await deps.credentialsService.save(
      SENTRY_INTEGRATION_ID,
      preset.sentry as Record<string, unknown>,
      scope,
    )
    await deps.stateService.upsert(SENTRY_INTEGRATION_ID, { isEnabled: true }, scope)
    applied.push('sentry')
  }

  return { applied }
}

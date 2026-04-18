import type {
  LangfuseCredentials,
  PosthogCredentials,
  SentryCredentials,
} from '../data/validators'

export type PresetOutput = {
  posthog: Partial<PosthogCredentials> | null
  langfuse: Partial<LangfuseCredentials> | null
  sentry: Partial<SentryCredentials> | null
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

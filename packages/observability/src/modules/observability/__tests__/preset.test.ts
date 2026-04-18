import { readPresetFromEnv } from '../lib/preset'

describe('readPresetFromEnv', () => {
  it('returns null sections when env vars missing', () => {
    const p = readPresetFromEnv({})
    expect(p).toEqual({ posthog: null, langfuse: null, sentry: null })
  })

  it('parses posthog preset when key is set', () => {
    const p = readPresetFromEnv({
      OM_INTEGRATION_POSTHOG_PROJECT_KEY: 'phc_abc',
      OM_INTEGRATION_POSTHOG_HOST: 'https://eu.i.posthog.com',
    })
    expect(p.posthog).toEqual({ projectKey: 'phc_abc', host: 'https://eu.i.posthog.com' })
  })

  it('rejects partial langfuse credentials', () => {
    const p = readPresetFromEnv({ OM_INTEGRATION_LANGFUSE_PUBLIC_KEY: 'pk' })
    expect(p.langfuse).toBeNull()
  })

  it('parses sentry DSN-only preset', () => {
    const p = readPresetFromEnv({ OM_INTEGRATION_SENTRY_DSN: 'https://abc@sentry.io/1' })
    expect(p.sentry?.dsn).toBe('https://abc@sentry.io/1')
  })

  it('applies default hosts', () => {
    const p = readPresetFromEnv({ OM_INTEGRATION_POSTHOG_PROJECT_KEY: 'phc_x' })
    expect(p.posthog?.host).toBe('https://us.i.posthog.com')
  })
})

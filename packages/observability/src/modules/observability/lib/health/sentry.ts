type HealthResult = { status: 'healthy' | 'unhealthy'; message?: string }
type Deps = { fetch: typeof fetch }

export function createSentryHealthCheck(deps: Deps = { fetch }) {
  return async function sentryHealthCheck(creds: { dsn: string }): Promise<HealthResult> {
    try {
      const url = new URL(creds.dsn)
      const pingUrl = `${url.protocol}//${url.host}/`
      const res = await deps.fetch(pingUrl, { method: 'HEAD' })
      if (!res.ok && res.status !== 405) {
        return { status: 'unhealthy', message: `Sentry host returned HTTP ${res.status}` }
      }
      return { status: 'healthy' }
    } catch (err) {
      return { status: 'unhealthy', message: err instanceof Error ? err.message : String(err) }
    }
  }
}

export const sentryHealthCheck = createSentryHealthCheck()

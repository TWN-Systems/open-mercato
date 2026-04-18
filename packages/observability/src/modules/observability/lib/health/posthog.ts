import type { PosthogCredentials } from '../../data/validators'

type HealthResult = { status: 'healthy' | 'unhealthy'; message?: string }
type Deps = { fetch: typeof fetch }

export function createPosthogHealthCheck(deps: Deps = { fetch }) {
  return async function posthogHealthCheck(creds: PosthogCredentials): Promise<HealthResult> {
    try {
      const url = `${creds.host.replace(/\/$/, '')}/decide/?v=3`
      const res = await deps.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_key: creds.projectKey, distinct_id: 'health-check' }),
      })
      if (!res.ok) return { status: 'unhealthy', message: `PostHog returned HTTP ${res.status}` }
      return { status: 'healthy' }
    } catch (err) {
      return { status: 'unhealthy', message: err instanceof Error ? err.message : String(err) }
    }
  }
}

export const posthogHealthCheck = createPosthogHealthCheck()

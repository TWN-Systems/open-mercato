import type { LangfuseCredentials } from '../../data/validators'

type HealthResult = { status: 'healthy' | 'unhealthy'; message?: string }
type Deps = { fetch: typeof fetch }

export function createLangfuseHealthCheck(deps: Deps = { fetch }) {
  return async function langfuseHealthCheck(creds: LangfuseCredentials): Promise<HealthResult> {
    try {
      const url = `${creds.host.replace(/\/$/, '')}/api/public/health`
      const auth = Buffer.from(`${creds.publicKey}:${creds.secretKey}`).toString('base64')
      const res = await deps.fetch(url, {
        method: 'GET',
        headers: { authorization: `Basic ${auth}` },
      })
      if (!res.ok) return { status: 'unhealthy', message: `Langfuse returned HTTP ${res.status}` }
      return { status: 'healthy' }
    } catch (err) {
      return { status: 'unhealthy', message: err instanceof Error ? err.message : String(err) }
    }
  }
}

export const langfuseHealthCheck = createLangfuseHealthCheck()

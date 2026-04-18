import { PostHog } from 'posthog-node'
import type { PosthogCredentials } from '../data/validators'

type ClientCacheKey = string
const clients = new Map<ClientCacheKey, PostHog>()

export function getPosthogClient(tenantId: string, creds: PosthogCredentials): PostHog {
  const key = `${tenantId}:${creds.host}:${creds.projectKey}`
  const existing = clients.get(key)
  if (existing) return existing
  const client = new PostHog(creds.projectKey, { host: creds.host, flushAt: 20, flushInterval: 10_000 })
  clients.set(key, client)
  return client
}

export async function shutdownPosthogClients(): Promise<void> {
  const all = Array.from(clients.values())
  clients.clear()
  await Promise.all(all.map((c) => c.shutdown()))
}

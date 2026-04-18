import { Langfuse } from 'langfuse'
import type { LangfuseCredentials } from '../data/validators'

const clients = new Map<string, Langfuse>()

export function getLangfuseClient(tenantId: string, creds: LangfuseCredentials): Langfuse {
  const key = `${tenantId}:${creds.host}:${creds.publicKey}`
  const existing = clients.get(key)
  if (existing) return existing
  const client = new Langfuse({
    publicKey: creds.publicKey,
    secretKey: creds.secretKey,
    baseUrl: creds.host,
  })
  clients.set(key, client)
  return client
}

export async function flushLangfuseClients(): Promise<void> {
  await Promise.all(Array.from(clients.values()).map((c) => c.flushAsync()))
}

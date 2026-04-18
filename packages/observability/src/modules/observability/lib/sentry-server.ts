import * as Sentry from '@sentry/nextjs'
import { scrub } from './redaction'
import type { SentryCredentials } from '../data/validators'

let initialized = false

export function initSentry(creds: SentryCredentials | undefined | null): void {
  if (initialized) return
  const dsn = creds?.dsn ?? process.env.SENTRY_DSN ?? process.env.OM_INTEGRATION_SENTRY_DSN
  if (!dsn) return
  Sentry.init({
    dsn,
    environment: creds?.environment ?? process.env.NODE_ENV,
    tracesSampleRate: creds?.tracesSampleRate ?? 0.1,
    beforeSend(event) {
      if (event.request?.cookies) event.request.cookies = { redacted: '[REDACTED]' }
      if (event.request?.headers) {
        const headers = event.request.headers as Record<string, string>
        for (const k of Object.keys(headers)) {
          if (/^(authorization|cookie|x-api-key)$/i.test(k)) headers[k] = '[REDACTED]'
        }
      }
      if (event.extra) event.extra = scrub(event.extra) as Record<string, unknown>
      return event
    },
  })
  initialized = true
}

export function withTenantScope<T>(
  scope: { tenantId?: string; organizationId?: string; userId?: string },
  fn: () => T
): T {
  return Sentry.withScope((s) => {
    if (scope.tenantId) s.setTag('tenant_id', scope.tenantId)
    if (scope.organizationId) s.setTag('organization_id', scope.organizationId)
    if (scope.userId) s.setUser({ id: scope.userId })
    return fn()
  })
}

export function sentryInitialized(): boolean {
  return initialized
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { TenantConfigResolver } from '../../../lib/tenant-config'

export const metadata = {
  path: '/observability/client-config',
  GET: { requireAuth: true },
}

type ClientConfigBody = {
  posthog: { enabled: true; key: string; host: string; sessionRecording: boolean } | null
  sentry:
    | { enabled: true; dsn: string; environment?: string; tracesSampleRate?: number }
    | null
  langfuse: { enabled: true } | null
}

const emptyBody: ClientConfigBody = { posthog: null, sentry: null, langfuse: null }

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json(emptyBody)
  }

  const container = await createRequestContainer()
  let resolver: TenantConfigResolver
  try {
    resolver = container.resolve<TenantConfigResolver>('observabilityTenantConfig')
  } catch {
    return NextResponse.json(emptyBody)
  }

  const cfg = await resolver.get(auth.tenantId)
  const body: ClientConfigBody = {
    posthog: cfg.posthog
      ? {
          enabled: true,
          key: cfg.posthog.projectKey,
          host: cfg.posthog.host,
          sessionRecording: cfg.posthog.sessionRecording ?? false,
        }
      : null,
    sentry: cfg.sentry
      ? {
          enabled: true,
          dsn: cfg.sentry.dsn,
          environment: cfg.sentry.environment,
          tracesSampleRate: cfg.sentry.tracesSampleRate,
        }
      : null,
    langfuse: cfg.langfuse ? { enabled: true } : null,
  }

  return new NextResponse(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'private, max-age=300' },
  })
}

const responseSchema = z.object({
  posthog: z
    .object({
      enabled: z.literal(true),
      key: z.string(),
      host: z.string(),
      sessionRecording: z.boolean(),
    })
    .nullable(),
  sentry: z
    .object({
      enabled: z.literal(true),
      dsn: z.string(),
      environment: z.string().optional(),
      tracesSampleRate: z.number().optional(),
    })
    .nullable(),
  langfuse: z.object({ enabled: z.literal(true) }).nullable(),
})

const getDoc: OpenApiMethodDoc = {
  summary: 'Get browser-safe observability configuration for the current tenant',
  tags: ['Observability'],
  responses: [{ status: 200, description: 'Merged enabled-provider config', schema: responseSchema }],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Observability',
  summary: 'Browser-safe observability configuration',
  methods: { GET: getDoc },
}

export default GET

import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'
import { sentryInitialized, tagCurrentScope } from '../lib/sentry-server'

const tenantTagInterceptor: ApiInterceptor = {
  id: 'observability.sentry.tenant-tag',
  targetRoute: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  priority: 10,
  async before(_request, context) {
    if (!sentryInitialized()) return { ok: true }
    tagCurrentScope({
      tenantId: context.tenantId || undefined,
      organizationId: context.organizationId || undefined,
      userId: context.userId || undefined,
    })
    return { ok: true }
  },
}

export const interceptors: ApiInterceptor[] = [tenantTagInterceptor]

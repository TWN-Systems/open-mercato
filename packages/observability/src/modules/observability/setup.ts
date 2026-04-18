import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createCredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { createIntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { applyPreset, readPresetFromEnv } from './lib/preset'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: [
      'observability.view',
      'observability.manage',
      'observability.credentials.manage',
    ],
    admin: [
      'observability.view',
      'observability.manage',
      'observability.credentials.manage',
    ],
  },

  async onTenantCreated({ em, tenantId, organizationId }) {
    const preset = readPresetFromEnv(process.env as Record<string, string | undefined>)
    if (!preset.posthog && !preset.langfuse && !preset.sentry) return

    try {
      await applyPreset(
        {
          credentialsService: createCredentialsService(em),
          stateService: createIntegrationStateService(em),
        },
        { tenantId, organizationId },
        preset,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown observability preset error'
      console.warn(`[observability] Failed to apply env preset during tenant setup: ${message}`)
    }
  },
}

export default setup

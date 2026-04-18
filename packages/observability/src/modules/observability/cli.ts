import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { applyPreset, readPresetFromEnv } from './lib/preset'

function parseArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    if (key.includes('=')) {
      const [name, value] = key.split('=')
      result[name] = value
      continue
    }
    const next = args[i + 1]
    if (next && !next.startsWith('--')) {
      result[key] = next
      i += 1
      continue
    }
    result[key] = true
  }
  return result
}

function printHelp(): void {
  console.log('Usage: yarn mercato observability <command> --tenant <tenantId> --org <organizationId>')
  console.log('')
  console.log('Commands:')
  console.log('  configure-from-env   Apply OM_INTEGRATION_* observability env vars to the tenant.')
  console.log('  test-capture         Emit a synthetic PostHog event to verify forwarding.')
  console.log('')
  console.log('Supported env vars:')
  console.log('  OM_INTEGRATION_POSTHOG_PROJECT_KEY, OM_INTEGRATION_POSTHOG_HOST')
  console.log('  OM_INTEGRATION_LANGFUSE_PUBLIC_KEY, OM_INTEGRATION_LANGFUSE_SECRET_KEY, OM_INTEGRATION_LANGFUSE_HOST')
  console.log('  OM_INTEGRATION_SENTRY_DSN, OM_INTEGRATION_SENTRY_ENVIRONMENT, OM_INTEGRATION_SENTRY_TRACES_SAMPLE_RATE')
}

async function disposeContainer(container: unknown): Promise<void> {
  const disposable = container as { dispose?: () => Promise<void> }
  if (typeof disposable.dispose === 'function') {
    await disposable.dispose()
  }
}

const configureFromEnvCommand: ModuleCli = {
  command: 'configure-from-env',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.orgId ?? args.org ?? '')

    if (!tenantId || !organizationId) {
      printHelp()
      return
    }

    const preset = readPresetFromEnv(process.env as Record<string, string | undefined>)
    if (!preset.posthog && !preset.langfuse && !preset.sentry) {
      console.error('[observability] No OM_INTEGRATION_* env vars were provided.')
      printHelp()
      process.exitCode = 1
      return
    }

    const container = await createRequestContainer()
    try {
      const credentialsService = container.resolve('integrationCredentialsService') as CredentialsService
      const stateService = container.resolve('integrationStateService') as IntegrationStateService

      const result = await applyPreset(
        { credentialsService, stateService },
        { tenantId, organizationId },
        preset,
      )

      console.log(
        `[observability] Applied: ${result.applied.length > 0 ? result.applied.join(', ') : '(none)'}`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown observability preset error'
      console.error(`[observability] ${message}`)
      process.exitCode = 1
    } finally {
      await disposeContainer(container)
    }
  },
}

const testCaptureCommand: ModuleCli = {
  command: 'test-capture',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')

    if (!tenantId) {
      printHelp()
      return
    }

    const container = await createRequestContainer()
    try {
      const resolver = container.resolve('observabilityTenantConfig') as {
        get: (tenantId: string) => Promise<{ posthog: { projectKey: string; host: string } | null }>
      }
      const cfg = (await resolver.get(tenantId)).posthog
      if (!cfg) {
        console.log('[observability] PostHog is not enabled for this tenant.')
        return
      }
      const factory = container.resolve('posthogClientFactory') as (
        tenantId: string,
        creds: { projectKey: string; host: string },
      ) => { capture: (input: unknown) => void; flush: () => Promise<void> }
      const client = factory(tenantId, cfg)
      client.capture({
        distinctId: `tenant:${tenantId}:cli-test`,
        event: 'observability.cli.test',
        properties: { source: 'cli', timestamp: new Date().toISOString() },
        groups: { tenant: tenantId },
      })
      await client.flush()
      console.log('[observability] Test event captured.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown observability test-capture error'
      console.error(`[observability] ${message}`)
      process.exitCode = 1
    } finally {
      await disposeContainer(container)
    }
  },
}

const helpCommand: ModuleCli = {
  command: 'help',
  async run() {
    printHelp()
  },
}

export default [configureFromEnvCommand, testCaptureCommand, helpCommand]

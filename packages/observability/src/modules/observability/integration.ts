import { buildIntegrationDetailWidgetSpotId, type IntegrationBundle, type IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const posthogDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId('observability_posthog')
export const langfuseDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId('observability_langfuse')
export const sentryDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId('observability_sentry')

export const posthogIntegration: IntegrationDefinition = {
  id: 'observability_posthog',
  title: 'PostHog',
  description: 'Product analytics with autocapture, funnels, cohorts, and session replay. Cloud or self-hosted.',
  category: 'analytics',
  hub: 'observability',
  providerKey: 'posthog',
  icon: 'posthog',
  docsUrl: 'https://posthog.com/docs',
  package: '@open-mercato/observability',
  version: '0.1.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['analytics', 'session-replay', 'events', 'self-hosted'],
  detailPage: { widgetSpotId: posthogDetailWidgetSpotId },
  credentials: {
    fields: [
      { key: 'projectKey', label: 'Project API Key', type: 'secret', required: true, placeholder: 'phc_...', helpText: 'Project API key from PostHog project settings. Works for both cloud and self-hosted.' },
      { key: 'host', label: 'Host', type: 'text', required: true, placeholder: 'https://us.i.posthog.com', helpText: 'PostHog API host. Cloud: us.i.posthog.com or eu.i.posthog.com. Self-hosted: your deployment URL.' },
      { key: 'sessionRecording', label: 'Enable Session Recording', type: 'boolean', required: false, helpText: 'Records browser sessions for playback. Disabled by default.' },
    ],
  },
  healthCheck: { service: 'posthogHealthCheck' },
}

export const langfuseIntegration: IntegrationDefinition = {
  id: 'observability_langfuse',
  title: 'Langfuse',
  description: 'LLM observability: traces, generations, token and cost accounting for AI workflows. Cloud or self-hosted.',
  category: 'ai',
  hub: 'observability',
  providerKey: 'langfuse',
  icon: 'langfuse',
  docsUrl: 'https://langfuse.com/docs',
  package: '@open-mercato/observability',
  version: '0.1.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['ai', 'llm', 'tracing', 'observability', 'self-hosted'],
  detailPage: { widgetSpotId: langfuseDetailWidgetSpotId },
  credentials: {
    fields: [
      { key: 'publicKey', label: 'Public Key', type: 'text', required: true, placeholder: 'pk-lf-...', helpText: 'Langfuse project public key.' },
      { key: 'secretKey', label: 'Secret Key', type: 'secret', required: true, placeholder: 'sk-lf-...', helpText: 'Langfuse project secret key.' },
      { key: 'host', label: 'Host', type: 'text', required: true, placeholder: 'https://cloud.langfuse.com', helpText: 'Langfuse API host. Use your self-hosted URL if applicable.' },
    ],
  },
  healthCheck: { service: 'langfuseHealthCheck' },
}

export const sentryIntegration: IntegrationDefinition = {
  id: 'observability_sentry',
  title: 'Sentry',
  description: 'Error and performance monitoring across server, admin, and customer portal. Cloud or self-hosted.',
  category: 'monitoring',
  hub: 'observability',
  providerKey: 'sentry',
  icon: 'sentry',
  docsUrl: 'https://docs.sentry.io',
  package: '@open-mercato/observability',
  version: '0.1.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['errors', 'performance', 'monitoring', 'self-hosted'],
  detailPage: { widgetSpotId: sentryDetailWidgetSpotId },
  credentials: {
    fields: [
      { key: 'dsn', label: 'DSN', type: 'secret', required: true, placeholder: 'https://<key>@<host>/<project>', helpText: 'Sentry DSN. Host inside the DSN determines cloud vs self-hosted routing.' },
      { key: 'environment', label: 'Environment', type: 'text', required: false, placeholder: 'production', helpText: 'Tag events with an environment name. Defaults to NODE_ENV.' },
      { key: 'tracesSampleRate', label: 'Traces Sample Rate', type: 'text', required: false, placeholder: '0.1', helpText: 'Fraction of transactions to record (0.0–1.0). Default 0.1.' },
    ],
  },
  healthCheck: { service: 'sentryHealthCheck' },
}

export const integration = posthogIntegration
export const integrations: IntegrationDefinition[] = [posthogIntegration, langfuseIntegration, sentryIntegration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined

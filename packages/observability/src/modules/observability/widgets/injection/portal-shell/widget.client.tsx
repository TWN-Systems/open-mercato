'use client'

import { useEffect, useRef } from 'react'

type ClientConfig = {
  posthog: { enabled: true; key: string; host: string; sessionRecording?: boolean } | null
  sentry:
    | { enabled: true; dsn: string; environment?: string; tracesSampleRate?: number }
    | null
  langfuse: { enabled: true } | null
}

async function fetchConfig(): Promise<ClientConfig> {
  const res = await fetch('/api/observability/client-config', { credentials: 'include' })
  if (!res.ok) return { posthog: null, sentry: null, langfuse: null }
  return (await res.json()) as ClientConfig
}

export default function PortalShellObservability() {
  const initRef = useRef(false)
  useEffect(() => {
    if (initRef.current) return
    initRef.current = true
    void (async () => {
      const cfg = await fetchConfig()
      if (cfg.posthog) {
        const { default: posthog } = await import('posthog-js')
        posthog.init(cfg.posthog.key, {
          api_host: cfg.posthog.host,
          autocapture: true,
          session_recording: { enabled: cfg.posthog.sessionRecording ?? false },
          person_profiles: 'identified_only',
        })
      }
      if (cfg.sentry) {
        const Sentry = await import('@sentry/browser')
        Sentry.init({
          dsn: cfg.sentry.dsn,
          environment: cfg.sentry.environment,
          tracesSampleRate: cfg.sentry.tracesSampleRate ?? 0.1,
        })
      }
    })()
  }, [])
  return null
}

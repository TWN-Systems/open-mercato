import { initSentry } from './sentry-server'

export function registerSentryInstrumentation(): void {
  initSentry(null)
}

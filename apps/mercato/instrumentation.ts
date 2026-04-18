export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerSentryInstrumentation } = await import(
      '@open-mercato/observability/modules/observability/lib/sentry-instrumentation'
    )
    registerSentryInstrumentation()
  }
}

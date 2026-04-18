import { z } from 'zod'

export const posthogCredentialsSchema = z.object({
  projectKey: z.string().min(1),
  host: z.string().url().default('https://us.i.posthog.com'),
  allowlist: z.array(z.string()).optional(),
  denylist: z.array(z.string()).optional(),
  sessionRecording: z.boolean().optional().default(false),
  redactionKeys: z.array(z.string()).optional(),
})
export type PosthogCredentials = z.infer<typeof posthogCredentialsSchema>

export const langfuseCredentialsSchema = z.object({
  publicKey: z.string().min(1),
  secretKey: z.string().min(1),
  host: z.string().url().default('https://cloud.langfuse.com'),
  redactionKeys: z.array(z.string()).optional(),
})
export type LangfuseCredentials = z.infer<typeof langfuseCredentialsSchema>

export const sentryCredentialsSchema = z.object({
  dsn: z.string().min(1),
  environment: z.string().optional(),
  tracesSampleRate: z.number().min(0).max(1).optional().default(0.1),
  redactionKeys: z.array(z.string()).optional(),
})
export type SentryCredentials = z.infer<typeof sentryCredentialsSchema>

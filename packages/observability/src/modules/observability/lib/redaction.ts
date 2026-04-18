const DEFAULT_SENSITIVE_PATTERN = /^(password|secret|token|apiKey|privateKey|authorization|cookie|sessionId|creditCard|cvv|ssn|dsn)/i
const MAX_STRING_LENGTH = 8192

type ScrubOptions = { extraKeys?: string[] }

function isSensitiveKey(key: string, extraKeys: string[]): boolean {
  if (DEFAULT_SENSITIVE_PATTERN.test(key)) return true
  const lower = key.toLowerCase()
  return extraKeys.some((k) => k.toLowerCase() === lower)
}

export function scrub<T>(value: T, options: ScrubOptions = {}): T {
  const extraKeys = options.extraKeys ?? []
  return walk(value, extraKeys) as T
}

function walk(value: unknown, extraKeys: string[]): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `[TRUNCATED:${value.length}]` : value
  }
  if (Array.isArray(value)) return value.map((item) => walk(item, extraKeys))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k, extraKeys) && v !== undefined && v !== null ? '[REDACTED]' : walk(v, extraKeys)
    }
    return out
  }
  return value
}

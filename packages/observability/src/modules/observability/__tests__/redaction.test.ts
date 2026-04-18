import { scrub } from '../lib/redaction'

describe('scrub', () => {
  it('redacts top-level sensitive keys', () => {
    const input = { password: 'abc', name: 'Alice' }
    expect(scrub(input)).toEqual({ password: '[REDACTED]', name: 'Alice' })
  })

  it('redacts nested sensitive keys case-insensitively', () => {
    const input = { user: { apiKey: 'x', Email: 'a@b.com' } }
    expect(scrub(input)).toEqual({ user: { apiKey: '[REDACTED]', Email: 'a@b.com' } })
  })

  it('redacts inside arrays of objects', () => {
    const input = { items: [{ token: 't1' }, { token: 't2' }] }
    expect(scrub(input)).toEqual({ items: [{ token: '[REDACTED]' }, { token: '[REDACTED]' }] })
  })

  it('truncates string values larger than 8KB', () => {
    const big = 'a'.repeat(8193)
    const out = scrub({ note: big }) as { note: string }
    expect(out.note).toBe(`[TRUNCATED:8193]`)
  })

  it('accepts opt-in extra redaction keys', () => {
    const input = { internalId: 'abc', other: 'ok' }
    const out = scrub(input, { extraKeys: ['internalId'] }) as Record<string, unknown>
    expect(out.internalId).toBe('[REDACTED]')
    expect(out.other).toBe('ok')
  })

  it('preserves null and undefined', () => {
    expect(scrub({ a: null, b: undefined })).toEqual({ a: null, b: undefined })
  })

  it('does not mutate the input', () => {
    const input = { password: 'abc' }
    scrub(input)
    expect(input).toEqual({ password: 'abc' })
  })
})

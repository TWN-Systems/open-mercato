import { createLangfuseTracer } from '../lib/llm-tracer'

describe('langfuse tracer', () => {
  it('creates a trace and records a generation', async () => {
    const updateMock = jest.fn()
    const generationMock = jest.fn(() => ({ end: jest.fn(), update: jest.fn() }))
    const trace = { update: updateMock, generation: generationMock }
    const client = { trace: jest.fn(() => trace) } as any
    const tracer = createLangfuseTracer(() => client)

    const result = await tracer.traceLLM({ name: 'test', input: { q: 1 } }, async (ctx) => {
      ctx.recordGeneration({ name: 'gen', model: 'claude', input: { q: 1 }, output: 'ok' })
      return 'done'
    })

    expect(result).toBe('done')
    expect(client.trace).toHaveBeenCalledWith(expect.objectContaining({ name: 'test' }))
    expect(generationMock).toHaveBeenCalled()
  })

  it('scrubs sensitive fields from input', async () => {
    const generationMock = jest.fn(() => ({ end: jest.fn(), update: jest.fn() }))
    const trace = { update: jest.fn(), generation: generationMock }
    const client = { trace: jest.fn(() => trace) } as any
    const tracer = createLangfuseTracer(() => client)

    await tracer.traceLLM({ name: 'test', input: { password: 'nope', q: 1 } }, async () => 'x')

    expect(client.trace).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ password: '[REDACTED]' }) })
    )
  })

  it('records an error and rethrows', async () => {
    const updateMock = jest.fn()
    const trace = { update: updateMock, generation: jest.fn() }
    const client = { trace: jest.fn(() => trace) } as any
    const tracer = createLangfuseTracer(() => client)

    await expect(
      tracer.traceLLM({ name: 'test', input: {} }, async () => { throw new Error('boom') })
    ).rejects.toThrow('boom')

    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ level: 'ERROR' }))
  })
})

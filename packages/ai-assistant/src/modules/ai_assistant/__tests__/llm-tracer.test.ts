import { noopTracer } from '../lib/llm-tracer-types'

describe('noopTracer', () => {
  it('invokes fn and returns its result', async () => {
    const result = await noopTracer.traceLLM({ name: 'x', input: {} }, async (ctx) => {
      ctx.recordGeneration({ name: 'gen', input: {} })
      return 42
    })
    expect(result).toBe(42)
  })

  it('propagates errors', async () => {
    await expect(
      noopTracer.traceLLM({ name: 'x', input: {} }, async () => { throw new Error('boom') })
    ).rejects.toThrow('boom')
  })
})

import { noopTracer } from '../lib/llm-tracer-types'

describe('ai-assistant without observability', () => {
  it('noopTracer invokes fn and returns value unchanged', async () => {
    const result = await noopTracer.traceLLM(
      { name: 'unit.test', input: { q: 1 } },
      async () => ({ answer: 42 }),
    )
    expect(result).toEqual({ answer: 42 })
  })

  it('noopTracer accepts ctx.recordGeneration calls without side effects', async () => {
    await noopTracer.traceLLM({ name: 'unit.test', input: {} }, async (ctx) => {
      expect(() =>
        ctx.recordGeneration({ name: 'generation', input: {}, output: {} }),
      ).not.toThrow()
      return 'ok'
    })
  })

  it('noopTracer propagates errors from the wrapped function', async () => {
    const boom = new Error('boom')
    await expect(
      noopTracer.traceLLM({ name: 'unit.test', input: {} }, async () => {
        throw boom
      }),
    ).rejects.toBe(boom)
  })
})

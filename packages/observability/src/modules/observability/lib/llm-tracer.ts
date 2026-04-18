import type {
  LLMTracer,
  LLMTraceContext,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/llm-tracer-types'
import { scrub } from './redaction'

type LangfuseLike = {
  trace(opts: {
    name: string
    input: unknown
    userId?: string
    metadata?: Record<string, unknown>
  }): {
    update(opts: Record<string, unknown>): void
    generation(opts: {
      name: string
      model?: string
      input: unknown
      output?: unknown
      usage?: Record<string, unknown>
    }): { end(): void; update(opts: Record<string, unknown>): void }
  }
}

type ClientFactory = () => LangfuseLike

export function createLangfuseTracer(factory: ClientFactory): LLMTracer {
  return {
    async traceLLM(opts, fn) {
      const client = factory()
      const trace = client.trace({
        name: opts.name,
        input: scrub(opts.input),
        userId: opts.userId,
        metadata: {
          ...(opts.metadata ?? {}),
          tenantId: opts.tenantId,
        },
      })
      const ctx: LLMTraceContext = {
        recordGeneration(gen) {
          trace
            .generation({
              name: gen.name,
              model: gen.model,
              input: scrub(gen.input),
              output: scrub(gen.output),
              usage: gen.usage as Record<string, unknown> | undefined,
            })
            .end()
        },
      }
      try {
        const result = await fn(ctx)
        trace.update({ output: scrub(result) })
        return result
      } catch (err) {
        trace.update({
          level: 'ERROR',
          statusMessage: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
    },
  }
}

export type LLMTraceInput = {
  name: string
  input: unknown
  metadata?: Record<string, unknown>
  userId?: string
  tenantId?: string
}

export type LLMTraceContext = {
  recordGeneration(opts: {
    name: string
    model?: string
    input: unknown
    output?: unknown
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
  }): void
}

export interface LLMTracer {
  traceLLM<T>(opts: LLMTraceInput, fn: (ctx: LLMTraceContext) => Promise<T>): Promise<T>
}

export const noopTracer: LLMTracer = {
  async traceLLM(_opts, fn) {
    const ctx: LLMTraceContext = { recordGeneration: () => undefined }
    return fn(ctx)
  },
}

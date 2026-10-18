import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { Tokens } from '../types'

const tokens = atom({ plugin: 'ctx', key: 'tokens' } as const, {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  lastHit: 0,
  contextPct: 0,
  tps: 0,
} as Tokens)

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

// Output tokens per second over one model request; 0 when it is too short to mean anything.
export function rate(outputTokens: number, ms: number): number {
  return ms >= 200 && outputTokens > 0 ? Math.round(outputTokens / (ms / 1000)) : 0
}

// The app heads the line with the mod's name, `ctx`, so the text starts at
// the context figure and reads on from it.
export function line(t: Tokens): string {
  const prompt = t.input + t.cacheRead + t.cacheWrite
  const hit = prompt > 0 ? Math.round((t.cacheRead / prompt) * 100) : 0
  return [
    `${t.contextPct}%`,
    `in ${fmt(t.input)}`,
    `out ${fmt(t.output)}`,
    ...(t.tps > 0 ? [`${t.tps} tps`] : []),
    `read ${fmt(t.cacheRead)}`,
    `write ${fmt(t.cacheWrite)}`,
    `${hit}% hit`,
  ].join(' · ')
}

async function show($: Engine) {
  $.ui.status(line(await read($, tokens)))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const { context } = await $.session.usage()
    await update($, tokens, now => ({ ...now, contextPct: context.percent ?? now.contextPct }))
    await show($)
    return next(e)
  })

  // Every model request of a turn, the main loop's and subagents' alike.
  on('turn.step', async function* ($, e, next) {
    const startedAt = await $.clock.now()
    const step = yield* next(e)
    const elapsed = (await $.clock.now()) - startedAt
    const usage = step.usage
    if (usage) {
      const prompt =
        usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
      await update($, tokens, now => ({
        ...now,
        input: now.input + usage.input_tokens,
        output: now.output + usage.output_tokens,
        cacheRead: now.cacheRead + usage.cache_read_input_tokens,
        cacheWrite: now.cacheWrite + usage.cache_creation_input_tokens,
        lastHit: prompt > 0 ? Math.round((usage.cache_read_input_tokens / prompt) * 100) : 0,
        // A short or empty step keeps the last reading instead of blanking it.
        tps: rate(usage.output_tokens, elapsed) || now.tps,
      }))
      await show($)
    }
    return step
  })

  on('session.measure', async ($, e, next) => {
    await update($, tokens, now => ({ ...now, contextPct: e.context.percent ?? now.contextPct }))
    await show($)
    return next(e)
  })
}

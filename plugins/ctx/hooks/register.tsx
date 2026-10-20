import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { Limit, Limits, Tokens } from '../types'

const tokens = atom({ plugin: 'ctx', key: 'tokens' } as const, {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  lastHit: 0,
  contextPct: 0,
  tps: 0,
} as Tokens)

const limits = atom({ plugin: 'ctx', key: 'limits' } as const, {
  windows: [],
  readAt: 0,
} as Limits)

// A figure worth a look is drawn in the theme's warning or error color;
// everything else stays plain text, as does a lead drawn before the figure.
export type Tone = 'warning' | 'error'
export type Part = { lead?: string; text: string; tone?: Tone }

// The cache hit is judged only once this many prompt tokens have gone by:
// the first requests of a session always write the cache, so an early low
// hit says nothing.
const HIT_MIN_PROMPT = 50_000

// The plan's usage windows, in the order drawn, by the names the API reports.
const WINDOWS = ['five_hour', 'seven_day']

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

// Time left as its two largest units: `3d4h`, `2h10m`, `42m`.
export function until(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `${days}d${hours}h`
  if (hours > 0) return `${hours}h${minutes % 60}m`
  return `${minutes}m`
}

// Output tokens per second over one model request; 0 when it is too short to mean anything.
export function rate(outputTokens: number, ms: number): number {
  return ms >= 200 && outputTokens > 0 ? Math.round(outputTokens / (ms / 1000)) : 0
}

export function contextTone(pct: number): Tone | undefined {
  if (pct >= 80) return 'error'
  if (pct >= 60) return 'warning'
  return undefined
}

export function hitTone(hit: number, prompt: number): Tone | undefined {
  if (prompt < HIT_MIN_PROMPT) return undefined
  if (hit < 50) return 'error'
  if (hit < 80) return 'warning'
  return undefined
}

export function usageTone(pct: number): Tone | undefined {
  if (pct >= 90) return 'error'
  if (pct >= 75) return 'warning'
  return undefined
}

export function parts(t: Tokens): Part[] {
  const prompt = t.input + t.cacheRead + t.cacheWrite
  const hit = prompt > 0 ? Math.round((t.cacheRead / prompt) * 100) : 0
  return [
    { text: `${t.contextPct}%`, tone: contextTone(t.contextPct) },
    { text: `in ${fmt(t.input)}` },
    { text: `out ${fmt(t.output)}` },
    ...(t.tps > 0 ? [{ text: `${t.tps} tps` }] : []),
    { text: `read ${fmt(t.cacheRead)}` },
    { text: `write ${fmt(t.cacheWrite)}` },
    { text: `${hit}% hit`, tone: hitTone(hit, prompt) },
  ]
}

// The 5-hour window, then the week: the time left until each resets and how
// much of it is used. Nothing until the first API response reports them, or
// ever off a subscription.
export function usageParts(windows: Limit[], now: number): Part[] {
  return WINDOWS.flatMap(kind => {
    const w = windows.find(l => l.kind === kind)
    if (!w) return []
    const resetsAt = w.resetsAt ? Date.parse(w.resetsAt) : NaN
    return [
      {
        ...(Number.isNaN(resetsAt) ? {} : { lead: until(resetsAt - now) }),
        text: `${Math.round(w.percentUsed)}%`,
        tone: usageTone(w.percentUsed),
      },
    ]
  })
}

export function line(ps: Part[]): string {
  return ps.map(p => (p.lead ? `${p.lead} ${p.text}` : p.text)).join(' · ')
}

async function readLimits($: Engine) {
  const { rateLimits } = await $.session.usage()
  const readAt = await $.clock.now()
  await update($, limits, () => ({ windows: rateLimits, readAt }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Earlier versions pinned the figures as a status line, which cannot be
    // colored; they now live in the band above the prompt instead.
    $.ui.status(undefined)
    const { context } = await $.session.usage()
    await update($, tokens, now => ({ ...now, contextPct: context.percent ?? now.contextPct }))
    await readLimits($)
    // Once a minute, so the countdowns move while the session sits idle.
    $.clock.every(60_000, () => readLimits($))
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
      // Each API response carries the plan's latest usage.
      await readLimits($)
    }
    return step
  })

  on('session.measure', async ($, e, next) => {
    await update($, tokens, now => ({ ...now, contextPct: e.context.percent ?? now.contextPct }))
    return next(e)
  })

  // One row above the prompt, redrawn whenever the figures change: tokens on
  // the left, plan usage on the right.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const { windows, readAt } = await read($, limits)
    const left = parts(await read($, tokens))
    const right = usageParts(windows, readAt)

    const draw = (ps: Part[]) =>
      ps.map((p, i) => [
        i > 0 ? ' · ' : '',
        p.lead ? `${p.lead} ` : '',
        p.tone ? <Text color={p.tone}>{p.text}</Text> : p.text,
      ])

    return (
      <Box width={e.props.bodyColumns} justifyContent="space-between" gap={2}>
        <Box flexShrink={1}>
          <Text wrap="truncate-end">
            <Text dimColor>ctx </Text>
            {draw(left)}
          </Text>
        </Box>
        {right.length > 0 ? (
          <Box flexShrink={0}>
            <Text>{draw(right)}</Text>
          </Box>
        ) : null}
      </Box>
    )
  })
}

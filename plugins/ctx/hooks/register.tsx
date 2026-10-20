import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Limit, Limits, Tokens } from '../types'

const tokens = atom({ plugin: 'ctx', key: 'tokens' } as const, {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  contextPct: 0,
  tps: 0,
} as Tokens)

const limits = atom({ plugin: 'ctx', key: 'limits' } as const, {
  windows: [],
  now: 0,
} as Limits)

// A figure worth a look is drawn in the theme's warning or error color;
// everything else stays plain text. A note follows its figure, dimmed.
export type Tone = 'warning' | 'error'
export type Part = { text: string; tone?: Tone; note?: string }

// The cache hit is judged only once this many prompt tokens have gone by:
// the first requests of a session always write the cache, so an early low
// hit says nothing.
const HIT_MIN_PROMPT = 50_000

// The plan's usage windows, in the order drawn, by the names the API reports.
const WINDOWS: Record<string, string> = { five_hour: '5h', seven_day: 'wk' }

// Rounded first, so 999,950 reads 1.0M and never 1000.0k.
export function fmt(n: number): string {
  if (n >= 999_950) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

// Time left as its two largest units, rounded up so a window that has not
// reset never reads 0m: `3d 4h`, `2h 10m`, `42m`, and `3d` or `1h` when the
// smaller unit is 0.
export function until(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  return `${mins}m`
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

// The 5-hour window, then the week: how much of each is used and, dimmed,
// the time until it resets. Nothing until the first API response reports
// them, or ever off a subscription. A window whose reset has passed is
// fresh, though no response has said so yet.
export function usageParts(windows: Limit[], now: number): Part[] {
  return Object.entries(WINDOWS).flatMap(([kind, label]) => {
    const w = windows.find(l => l.kind === kind)
    if (!w) return []
    const resetsAt = w.resetsAt ? Date.parse(w.resetsAt) : NaN
    if (resetsAt <= now) return [{ text: `${label} 0%` }]
    // The tone is judged on the figure drawn, so 74.6 reads 75% and is a warning.
    const pct = Math.round(w.percentUsed)
    return [
      {
        text: `${label} ${pct}%`,
        tone: usageTone(pct),
        ...(Number.isNaN(resetsAt) ? {} : { note: `(${until(resetsAt - now)})` }),
      },
    ]
  })
}

export function line(ps: Part[]): string {
  return ps.map(p => (p.note ? `${p.text} ${p.note}` : p.text)).join(' · ')
}

// Whether two readings would draw the same windows.
export function sameWindows(a: Limit[], b: Limit[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (w, i) =>
        w.kind === b[i]?.kind && w.percentUsed === b[i]?.percentUsed && w.resetsAt === b[i]?.resetsAt,
    )
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Earlier versions pinned the figures as a status line, which cannot be
    // colored; they now live under the prompt's hint line instead.
    $.ui.status(undefined)
    const { context, rateLimits } = await $.session.usage()
    const now = await $.clock.now()
    await update($, tokens, t => ({ ...t, contextPct: context.percent ?? t.contextPct }))
    await update($, limits, () => ({ windows: rateLimits, now }))
    // The windows only change with an API response; once a minute the clock
    // moves on, so the countdowns do too while the session sits idle.
    $.clock.every(60_000, async () => {
      const now = await $.clock.now()
      await update($, limits, l => ({ ...l, now }))
    })
    return next(e)
  })

  // Every model request of a turn, the main loop's and subagents' alike.
  on('turn.step', async function* ($, e, next) {
    const startedAt = await $.clock.now()
    const step = yield* next(e)
    const now = await $.clock.now()
    const usage = step.usage
    if (usage) {
      await update($, tokens, t => ({
        ...t,
        input: t.input + usage.input_tokens,
        output: t.output + usage.output_tokens,
        cacheRead: t.cacheRead + usage.cache_read_input_tokens,
        cacheWrite: t.cacheWrite + usage.cache_creation_input_tokens,
        // A short or empty step keeps the last reading instead of blanking it.
        tps: rate(usage.output_tokens, now - startedAt) || t.tps,
      }))
      // Each API response carries the plan's latest usage; redraw only when it moved.
      const { rateLimits } = await $.session.usage()
      if (!sameWindows(rateLimits, (await read($, limits)).windows)) {
        await update($, limits, () => ({ windows: rateLimits, now }))
      }
    }
    return step
  })

  on('session.measure', async ($, e, next) => {
    await update($, tokens, t => ({ ...t, contextPct: e.context.percent ?? t.contextPct }))
    return next(e)
  })

  // The engine's hint line under the prompt, then one row of figures, redrawn
  // whenever they change: tokens on the left, plan usage on the right.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const hint = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const { windows, now } = await read($, limits)
    const left = parts(await read($, tokens))
    const right = usageParts(windows, now)

    const draw = (ps: Part[]) =>
      ps.map((p, i) => [
        i > 0 ? ' · ' : '',
        p.tone ? <Text color={p.tone}>{p.text}</Text> : p.text,
        p.note ? <Text dimColor> {p.note}</Text> : '',
      ])

    return (
      <Box flexDirection="column">
        {hint}
        <Box width="100%" justifyContent="space-between" gap={2}>
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
      </Box>
    )
  })
}

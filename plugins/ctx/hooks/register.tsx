import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register, RenderInput } from 'claude-code'

import type { Limit, Limits, Place, Saved, Tokens } from '../types'

const ZERO: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, contextPct: 0, tps: 0 }

const tokens = atom({ plugin: 'ctx', key: 'tokens' } as const, ZERO)

const limits = atom({ plugin: 'ctx', key: 'limits' } as const, {
  windows: [],
  now: 0,
} as Limits)

const place = atom({ plugin: 'ctx', key: 'place' } as const, { dir: '', model: '' } as Place)

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

// $.store keys: each session's figures under its own key, so two sessions
// running at once never write over each other, and the account's last
// usage reading. Only the most recently saved sessions are kept.
const SESSION_KEY = 'session:'
const LIMITS_KEY = 'limits'
const KEEP_SESSIONS = 20

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

// The model as `/model` names it, from the id the engine reports:
// claude-opus-5-5 reads Opus 5.5. An id of any other shape is drawn as it is.
export function modelName(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[[^\]]*\])?$/.exec(id)
  if (!m) return id
  const [, family = '', major, minor] = m
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}`
}

// The folder with the home directory as ~, as a shell prompt has it.
export function shortDir(dir: string, home?: string): string {
  if (!home) return dir
  if (dir === home) return '~'
  return dir.startsWith(home + '/') ? '~' + dir.slice(home.length) : dir
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

// The session's figures: context fill, the cache hit over the session's
// totals, and the speed of the last request. The totals themselves are kept
// for the hit but not drawn.
export function parts(t: Tokens): Part[] {
  const prompt = t.input + t.cacheRead + t.cacheWrite
  const hit = prompt > 0 ? Math.round((t.cacheRead / prompt) * 100) : 0
  return [
    { text: `${t.contextPct}%`, tone: contextTone(t.contextPct) },
    { text: `${hit}% hit`, tone: hitTone(hit, prompt) },
    ...(t.tps > 0 ? [{ text: `${t.tps} tps` }] : []),
  ]
}

// Where the session is and what answers it: the folder with its git branch,
// then the model with its effort, dimmed. Nothing until they are read.
export function placeParts(p: Place): Part[] {
  return [
    ...(p.dir ? [{ text: p.branch ? `${p.dir} (${p.branch})` : p.dir }] : []),
    ...(p.model ? [{ text: modelName(p.model), ...(p.effort ? { note: p.effort } : {}) }] : []),
  ]
}

// The 5-hour window, then the week: how much of each is used and, dimmed,
// the time until it resets. Nothing until a response or the store reports
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

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

// What the store holds is a file on disk: read back only what has the right shape.
export function asSaved(v: unknown): Saved | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const s = v as Record<string, unknown>
  const fields = ['input', 'output', 'cacheRead', 'cacheWrite', 'contextPct', 'savedAt'] as const
  if (!fields.every(f => isCount(s[f]))) return undefined
  return s.effort === undefined || typeof s.effort === 'string' ? (s as Saved) : undefined
}

export function asLimits(v: unknown): Limit[] {
  if (!Array.isArray(v)) return []
  return v.filter(
    (l): l is Limit =>
      typeof l === 'object' &&
      l !== null &&
      typeof l.kind === 'string' &&
      isCount(l.percentUsed) &&
      (l.resetsAt === undefined || typeof l.resetsAt === 'string'),
  )
}

// The keys of the sessions past the newest `keep`, oldest first.
export function stale(saved: { key: string; savedAt: number }[], keep: number): string[] {
  return [...saved]
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(keep)
    .map(s => s.key)
}

// The session the figures in state belong to, and the last figures stored
// for each, so a save that would change nothing is skipped.
let loadedId: string | undefined
const lastSaved = new Map<string, string>()

// Loads a session's figures into state, which starts empty for every
// session: its stored totals, the context fill (the live one where the
// engine has it, else the stored one), and the plan's usage as the engine
// last read it, else the stored reading, the account's whatever the session.
async function load($: Engine, id: string, livePct?: number) {
  const saved = asSaved(await $.store.get(SESSION_KEY + id))
  const figures = saved
    ? {
        input: saved.input,
        output: saved.output,
        cacheRead: saved.cacheRead,
        cacheWrite: saved.cacheWrite,
      }
    : {}
  const contextPct = livePct ?? saved?.contextPct ?? 0
  await update($, tokens, () => ({ ...ZERO, ...figures, contextPct }))
  await update($, place, p => ({ ...p, effort: saved?.effort }))

  const { rateLimits } = await $.session.usage()
  const windows = rateLimits.length > 0 ? rateLimits : asLimits(await $.store.get(LIMITS_KEY))
  const now = await $.clock.now()
  await update($, limits, () => ({ windows, now }))
  loadedId = id
}

// The branch checked out, or the commit when none is; undefined outside a
// repository or where commands cannot run.
async function branch($: Engine): Promise<string | undefined> {
  if (!(await $.session.repo())) return undefined
  try {
    for (const argv of [
      ['git', 'symbolic-ref', '--short', '-q', 'HEAD'],
      ['git', 'rev-parse', '--short', 'HEAD'],
    ]) {
      const { exitCode, stdout } = await $.process.run(argv, { timeoutMs: 5_000 })
      if (exitCode === 0 && stdout.trim()) return stdout.trim()
    }
  } catch {
    // No branch rather than no row.
  }
  return undefined
}

// Reads the folder, branch and model afresh: on start, after each turn and
// once a minute, so a /model or a change of directory shows soon after.
async function locate($: Engine) {
  const dir = shortDir(await $.session.cwd(), await $.env.get('HOME'))
  const b = await branch($)
  const model = await $.session.model()
  await update($, place, p => ({ ...p, dir, branch: b, model }))
}

// A /clear or an in-app resume goes on under another session id with no
// session.start, and with the session's state empty again: the first event
// that sees the new id loads its figures. The engine's context fill is the
// old session's until a response, so the stored one stands in.
async function follow($: Engine) {
  const id = await $.session.id()
  if (id !== loadedId) await load($, id)
}

async function save($: Engine, id: string) {
  if (id !== loadedId) return
  const { tps, ...figures } = await read($, tokens)
  // A session that never had a request has nothing worth keeping.
  if (figures.input + figures.output + figures.cacheRead + figures.cacheWrite === 0) return
  const { effort } = await read($, place)
  const kept = effort === undefined ? figures : { ...figures, effort }
  const text = JSON.stringify(kept)
  if (lastSaved.get(id) === text) return
  await $.store.set(SESSION_KEY + id, { ...kept, savedAt: await $.clock.now() })
  lastSaved.set(id, text)
}

// The session that is open is never pruned, however long ago it was saved.
async function prune($: Engine, id: string) {
  const keys = (await $.store.keys()).filter(k => k.startsWith(SESSION_KEY) && k !== SESSION_KEY + id)
  if (keys.length < KEEP_SESSIONS) return
  const saved = await Promise.all(
    keys.map(async key => ({ key, savedAt: asSaved(await $.store.get(key))?.savedAt ?? 0 })),
  )
  for (const key of stale(saved, KEEP_SESSIONS - 1)) await $.store.delete(key)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Earlier versions pinned the figures as a status line, which cannot be
    // colored; they now live under the prompt's hint line instead.
    $.ui.status(undefined)
    const id = await $.session.id()
    // A hot reload keeps the session's state, which is newer than the store.
    // Otherwise a resumed session has no fill until its first response, so
    // its stored one stands in.
    const t = await read($, tokens)
    if (t.input + t.output + t.cacheRead + t.cacheWrite > 0) loadedId = id
    else await load($, id, (await $.session.usage()).context.percent)
    await locate($)

    // The windows change with responses; once a minute the clock moves on,
    // so the countdowns do too while the session sits idle.
    $.clock.every(60_000, async () => {
      await follow($)
      const now = await $.clock.now()
      await update($, limits, l => ({ ...l, now }))
      await locate($)
    })
    await prune($, id)
    return next(e)
  })

  // Every model request of a turn, the main loop's and subagents' alike. The
  // effort is the main loop's alone, as it was sent.
  on('turn.step', async function* ($, e, next) {
    await follow($)
    if (e.agentId === undefined) {
      const effort = e.effort === undefined ? undefined : String(e.effort)
      await update($, place, p => ({ ...p, effort }))
    }
    const startedAt = await $.clock.now()
    const step = yield* next(e)
    const usage = step.usage
    if (usage) {
      const elapsed = (await $.clock.now()) - startedAt
      await update($, tokens, t => ({
        ...t,
        input: t.input + usage.input_tokens,
        output: t.output + usage.output_tokens,
        cacheRead: t.cacheRead + usage.cache_read_input_tokens,
        cacheWrite: t.cacheWrite + usage.cache_creation_input_tokens,
        // A short or empty step keeps the last reading instead of blanking it.
        tps: rate(usage.output_tokens, elapsed) || t.tps,
      }))
    }
    return step
  })

  // After each main-thread turn, and when a usage window moves a whole point;
  // the figures are saved here, once the turn's context fill is in, rather
  // than on every request.
  on('session.measure', async ($, e, next) => {
    await follow($)
    if (e.context.percent !== undefined) {
      await update($, tokens, t => ({ ...t, contextPct: e.context.percent ?? t.contextPct }))
    }
    if (e.changed.includes('rateLimits') && e.rateLimits.length > 0) {
      const now = await $.clock.now()
      await update($, limits, () => ({ windows: e.rateLimits, now }))
      await $.store.set(LIMITS_KEY, e.rateLimits)
    }
    await save($, await $.session.id())
    await locate($)
    return next(e)
  })

  // Saved as the session ends too: exit, /clear, a resume. The process goes
  // on under the next session after a /clear or a resume, whose figures load
  // a moment later rather than the old ones standing until its first request.
  on('session.end', async ($, e, next) => {
    await save($, e.sessionId)
    if (e.reason === 'clear' || e.reason === 'resume') $.clock.after(1_000, () => follow($))
    return next(e)
  })

  // The engine's hint line under the prompt, then the row beneath it.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const hint = await next(e)
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {hint}
        {await row($, e)}
      </Box>
    )
  })

  // The desktop app draws no hint line under the prompt in a local session,
  // so there the same row goes in the band above the prompt instead, giving
  // way to a survey. The terminal leaves the band alone.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || e.props.hasSurvey) return next(e)
    return row($, e)
  })
}

// One row, redrawn whenever its values change: where the session is and the
// model, then the session's figures, on the left; plan usage on the right.
async function row($: Engine, e: RenderInput<'PromptHint' | 'AbovePrompt'>) {
  const { Box, Text } = $.ui.resolve(e)
  const { windows, now } = await read($, limits)
  const at = placeParts(await read($, place))
  const left = parts(await read($, tokens))
  const right = usageParts(windows, now)

  const draw = (ps: Part[]) =>
    ps.map((p, i) => [
      i > 0 ? ' · ' : '',
      p.tone ? <Text color={p.tone}>{p.text}</Text> : p.text,
      p.note ? <Text dimColor> {p.note}</Text> : '',
    ])

  return (
    <Box width="100%" justifyContent="space-between" gap={2}>
      <Box flexShrink={1}>
        <Text wrap="truncate-end">
          {at.length > 0 ? [draw(at), <Text dimColor> │ </Text>] : ''}
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
}

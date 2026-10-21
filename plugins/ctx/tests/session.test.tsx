import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const HINT = {
  plugin: 'ctx',
  component: 'PromptHint',
  props: { isDraft: false, isWorking: false, hint: 'auto mode on' },
} as const

const NOW = Date.parse('2026-10-20T12:00:00Z')

const FIVE_HOUR = { kind: 'five_hour', percentUsed: 7, resetsAt: '2026-10-20T16:10:00Z' }
const WEEK = { kind: 'seven_day', percentUsed: 11, resetsAt: '2026-10-23T15:00:00Z' }

const USAGE = {
  model: 'claude-opus-5-5',
  input_tokens: 2,
  output_tokens: 200,
  cache_read_input_tokens: 120_000,
  cache_creation_input_tokens: 1_000,
}

// The engine beneath the plugin, as each test needs it: a session whose id,
// context fill and usage windows the test sets, run from ~/proj on main
// with Opus 5.5, a store held in a Map the
// test reads and seeds, counting its writes by key, and timers that are
// refused so they never run on their own.
type Window = { kind: string; percentUsed: number; resetsAt?: string }

function engine(on: On, session: { id: string; percent?: number; rateLimits?: Window[] }) {
  const store = new Map<string, unknown>()
  const writes = new Map<string, number>()
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    writes.set(e.key, (writes.get(e.key) ?? 0) + 1)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.delete', (_, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('session.id', () => ({ value: session.id }))
  on('session.cwd', () => ({ value: '/home/me/proj' }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.repo', () => ({ value: { root: '/home/me/proj', remote: null, internal: false, name: null } }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: 'main\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: { window: 1_000_000, ...(session.percent === undefined ? {} : { percent: session.percent }) },
      rateLimits: session.rateLimits ?? [],
    },
  }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ deny: 'no timers in this test' }))
  on('clock.after', () => ({ deny: 'no timers in this test' }))
  on('turn.step', async function* () {
    return { turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: USAGE }
  })
  on('turn.complete', () => ({ text: '' }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{e.props.hint}</Text>
  })
  return { store, writes }
}

const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const
const STEP = { turnId: 't', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 } as const
const COMPLETE = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const

async function row(ui: { find: (q: { type: 'Text'; text: RegExp }) => Promise<{ text: string } | undefined> }, re: RegExp) {
  return (await ui.find({ type: 'Text', text: re }))?.text
}

test('a resumed session opens on its stored totals, fill and the last usage reading', async ($, on) => {
  const { store } = engine(on, { id: 'abc' })
  store.set('session:abc', {
    input: 2,
    output: 242,
    cacheRead: 130_300,
    cacheWrite: 1_100,
    contextPct: 13,
    effort: 'xhigh',
    savedAt: NOW - 60_000,
  })
  store.set('limits', [FIVE_HOUR, WEEK])

  await $.session.start(START)
  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })

  expect(await row(ui, /│ ctx /)).toBe('~/proj (main) · Opus 5.5 xhigh │ ctx 13% · 99% hit')
  expect(await row(ui, /^5h /)).toBe('5h 7% (4h 10m) · wk 11% (3d 3h)')
  await ui.unmount()
})

test('a new session starts at zero but still shows the account usage', async ($, on) => {
  const { store } = engine(on, { id: 'new' })
  store.set('session:other', { input: 9, output: 9, cacheRead: 9, cacheWrite: 9, contextPct: 9, savedAt: NOW })
  store.set('limits', [FIVE_HOUR])

  await $.session.start(START)
  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })

  expect(await row(ui, /│ ctx /)).toBe('~/proj (main) · Opus 5.5 │ ctx 0% · 0% hit')
  expect(await row(ui, /^5h /)).toBe('5h 7% (4h 10m)')
  await ui.unmount()
})

test('a live fill wins over the stored one, and a stored file of the wrong shape is ignored', async ($, on) => {
  const { store } = engine(on, { id: 'abc', percent: 40 })
  store.set('session:abc', { input: 'lots', output: 1 })
  store.set('limits', 'not a list')

  await $.session.start(START)
  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })

  expect(await row(ui, /│ ctx /)).toBe('~/proj (main) · Opus 5.5 │ ctx 40% · 0% hit')
  expect(await ui.find({ type: 'Text', text: /^5h / })).toBe(undefined)
  await ui.unmount()
})

test('the figures are saved once the turn is measured, and an unchanged turn writes nothing', async ($, on) => {
  const { store, writes } = engine(on, { id: 'abc' })

  await $.session.start(START)
  const s = $.turn.step(STEP)
  for await (const _ of s) {
    // drain
  }
  await $.session.measure({ context: { window: 1_000_000, percent: 12 }, rateLimits: [], changed: ['context'] })
  expect(writes.get('session:abc')).toBe(1)
  expect(store.get('session:abc')).toEqual({
    input: 2,
    output: 200,
    cacheRead: 120_000,
    cacheWrite: 1_000,
    contextPct: 12,
    effort: 'high',
    savedAt: NOW,
  })

  // Nothing new since: no second write.
  await $.session.measure({ context: { window: 1_000_000, percent: 12 }, rateLimits: [], changed: ['cost'] })
  expect(writes.get('session:abc')).toBe(1)
})

test('a session that never had a request is not saved', async ($, on) => {
  const { store } = engine(on, { id: 'empty' })
  await $.session.start(START)
  await $.session.measure({ context: { window: 1_000_000 }, rateLimits: [], changed: ['cost'] })
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 'empty', resume: { id: 'empty' } })
  expect(store.has('session:empty')).toBe(false)
})

test('an in-app resume brings back the new session and reloads the usage', async ($, on) => {
  // The session opens with no usage reading anywhere, as the state of a
  // session switched to does; one is stored by the time of the switch.
  const session = { id: 'fresh' }
  const { store } = engine(on, session)
  store.set('session:old', { input: 2, output: 242, cacheRead: 130_300, cacheWrite: 1_100, contextPct: 13, savedAt: NOW })

  await $.session.start(START)
  await $.session.end({ reason: 'resume', sessionId: 'fresh', resume: { id: 'fresh' } })
  store.set('limits', [FIVE_HOUR, WEEK])
  session.id = 'old'
  await $.session.measure({ context: { window: 1_000_000, percent: 50 }, rateLimits: [], changed: ['cost'] })

  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })
  expect(await row(ui, /│ ctx /)).toBe('~/proj (main) · Opus 5.5 │ ctx 50% · 99% hit')
  expect(await row(ui, /^5h /)).toBe('5h 7% (4h 10m) · wk 11% (3d 3h)')
  await ui.unmount()
})

test('/clear saves the old session and the next one starts from zero', async ($, on) => {
  const session = { id: 'one' }
  const { store } = engine(on, session)

  await $.session.start(START)
  const drain = async () => {
    const s = $.turn.step(STEP)
    for await (const _ of s) {
      // drain
    }
  }
  await drain()
  await $.session.end({ reason: 'clear', sessionId: 'one', resume: { id: 'one' } })
  session.id = 'two'
  await drain()

  expect(store.get('session:one')).toMatchObject({ output: 200 })
  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })
  expect(await row(ui, /│ ctx /)).toBe('~/proj (main) · Opus 5.5 high │ ctx 0% · 99% hit')
  await ui.unmount()
})

test('usage windows come from measurements, and are stored for the next session', async ($, on) => {
  const { store } = engine(on, { id: 'abc' })
  await $.session.start(START)

  // A measurement that only moved the context leaves the windows alone.
  await $.session.measure({ context: { window: 1_000_000, percent: 20 }, rateLimits: [], changed: ['context'] })
  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^5h / })).toBe(undefined)
  expect(await row(ui, /│ ctx /)).toContain('ctx 20%')

  await $.session.measure({
    context: { window: 1_000_000, percent: 20 },
    rateLimits: [{ ...FIVE_HOUR, percentUsed: 80 }],
    changed: ['rateLimits'],
  })
  expect((await ui.find({ type: 'Text', text: /^5h 80%$/ }))?.props.color).toBe('warning')
  expect(store.get('limits')).toEqual([{ ...FIVE_HOUR, percentUsed: 80 }])
  await ui.unmount()
})

test('the store keeps the 20 most recently saved sessions and leaves the usage reading alone', async ($, on) => {
  const { store } = engine(on, { id: 's0' })
  for (let i = 0; i < 23; i++) {
    store.set(`session:s${i}`, { input: 1, output: 1, cacheRead: 1, cacheWrite: 1, contextPct: 1, savedAt: i })
  }
  store.set('limits', [FIVE_HOUR])

  await $.session.start(START)

  const kept = [...store.keys()].filter(k => k.startsWith('session:'))
  // The open session, s0, stays though it was saved first; the 19 newest others stay with it.
  expect(kept.length).toBe(20)
  expect(kept).toContain('session:s0')
  expect(kept).not.toContain('session:s1')
  expect(kept).not.toContain('session:s3')
  expect(kept).toContain('session:s4')
  expect(store.has('limits')).toBe(true)
})

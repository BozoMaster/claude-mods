import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const HINT = {
  plugin: 'ctx',
  component: 'PromptHint',
  props: { isDraft: false, isWorking: false, hint: 'auto mode on (shift+tab to cycle)' },
} as const

const NOW = Date.parse('2026-10-20T12:00:00Z')

test('under the prompt: the hint first, then tokens and plan usage, colored where it matters', async ($, on) => {
  // Nothing sits beneath the plugin: each hook here stands for the engine.
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'abc' }))
  on('session.cwd', () => ({ value: '/home/me/OPC' }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.repo', () => ({ value: null }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('store.get', () => ({ value: undefined }))
  on('store.keys', () => ({ value: [] }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: { tokens: 850_000, window: 1_000_000, percent: 85 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 92, resetsAt: '2026-10-20T14:10:00Z' },
        { kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-23T16:00:00Z' },
      ],
    },
  }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{e.props.hint}</Text>
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /^auto mode on/ }))?.text).toBe(HINT.props.hint)
  // Where and which model, then a dimmed bar, then the session's figures.
  expect((await ui.find({ type: 'Text', text: /│ ctx / }))?.text).toBe('~/OPC · Opus 5.5 │ ctx 85% · 0% hit')
  expect((await ui.find({ type: 'Text', text: /^ │ $/ }))?.props.dimColor).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^85%$/ }))?.props.color).toBe('error')
  expect((await ui.find({ type: 'Text', text: /^5h 92%$/ }))?.props.color).toBe('error')
  expect((await ui.find({ type: 'Text', text: /^ \(2h 10m\)$/ }))?.props.dimColor).toBe(true)
  // The week is under the warning line: plain text in the row, no color of its own.
  expect(await ui.find({ type: 'Text', text: /^wk 40%$/ })).toBe(undefined)
  expect((await ui.find({ type: 'Text', text: /wk 40% \(3d 4h\)/ }))?.text).toContain('5h 92% (2h 10m)')
  await ui.unmount()
})

const BAND = {
  plugin: 'ctx',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('on the desktop: the row goes in the band above the prompt without the model, and the terminal leaves the band alone', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'abc' }))
  on('session.cwd', () => ({ value: '/home/me/OPC' }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.repo', () => ({ value: null }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('store.get', () => ({ value: undefined }))
  on('store.keys', () => ({ value: [] }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: { tokens: 850_000, window: 1_000_000, percent: 85 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 92, resetsAt: '2026-10-20T14:10:00Z' },
        { kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-23T16:00:00Z' },
      ],
    },
  }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  // Stands for the engine's own band.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await desk.find({ type: 'Text', text: /^85%$/ }))?.props.color).toBe('error')
  // The app shows the model and effort itself, so the row leaves them out.
  expect((await desk.find({ type: 'Text', text: /│ ctx / }))?.text).toBe('~/OPC │ ctx 85% · 0% hit')
  expect(await desk.find({ type: 'Text', text: /Opus/ })).toBe(undefined)
  expect((await desk.find({ type: 'Text', text: /^5h 92%$/ }))?.props.color).toBe('error')
  expect(await desk.find({ type: 'Text', text: /^engine band$/ })).toBe(undefined)
  await desk.unmount()

  // A survey keeps the band.
  const survey = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'desktop' })
  expect(await survey.find({ type: 'Text', text: /^engine band$/ })).not.toBe(undefined)
  await survey.unmount()

  // The terminal's band is the engine's: its row stays under the hint line.
  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: /^engine band$/ })).not.toBe(undefined)
  expect(await term.find({ type: 'Text', text: /^85%$/ })).toBe(undefined)
  await term.unmount()
})

// The engine as one session in a given folder: the git branch it reports
// and how many times it was asked for one.
function folder(on: On, cwd: string, gitBranch?: string) {
  const runs = { count: 0 }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'abc' }))
  on('session.cwd', () => ({ value: cwd }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.repo', () => ({
    value: gitBranch ? { root: cwd, remote: null, internal: false, name: null } : null,
  }))
  on('process.run', () => {
    runs.count++
    return {
      value: { exitCode: 0, stdout: `${gitBranch}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('store.get', () => ({ value: undefined }))
  on('store.keys', () => ({ value: [] }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: { tokens: 70_000, window: 1_000_000, percent: 7 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 12, resetsAt: '2026-10-20T14:10:00Z' },
        { kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-23T16:00:00Z' },
      ],
    },
  }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{e.props.hint}</Text>
  })
  return runs
}

const SCRATCH =
  '/home/me/.config/Claude/scratch-workspaces/fe0ea591-7182-443a-b8ad-6c450b8ae7b0/b06c281c-b715-4635-aceb-84b5c11568ca/scratch-2026-11-12-02abf8'

test('a desktop session with no folder shows its figures and usage, with no path and no git lookup', async ($, on) => {
  const runs = folder(on, SCRATCH)
  await $.session.start({ cwd: SCRATCH, surface: 'desktop', isInteractive: true })
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount(surface === 'desktop' ? { ...BAND, surface } : { ...HINT, surface })
    const row = await ui.find({ type: 'Text', text: /ctx / })
    expect(row?.text.startsWith(surface === 'desktop' ? 'ctx 7% · 0% hit' : 'Opus 5.5 │ ctx 7% · 0% hit')).toBe(true)
    expect(row?.text).not.toContain('scratch')
    expect(await ui.find({ type: 'Text', text: /5h 12% \(2h 10m\) · wk 40% \(3d 4h\)/ })).not.toBe(undefined)
    await ui.unmount()
  }
  expect(runs.count).toBe(0)
})

test('a deep folder on a long branch still leaves room for the figures', async ($, on) => {
  folder(on, '/home/me/work/clients/acme/monorepo/packages/frontend/web-app', 'feature/PROJ-1234-rework-the-whole-billing-flow')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount(surface === 'desktop' ? { ...BAND, surface } : { ...HINT, surface })
    const place = '…/monorepo/packages/frontend/web-app (feature/PROJ-1234-rewor…)'
    expect((await ui.find({ type: 'Text', text: /│ ctx / }))?.text).toBe(
      surface === 'desktop' ? `${place} │ ctx 7% · 0% hit` : `${place} · Opus 5.5 │ ctx 7% · 0% hit`,
    )
    expect(await ui.find({ type: 'Text', text: /5h 12% \(2h 10m\) · wk 40% \(3d 4h\)/ })).not.toBe(undefined)
    await ui.unmount()
  }
})

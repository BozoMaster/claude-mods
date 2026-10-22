import { expect, test } from 'claude-code/testing'

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
  on('session.surfaces', () => ({ value: ['terminal'] }))
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

test('on the desktop: the row goes on the status line under the prompt as plain text, without the model', async ($, on) => {
  const statuses: (string | undefined)[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('session.id', () => ({ value: 'abc' }))
  on('session.cwd', () => ({ value: '/home/me/OPC' }))
  on('env.get', (_, e) => ({ value: e.name === 'CTX_DESKTOP_WIDTH' ? '0' : '/home/me' }))
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
  // Stands for the engine's own band.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // The app shows the model and effort itself, so the line leaves them out.
  expect(statuses).toEqual([undefined, '~/OPC │ 85% · 0% hit │ 5h 92% (2h 10m) · wk 40% (3d 4h)'])

  // The band above the prompt is the app's again.
  const band = await $.ui.mount({
    plugin: 'ctx',
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 20,
      bodyColumns: 120,
      scroll: { offset: 0, bodyRows: 20 },
      view: {},
    },
    surface: 'desktop',
  })
  expect(await band.find({ type: 'Text', text: /^engine band$/ })).not.toBe(undefined)
  expect(await band.find({ type: 'Text', text: /^85%$/ })).toBe(undefined)
  await band.unmount()

  // A desktop hint line, where there is one, is left as it is.
  const hint = await $.ui.mount({ ...HINT, surface: 'desktop' })
  expect(await hint.find({ type: 'Text', text: /^auto mode on/ })).not.toBe(undefined)
  expect(await hint.find({ type: 'Text', text: /ctx/ })).toBe(undefined)
  await hint.unmount()
})

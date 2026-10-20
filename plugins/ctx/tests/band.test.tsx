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
  on('session.id', () => ({ value: 'abc' }))
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
    isWorking: false,
    maxRows: 20,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('on the desktop: the row goes in the band above the prompt, and the terminal leaves the band alone', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'abc' }))
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

const MODES = { plugin: 'ctx', component: 'SessionMode', props: { modes: [] as string[] } } as const

test('on the desktop: the row goes in the footer beside the mode labels, and the terminal footer is the engine\'s', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'abc' }))
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
  // Stands for the engine's own mode labels.
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{e.props.modes.join(' & ')}</Text>
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const desk = await $.ui.mount({ ...MODES, surface: 'desktop' })
  expect((await desk.find({ type: 'Text', text: /^85%$/ }))?.props.color).toBe('error')
  expect((await desk.find({ type: 'Text', text: /^5h 92%$/ }))?.props.color).toBe('error')
  expect((await desk.find({ type: 'Text', text: /^ctx 85% · in 0/ }))?.text).toContain('· 5h 92% (2h 10m) · wk 40% (3d 4h)')
  await desk.unmount()

  // A mode the engine shows stays, after the figures.
  const focus = await $.ui.mount({ ...MODES, props: { modes: ['focus'] }, surface: 'desktop' })
  expect(await focus.find({ type: 'Text', text: /^focus$/ })).not.toBe(undefined)
  expect(await focus.find({ type: 'Text', text: /^85%$/ })).not.toBe(undefined)
  await focus.unmount()

  // The terminal's footer is the engine's alone.
  const term = await $.ui.mount({ ...MODES, props: { modes: ['focus'] }, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: /^focus$/ })).not.toBe(undefined)
  expect(await term.find({ type: 'Text', text: /^85%$/ })).toBe(undefined)
  await term.unmount()
})

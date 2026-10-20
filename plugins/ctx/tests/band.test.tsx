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

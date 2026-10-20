import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'ctx',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const NOW = Date.parse('2026-10-20T12:00:00Z')

test('the band draws tokens on the left and plan usage on the right, colored where it matters', async ($, on) => {
  // Nothing sits beneath the plugin: each hook here stands for the engine.
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
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

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /^85%$/ }))?.props.color).toBe('error')
  expect((await ui.find({ type: 'Text', text: /^92%$/ }))?.props.color).toBe('error')
  // The week is under the warning line: plain text in the row, no color of its own.
  expect(await ui.find({ type: 'Text', text: /^40%$/ })).toBe(undefined)
  expect((await ui.find({ type: 'Text', text: /3d4h 40%/ }))?.text).toContain('2h10m 92%')
  await ui.unmount()
})

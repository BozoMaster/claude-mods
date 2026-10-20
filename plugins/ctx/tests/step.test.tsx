import { expect, test } from 'claude-code/testing'

const HINT = {
  plugin: 'ctx',
  component: 'PromptHint',
  props: { isDraft: false, isWorking: false, hint: 'auto mode on' },
} as const

const NOW = Date.parse('2026-10-20T12:00:00Z')

const STEP = { turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }

test('each model request adds its tokens and redraws plan usage only when it moved', async ($, on) => {
  // Nothing sits beneath the plugin: each hook here stands for the engine.
  let fiveHour = 34
  let clock = NOW
  let limitWrites = 0
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: { tokens: 130_000, window: 1_000_000, percent: 13 },
      rateLimits: [{ kind: 'five_hour', percentUsed: fiveHour, resetsAt: '2026-10-20T14:10:00Z' }],
    },
  }))
  on('clock.now', () => ({ value: clock }))
  // Refused, so the minute timer stays out of the count.
  on('clock.every', () => ({ deny: 'no timers in this test' }))
  on('state.set', ($, e, next) => {
    if (e.key === 'limits') limitWrites += 1
    return next(e)
  })
  on('turn.step', async function* () {
    clock += 2_000
    return {
      turnId: 't1',
      index: 0,
      answer: 'ok',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: {
        model: 'claude-opus-5-5',
        input_tokens: 2,
        output_tokens: 200,
        cache_read_input_tokens: 120_000,
        cache_creation_input_tokens: 1_000,
      },
    }
  })

  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{e.props.hint}</Text>
  })

  const step = async () => {
    const s = $.turn.step(STEP)
    for await (const _ of s) {
      // drain
    }
    return s.result
  }

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const writesAtStart = limitWrites

  // Same windows as at start: the tokens move, the usage is not written again.
  await step()
  expect(limitWrites).toBe(writesAtStart)

  // The 5-hour window moved: written once, and drawn.
  fiveHour = 80
  await step()
  expect(limitWrites).toBe(writesAtStart + 1)

  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })
  const row = await ui.find({ type: 'Text', text: /^ctx / })
  expect(row?.text).toBe('ctx 13% · in 4 · out 400 · 100 tps · read 240.0k · write 2.0k · 99% hit')
  expect((await ui.find({ type: 'Text', text: /^5h 80%$/ }))?.props.color).toBe('warning')
  await ui.unmount()
})

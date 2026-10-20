import { expect, test } from 'claude-code/testing'

import {
  contextTone,
  fmt,
  hitTone,
  line,
  parts,
  rate,
  sameWindows,
  until,
  usageParts,
  usageTone,
} from '../hooks/register'

const EMPTY = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, contextPct: 0, tps: 0 }

const NOW = Date.parse('2026-10-20T12:00:00Z')

test('the line reads the totals, the speed and the cache hit', () => {
  const text = line(
    parts({
      input: 1200,
      output: 4100,
      cacheRead: 1_500_000,
      cacheWrite: 80_000,
      contextPct: 13,
      tps: 62,
    }),
  )
  expect(text).toBe('13% · in 1.2k · out 4.1k · 62 tps · read 1.5M · write 80.0k · 95% hit')
})

test('an empty session shows zeros, not NaN, and no speed yet', () => {
  const text = line(parts(EMPTY))
  expect(text).toContain('0% hit')
  expect(text).not.toContain('tps')
})

test('token counts round into the next unit rather than reading 1000.0k', () => {
  expect(fmt(999)).toBe('999')
  expect(fmt(1_000)).toBe('1.0k')
  expect(fmt(999_949)).toBe('999.9k')
  expect(fmt(999_950)).toBe('1.0M')
  expect(fmt(2_345_678)).toBe('2.3M')
})

test('rate is output tokens over seconds, and ignores steps too short to measure', () => {
  expect(rate(500, 10_000)).toBe(50)
  expect(rate(30, 100)).toBe(0)
  expect(rate(0, 5_000)).toBe(0)
})

test('context is plain below 60%, a warning from 60% and an error from 80%', () => {
  expect(contextTone(59)).toBe(undefined)
  expect(contextTone(60)).toBe('warning')
  expect(contextTone(80)).toBe('error')
})

test('a low cache hit is picked out only once enough prompt has gone by', () => {
  expect(hitTone(10, 20_000)).toBe(undefined)
  expect(hitTone(90, 500_000)).toBe(undefined)
  expect(hitTone(70, 500_000)).toBe('warning')
  expect(hitTone(40, 500_000)).toBe('error')
})

test('only the figures that matter carry a tone', () => {
  const toned = parts({ ...EMPTY, contextPct: 85, input: 100_000, tps: 40 }).filter(p => p.tone)
  expect(toned).toEqual([
    { text: '85%', tone: 'error' },
    { text: '0% hit', tone: 'error' },
  ])
})

test('plan usage reads the 5-hour window, then the week, each with the time to its reset', () => {
  const text = line(
    usageParts(
      [
        { kind: 'seven_day', percentUsed: 61.4, resetsAt: '2026-10-23T16:00:00Z' },
        { kind: 'five_hour', percentUsed: 34, resetsAt: '2026-10-20T14:10:00Z' },
      ],
      NOW,
    ),
  )
  expect(text).toBe('5h 34% (2h 10m) · wk 61% (3d 4h)')
})

test('plan usage is empty off a subscription, and a window with no reset has no countdown', () => {
  expect(usageParts([], NOW)).toEqual([])
  expect(line(usageParts([{ kind: 'five_hour', percentUsed: 12 }], NOW))).toBe('5h 12%')
  expect(line(usageParts([{ kind: 'five_hour', percentUsed: 12, resetsAt: 'soon' }], NOW))).toBe('5h 12%')
  expect(usageParts([{ kind: 'spend_limit', percentUsed: 50 }], NOW)).toEqual([])
})

test('a window whose reset has passed reads fresh, not its old figure', () => {
  const ps = usageParts([{ kind: 'five_hour', percentUsed: 95, resetsAt: '2026-10-20T11:59:00Z' }], NOW)
  expect(ps).toEqual([{ text: '5h 0%' }])
})

test('plan usage is plain below 75%, a warning from 75% and an error from 90%', () => {
  expect(usageTone(74)).toBe(undefined)
  expect(usageTone(75)).toBe('warning')
  expect(usageTone(90)).toBe('error')
})

test('the color follows the percent drawn, so 74.6 reads 75% and warns', () => {
  const resetsAt = '2026-10-20T14:00:00Z'
  const [warn] = usageParts([{ kind: 'five_hour', percentUsed: 74.6, resetsAt }], NOW)
  expect(warn).toEqual({ text: '5h 75%', tone: 'warning', note: '(2h)' })
  const [error] = usageParts([{ kind: 'seven_day', percentUsed: 89.6, resetsAt }], NOW)
  expect(error?.tone).toBe('error')
})

test('the countdown keeps its two largest units, drops a zero one, and rounds up', () => {
  expect(until(42 * 60_000)).toBe('42m')
  expect(until(20_000)).toBe('1m')
  expect(until((2 * 60 + 10) * 60_000)).toBe('2h 10m')
  expect(until(60 * 60_000)).toBe('1h')
  expect(until((3 * 24 + 4) * 3_600_000)).toBe('3d 4h')
  expect(until(3 * 24 * 3_600_000)).toBe('3d')
  expect(until(-5_000)).toBe('0m')
})

test('two readings are the same only when every window matches', () => {
  const a = [{ kind: 'five_hour', percentUsed: 34, resetsAt: 'x' }]
  expect(sameWindows(a, [{ ...a[0]! }])).toBe(true)
  expect(sameWindows(a, [{ ...a[0]!, percentUsed: 35 }])).toBe(false)
  expect(sameWindows(a, [])).toBe(false)
  expect(sameWindows([], [])).toBe(true)
})

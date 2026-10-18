import { expect, test } from 'claude-code/testing'

import { line, rate } from '../hooks/register'

const EMPTY = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, lastHit: 0, contextPct: 0, tps: 0 }

test('the status line reads the totals, the speed and the cache hit', () => {
  const text = line({
    input: 1200,
    output: 4100,
    cacheRead: 1_500_000,
    cacheWrite: 80_000,
    lastHit: 97,
    contextPct: 13,
    tps: 62,
  })
  expect(text).toBe('13% · in 1.2k · out 4.1k · 62 tps · read 1.5M · write 80.0k · 95% hit')
})

test('an empty session shows zeros, not NaN, and no speed yet', () => {
  const text = line(EMPTY)
  expect(text).toContain('0% hit')
  expect(text).not.toContain('tps')
})

test('rate is output tokens over seconds, and ignores steps too short to measure', () => {
  expect(rate(500, 10_000)).toBe(50)
  expect(rate(30, 100)).toBe(0)
  expect(rate(0, 5_000)).toBe(0)
})

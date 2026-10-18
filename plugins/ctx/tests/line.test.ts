import { expect, test } from 'claude-code/testing'

import { line } from '../hooks/register'

test('the status line reads the totals and the cache hit', () => {
  const text = line({
    input: 1200,
    output: 4100,
    cacheRead: 1_500_000,
    cacheWrite: 80_000,
    lastHit: 97,
    contextPct: 13,
  })
  expect(text).toBe(
    '13% · in 1.2k · out 4.1k · read 1.5M · write 80.0k · 95% hit',
  )
})

test('an empty session shows zeros, not NaN', () => {
  const text = line({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, lastHit: 0, contextPct: 0 })
  expect(text).toContain('0% hit')
})

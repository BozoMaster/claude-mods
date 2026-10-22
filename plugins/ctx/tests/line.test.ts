import { expect, test } from 'claude-code/testing'

import {
  asLimits,
  asSaved,
  contextTone,
  desktopWidth,
  hitTone,
  line,
  modelName,
  parts,
  placeParts,
  rate,
  shortDir,
  stale,
  until,
  usageParts,
  usageTone,
} from '../hooks/register'

const EMPTY = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, contextPct: 0, tps: 0 }

const NOW = Date.parse('2026-10-20T12:00:00Z')

test('the line reads the context fill, the cache hit over the totals and the speed', () => {
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
  expect(text).toBe('13% · 95% hit · 62 tps')
})

test('the place reads the folder with its branch, then the model with its effort', () => {
  expect(line(placeParts({ dir: '~/OPC', model: 'claude-opus-5-5', effort: 'high' }))).toBe('~/OPC · Opus 5.5 high')
  expect(line(placeParts({ dir: '~/proj', branch: 'main', model: 'claude-sonnet-5-5' }))).toBe('~/proj (main) · Sonnet 5.5')
  expect(placeParts({ dir: '', model: '' })).toEqual([])
})

test('a model id reads as /model names it, and an id of another shape as it is', () => {
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-fable-5-1')).toBe('Fable 5.1')
  expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(modelName('claude-opus-5-5[1m]')).toBe('Opus 5.5')
  expect(modelName('claude-opus-4')).toBe('Opus 4')
  expect(modelName('claude-3-5-sonnet-20241022')).toBe('claude-3-5-sonnet-20241022')
  expect(modelName('gpt-x')).toBe('gpt-x')
})

test('the folder shows the home directory as ~, and only a whole one', () => {
  expect(shortDir('/home/me', '/home/me')).toBe('~')
  expect(shortDir('/home/me/OPC', '/home/me')).toBe('~/OPC')
  expect(shortDir('/home/meg/OPC', '/home/me')).toBe('/home/meg/OPC')
  expect(shortDir('/srv/app', '/home/me')).toBe('/srv/app')
  expect(shortDir('/srv/app', undefined)).toBe('/srv/app')
})

test('an empty session shows zeros, not NaN, and no speed yet', () => {
  const text = line(parts(EMPTY))
  expect(text).toContain('0% hit')
  expect(text).not.toContain('tps')
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

test('stored figures are read back only in the right shape', () => {
  const ok = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, contextPct: 5, savedAt: 6 }
  expect(asSaved(ok)).toEqual(ok)
  expect(asSaved({ ...ok, effort: 'high' })).toEqual({ ...ok, effort: 'high' })
  expect(asSaved({ ...ok, effort: 3 })).toBe(undefined)
  expect(asSaved({ ...ok, input: '1' })).toBe(undefined)
  expect(asSaved({ ...ok, output: -1 })).toBe(undefined)
  expect(asSaved({ ...ok, cacheRead: Number.NaN })).toBe(undefined)
  expect(asSaved(null)).toBe(undefined)
  expect(asSaved('x')).toBe(undefined)
})

test('stored usage windows keep only well-formed entries', () => {
  const w = { kind: 'five_hour', percentUsed: 7, resetsAt: 'x' }
  expect(asLimits([w, { kind: 'seven_day', percentUsed: 'a lot' }, null, { percentUsed: 3 }])).toEqual([w])
  expect(asLimits([{ kind: 'five_hour', percentUsed: 7 }])).toEqual([{ kind: 'five_hour', percentUsed: 7 }])
  expect(asLimits({ kind: 'five_hour' })).toEqual([])
})

test('pruning keeps the newest sessions and names the rest', () => {
  const saved = [
    { key: 'a', savedAt: 1 },
    { key: 'b', savedAt: 3 },
    { key: 'c', savedAt: 2 },
  ]
  expect(stale(saved, 2)).toEqual(['a'])
  expect(stale(saved, 3)).toEqual([])
  expect(stale(saved, 0)).toEqual(['b', 'c', 'a'])
})

test('the desktop width comes from CTX_DESKTOP_WIDTH, 0 turns the padding off, and anything else is the default', () => {
  expect(desktopWidth('120')).toBe(120)
  expect(desktopWidth('0')).toBe(0)
  for (const v of [undefined, '', ' ', 'wide', '-5', '12.5']) expect(desktopWidth(v)).toBe(100)
})

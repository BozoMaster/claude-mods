export type Tokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  contextPct: number
  tps: number
}

// A session's figures as $.store keeps them between runs: the totals and
// the context fill, not the speed, which is only ever live.
export type Saved = Omit<Tokens, 'tps'> & { savedAt: number }

// One plan usage window as the last API response reported it.
export type Limit = {
  kind: string
  percentUsed: number
  resetsAt?: string
}

// The plan's usage windows, and the time the countdowns to each reset are
// drawn from, moved on once a minute.
export type Limits = {
  windows: Limit[]
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    'ctx': { tokens: Tokens; limits: Limits }
  }
}

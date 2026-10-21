export type Tokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  contextPct: number
  tps: number
}

// A session's figures as $.store keeps them between runs: the totals, the
// context fill and the last effort, not the speed, which is only ever live.
export type Saved = Omit<Tokens, 'tps'> & { effort?: string; savedAt: number }

// Where the session is and what answers it: the folder (home as ~), its git
// branch, the model's id, and the effort the last main-loop request was sent
// with.
export type Place = {
  dir: string
  branch?: string
  model: string
  effort?: string
}

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
    'ctx': { tokens: Tokens; limits: Limits; place: Place }
  }
}

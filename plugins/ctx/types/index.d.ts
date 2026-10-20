export type Tokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  lastHit: number
  contextPct: number
  tps: number
}

// One plan usage window as the last API response reported it.
export type Limit = {
  kind: string
  percentUsed: number
  resetsAt?: string
}

// The plan's usage windows and when they were read, so a countdown to each
// reset can be drawn from it.
export type Limits = {
  windows: Limit[]
  readAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'ctx': { tokens: Tokens; limits: Limits }
  }
}

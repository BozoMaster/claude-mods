export type Tokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  lastHit: number
  contextPct: number
  tps: number
}

declare module 'claude-code' {
  interface PluginState {
    'ctx': { tokens: Tokens }
  }
}

# claude-mods

Personal Claude Code mods.

## ctx

Puts context fill and token usage in a row above the prompt, with your plan's usage on
the right: the time left until the 5-hour window resets and how much of it is used, then
the same for the week:

    ctx 18% · in 8 · out 2.5k · 62 tps · read 713.1k · write 11.4k · 98% hit      2h10m 34% · 3d4h 61%

It is plain text, with only the figures that need a look picked out in color:

- context fill turns yellow from 60% and red from 80%
- the cache hit turns yellow under 80% and red under 50% (once 50k prompt tokens have gone
  by, since the first requests always write the cache)
- plan usage turns yellow from 75% and red from 90%

The plan usage shows once the first reply of a session reports it, and stays empty on API
billing.

Install in the desktop app: click **+** next to the prompt box, **Plugins**, **Add marketplace**
with `BozoMaster/claude-mods`, then **Add plugin** `ctx`.

Install from a terminal:

    claude plugin marketplace add BozoMaster/claude-mods
    claude plugin install ctx@claude-mods

Mods run with your user permissions. `ctx` only reads token figures and sets the status line.

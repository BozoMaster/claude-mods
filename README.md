# claude-mods

Personal Claude Code mods.

## ctx

Puts context fill and token usage in a row under the prompt, below its hint line, with
your plan's usage on the right: how much of the 5-hour window is used and the time until
it resets, then the same for the week:

    ctx 18% · in 8 · out 2.5k · 62 tps · read 713.1k · write 11.4k · 98% hit      5h 34% (2h 10m) · wk 61% (3d 4h)

It is plain text, with only the figures that need a look picked out in color:

- context fill turns yellow from 60% and red from 80%
- the cache hit turns yellow under 80% and red under 50% (once 50k prompt tokens have gone
  by, since the first requests always write the cache)
- plan usage turns yellow from 75% and red from 90%

The plan usage shows once the first reply of a session reports it, and stays empty on API
billing. Once a window's reset time passes it reads 0% until the next reply.

Install in the desktop app: click **+** next to the prompt box, **Plugins**, **Add marketplace**
with `BozoMaster/claude-mods`, then **Add plugin** `ctx`.

Install from a terminal:

    claude plugin marketplace add BozoMaster/claude-mods
    claude plugin install ctx@claude-mods

Mods run with your user permissions. `ctx` only reads token figures and sets the status line.

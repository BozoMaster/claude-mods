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

The figures are saved as you go, so a resumed session opens on its own totals and context
fill rather than zeros, and the last plan usage reading shows in any session until the
first reply brings a fresh one (so it can be a little behind if you used Claude elsewhere
meanwhile). `/clear` starts the totals over. The plan usage stays empty on API billing, and
once a window's reset time passes it reads 0% until the next reply.

In the desktop app, which draws no hint line under the prompt in a local session, the same
row, colors and all, sits in the band just above the prompt instead, giving way to a survey.

Install in the desktop app: click **+** next to the prompt box, **Plugins**, **Add marketplace**
with `BozoMaster/claude-mods`, then **Add plugin** `ctx`.

Install from a terminal:

    claude plugin marketplace add BozoMaster/claude-mods
    claude plugin install ctx@claude-mods

Mods run with your user permissions. `ctx` only reads token figures and sets the status line.

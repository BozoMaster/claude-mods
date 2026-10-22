# claude-mods

Personal Claude Code mods.

## ctx

Puts one row under the prompt, below its hint line: the folder (with its git branch) and
the model with its effort level, then context fill, the session's cache hit and the last
request's tokens per second; your plan's usage on the right: how much of the 5-hour window
is used and the time until it resets, then the same for the week:

    ~/proj (main) · Opus 5.5 high │ ctx 18% · 98% hit · 62 tps      5h 34% (2h 10m) · wk 61% (3d 4h)

It is plain text, with only the figures that need a look picked out in color:

- context fill turns yellow from 60% and red from 80%
- the cache hit turns yellow under 80% and red under 50% (once 50k prompt tokens have gone
  by, since the first requests always write the cache)
- plan usage turns yellow from 75% and red from 90%

The effort is the one the last main-conversation request was sent with, so a new session
shows it from the first reply on, and a `/model` or `/effort` change shows after the next
one; it carries over a `/clear` or a resume. The folder, branch and model are read again on
a `/clear` or a resume, after every reply and once a minute.

The figures are saved as you go, so a resumed session opens on its own totals and context
fill rather than zeros, and the last plan usage reading shows in any session until the
first reply brings a fresh one (so it can be a little behind if you used Claude elsewhere
meanwhile). `/clear` starts the totals over. The plan usage stays empty on API billing, and
once a window's reset time passes it reads 0% until the next reply.

In the desktop app, which draws no hint line under the prompt in a local session, the row
goes on the status line under the prompt instead, after the mod's name: plain text with no
colors, right-aligned by the app, and without the model and its effort, which the app shows
beside the prompt. A session the terminal draws too keeps its terminal status line as it is.

Install in the desktop app: click **+** next to the prompt box, **Plugins**, **Add marketplace**
with `BozoMaster/claude-mods`, then **Add plugin** `ctx`.

Install from a terminal:

    claude plugin marketplace add BozoMaster/claude-mods
    claude plugin install ctx@claude-mods

Mods run with your user permissions. `ctx` reads token figures, the session's folder, model
and `HOME`, and runs `git symbolic-ref` (or `git rev-parse`) in a git repository to name the
branch; it changes nothing.

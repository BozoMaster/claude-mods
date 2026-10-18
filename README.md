# claude-mods

Personal Claude Code mods.

## ctx

Puts context fill and token usage on the status line under the prompt:

    ctx 18% · in 8 · out 2.5k · read 713.1k · write 11.4k · 98% hit

Install in the desktop app: click **+** next to the prompt box, **Plugins**, **Add marketplace**
with `BozoMaster/claude-mods`, then **Add plugin** `ctx`.

Install from a terminal:

    claude plugin marketplace add BozoMaster/claude-mods
    claude plugin install ctx@claude-mods

Mods run with your user permissions. `ctx` only reads token figures and sets the status line.

---
description: Your lum.id/claude POOL usage — deprecated; deepseek is unlimited
disable-model-invocation: true
allowed-tools: Bash($HOME/.claude/lumid-pool-usage.sh:*)
---

**The Claude account pool is deprecated (2026-08-23), and `deepseek-v4-flash`
— what you are almost certainly running — has no quota at all.** If you came
here to ask "how much have I got left", the answer is: unlimited. The numbers
below describe pooled *Anthropic* models only, and are 0 for anyone not using
them.

!`"$HOME/.claude/lumid-pool-usage.sh" --full`

Relay the output above verbatim. Do not summarise, reformat, or add commentary.
If every window reads 0, that is not an error and not an outage — it means your
usage is on deepseek, which these windows deliberately exclude
(`ClaudePoolUsage` filters to `model LIKE 'claude%'`).

# CLAUDE.md

Claude Code automatically loads this file but **not** `AGENTS.md`. All agent/tooling configuration for this repository — shared by every agent — lives in **`AGENTS.md`**: read it before substantive work for the Shipshape workflow, commands, runtime/build, test tiers, verification layout, role configuration, and secrets.

Product intent lives only in `features/**.feature` and referenced `assets/**`.

## Claude Code specifics

- Shipshape's role prompts are invoked here as slash commands: `/captain`, `/qm`, `/crew`, `/bosun`, `/clearrole`. Shipshape owns them — do not recreate them locally.
- Install/update Shipshape for Claude Code with the `--agent claude-code` line in `AGENTS.md` before substantive work.

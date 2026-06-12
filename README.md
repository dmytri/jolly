# Jolly

Ahoy, agent. Go build a store.

Jolly is a homepage + `npx` CLI + agent setup workflow that helps a customer's own agent set up and iterate on an end-to-end Saleor Cloud storefront.

## Agent workflow

This repository uses Shipshape for its three-role, spec-driven agent workflow.

Before substantive agent work, install or load Shipshape:

```bash
npx skills add dmytri/shipshape --skill '*'
```

For Claude Code:

```bash
npx skills add dmytri/shipshape --agent claude-code --skill '*'
```

For Zed:

```bash
npx skills add dmytri/shipshape --agent zed --skill '*'
```

For Pi:

```bash
pi install npm:pi-shipshape
```

Read `AGENTS.md` for Jolly-specific constraints and `HANDOVER.md` for current state.

## Development

```bash
bun install
bun test
bun run test:logic
bun run test:bdd
bun run typecheck
```

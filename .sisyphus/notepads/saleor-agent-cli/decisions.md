# Decisions - Jolly CLI

## Package Structure
- Single package @saleor/jolly with multiple bin entries
- Bun runtime, TypeScript throughout
- OpenTUI for rich terminal output

## CLI Architecture
- yargs for argument parsing
- Command-based structure (store, app, agent, config)
- Exit codes: 0 success, 1 error

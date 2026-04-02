# Jolly - Saleor Project Bootstrapper & Agent Configurator

## TL;DR

> **Quick Summary**: Jolly bootstraps Saleor projects and configures local AI agents (OpenCode, Claude Code) with Saleor skills, rules, and MCP access — enabling agents to work with Saleor out of the box.
> 
> **Deliverables**:
> - `jolly` CLI with `bootstrap` command (creates Cloud + Storefront + Payment App)
> - `jolly setup-agents` command (configures OpenCode/Claude Code with skills, rules, MCP)
> - Rich TUI output via OpenTUI
> 
> **Estimated Effort**: Small
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: Project scaffolding → Bootstrap → Agent setup

---

## Context

### Original Request
Build a CLI for agents to use Saleor, inspired by swamp.club. Should:
- Install Saleor's agent skills
- Bootstrap complete new Saleor projects using saleor.io (Saleor Cloud)
- Be TypeScript with Bun runtime

### Clarified Vision
**Jolly replaces saleor CLI for the agent age**. It enables agents to work with Saleor:
1. **Project Bootstrapper** - Creates new Saleor projects (Cloud + Storefront + Payment App)
2. **Agent Configurator** - Sets up local AI agents with Saleor capabilities
3. **Agent Empowerment** - Agents can do everything they could do with manual CLI **and more**

Jolly **provides equivalent functionality** to saleor cli via:
- Saleor Cloud API (for all project/environment operations)
- Official saleor-mcp (for agent tool access to store data)
- saleor/agent-skills (for domain knowledge and best practices)

The agent using jolly + saleor-mcp + skills can:
- Query stores (products, orders, customers)
- Manage environments
- Deploy configurations
- **Plus**: Agent reasoning, automation, and enhanced capabilities

### Interview Summary
**Key Decisions**:
- **Bootstrap scope**: Saleor Cloud env + paper Storefront + hosted Payment App (Dummy/Stripe)
- **Agent setup**: Configure OpenCode + Claude Code with skills, rules, MCP
- **Stack**: Bun runtime, TypeScript, OpenTUI for rich TUI, direct Saleor API calls
- **Test strategy**: Bun's built-in test runner with BDD-inspired architecture

### Research Findings
- **Saleor Cloud API**: Direct API for creating environments, registering apps
- **paper Storefront** (`saleor/storefront`): React-based storefront template
- **Payment Apps**: Hosted on saleor.io - Dummy and Stripe options
- **Official Saleor MCP** (`mcp.saleor.app`): MCP server with channels, customers, orders, products, stocks
- **saleor/agent-skills**: Portable skills (saleor-app, saleor-configurator, saleor-core, saleor-storefront)
- **OpenTUI** (`@opentui/core`): Native Zig TUI core with TypeScript bindings

---

## Work Objectives

### Core Objective
Build a CLI tool that **creates new Saleor ecosystem components** and configures agents:
1. **New Stores** - Create Saleor Cloud environments
2. **New Apps** - Scaffold Saleor apps (Dashboards, Payment, Integrations)
3. **New Agents** - Configure AI agents to work with Saleor
4. **Configurator Integration** - Deploy/store configuration as code

### Concrete Deliverables
- `jolly` CLI executable (Bun-based)
- **Store commands** - Create/manage Saleor Cloud stores
- **App commands** - Scaffold new Saleor apps (Dashboard extensions, Payment apps, webhooks)
- **Agent commands** - Configure AI agents with Saleor capabilities
- **Config commands** - Deploy/configure stores via Configurator

### Definition of Done
- [ ] `jolly store create --name my-store` creates Saleor Cloud store
- [ ] `jolly app create --name my-app --type dashboard-extension` scaffolds app
- [ ] `jolly agent setup` configures agent with skills + AGENTS.md + MCP
- [ ] All commands have proper error handling and exit codes
- [ ] BDD tests pass for core functionality

### Must Have
- **Store creation**: Create Saleor Cloud environments
- **App scaffolding**: New Dashboard extensions, Payment apps, webhook integrations
- **Agent setup**: Configure OpenCode/Claude Code with skills, rules, MCP
- **Config integration**: Deploy/configure stores via Configurator
- Rich TUI output via OpenTUI

### Must NOT Have (Guardrails)
- No Saleor CLI wrapping (jolly uses APIs directly, doesn't wrap CLI)
- No local payment app development (uses hosted apps only)
- No web UI or dashboard
- No plugin system in v1
- No telemetry without consent

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: NO - New project
- **Automated tests**: YES - BDD with Bun test
- **Framework**: Bun's built-in test runner
- **Style**: BDD-inspired (describe/it + Given/When/Then helpers)

### QA Policy
Every task includes agent-executed QA scenarios:
- **CLI**: Use interactive_bash (tmux) to run commands and verify output
- **API**: Use Bash (curl) for Saleor Cloud API calls
- **Agent Config**: Verify files created and formatted correctly

---

## Execution Strategy

### npm Distribution Entry Points

| Command | Entry | Function |
|---------|-------|----------|
| `npx @saleor/jolly` | `jolly` bin | Full CLI (all commands) |
| `npm create @saleor/jolly` | `create-saleor-jolly` bin | Store bootstrap (interactive) |
| `npm init @saleor/jolly` | `init-saleor-jolly` bin | Agent setup |

### CLI Commands (via `npx @saleor/jolly`)

```
jolly store create --name <name>           # Create Saleor Cloud store
jolly store list                            # List your stores
jolly store env create --store <id>        # Create environment

jolly app create --name <name> --type <type>  # Scaffold new app
  # Types: dashboard-extension, payment-app, webhook-handler

jolly agent setup                          # Detect IDE, configure all (skills + AGENTS.md + MCP)
jolly agent skills install                  # Install saleor/agent-skills (IDE-aware paths)

jolly config deploy --store <id>          # Deploy via Configurator
jolly config introspect --store <id>       # Introspect current config
```

### Parallel Execution Waves

```
Wave 1 (Foundation):
├── Task 1: Project scaffolding + package.json + tsconfig
├── Task 2: Core CLI structure (OpenTUI + yargs)
├── Task 3: Saleor Cloud API client
├── Task 4: OpenTUI components for output
└── Task 5: BDD test setup

Wave 2 (Store & App Commands):
├── Task 6: Store commands - create/list environments
├── Task 7: App scaffold command - dashboard extensions
├── Task 8: App scaffold command - payment apps (hosted)
├── Task 9: App scaffold command - webhook handlers

Wave 3 (Agent Commands):
├── Task 10: Agent setup command - skills installation
├── Task 11: Agent setup command - AGENTS.md generation
├── Task 12: Agent setup command - MCP configuration
└── Task 13: Integration tests

Wave FINAL (Verification):
├── Task F1: Plan compliance audit
├── Task F2: Code quality review
├── Task F3: Real Manual QA
└── Task F4: Scope fidelity check
```

---

## TODOs

- [ ] 1. Project scaffolding + package.json + tsconfig

  **What to do**:
  - Initialize Bun TypeScript project
  - Set up tsconfig.json for CLI build
  - Configure bun build for executable
  - Add dependencies: yargs, @opentui/core, @saleor/configurator
  - Set up package.json with bin entries for npm distribution:

  ```json
  {
    "name": "@saleor/jolly",
    "bin": {
      "jolly": "./dist/cli.js",
      "create-saleor-jolly": "./dist/bootstrap.js",
      "init-saleor-jolly": "./dist/agent.js"
    }
  }
  ```

  **npm Entry Points**:
  - `npx @saleor/jolly` → `jolly` bin (full CLI)
  - `npm create @saleor/jolly` → `create-saleor-jolly` bin (store bootstrap)
  - `npm init @saleor/jolly` → `init-saleor-jolly` bin (agent setup)

  **References**:
  - `https://opentui.com` - OpenTUI framework
  - `https://github.com/anomalyco/opentui` - OpenTUI GitHub
  - npm bin naming convention for scoped packages

  **QA Scenarios**:
  ```
  Scenario: Build produces working executable
    Tool: interactive_bash
    Steps:
      1. bun run build
      2. ./dist/jolly.js --version
    Expected: Version string printed
    Evidence: .sisyphus/evidence/task-1-build.{ext}

  Scenario: CLI help displays correctly
    Tool: interactive_bash
    Steps:
      1. ./dist/jolly.js --help
    Expected: Help text with all commands listed
    Evidence: .sisyphus/evidence/task-1-help.{ext}
  ```

- [ ] 2. Core CLI structure (OpenTUI + yargs)

  **What to do**:
  - Set up yargs for argument parsing
  - Integrate OpenTUI renderer for rich output
  - Create base CLI with styled help/version
  - Error handling with styled displays
  - Exit codes (0 success, 1 error)

  **QA Scenarios**:
  ```
  Scenario: CLI returns exit code 0 on success
    Tool: interactive_bash
    Steps:
      1. ./dist/jolly.js --version
    Expected: Exit code 0
    Evidence: .sisyphus/evidence/task-2-exit-success.{ext}

  Scenario: CLI returns exit code 1 on error
    Tool: interactive_bash
    Steps:
      1. ./dist/jolly.js invalid-command
    Expected: Exit code 1 with error message
    Evidence: .sisyphus/evidence/task-2-exit-error.{ext}
  ```

- [ ] 3. Saleor Cloud API client

  **What to do**:
  - Create HTTP client for Saleor Cloud API
  - Auth via SALEOR_CLOUD_TOKEN env var
  - Endpoints: create environment, register app, list apps

  **References**:
  - Saleor Cloud API docs (saleor.io/cloud)
  - API base URL: https://cloud.saleor.io/api/

  **QA Scenarios**:
  ```
  Scenario: API client handles missing token gracefully
    Tool: interactive_bash
    Steps:
      1. SALEOR_CLOUD_TOKEN="" ./dist/jolly.js store list
    Expected: Error message about missing token, exit code 1
    Evidence: .sisyphus/evidence/task-3-missing-token.{ext}

  Scenario: API client creates store (mocked)
    Tool: interactive_bash
    Steps:
      1. SALEOR_CLOUD_TOKEN=test-mock ./dist/jolly.js store create --name test
    Expected: Mock response or appropriate error handling
    Evidence: .sisyphus/evidence/task-3-store-create.{ext}
  ```

- [ ] 4. OpenTUI components for output

  **What to do**:
  - Create reusable OpenTUI components: Box, Text, Spinner, Progress
  - Style system matching OpenCode aesthetic (dark theme, syntax colors)
  - Consistent formatting for all CLI output

  **QA Scenarios**:
  ```
  Scenario: OpenTUI Text component renders with styling
    Tool: interactive_bash
    Steps:
      1. ./dist/jolly.js --help
    Expected: Styled text output (not plain)
    Evidence: .sisyphus/evidence/task-4-text-output.{ext}

  Scenario: OpenTUI Spinner shows during operation
    Tool: interactive_bash
    Steps:
      1. ./dist/jolly.js store create --name test  # with spinner
    Expected: Spinner animation visible during operation
    Evidence: .sisyphus/evidence/task-4-spinner.{ext}
  ```

- [ ] 5. BDD test setup

  **What to do**:
  - Set up Bun test with BDD describe/it
  - Add Given/When/Then helpers
  - Basic CLI structure tests

  **QA Scenarios**:
  ```
  Scenario: BDD tests run successfully
    Tool: interactive_bash
    Steps:
      1. bun test
    Expected: All tests pass (0 failures)
    Evidence: .sisyphus/evidence/task-5-bdd-run.{ext}

  Scenario: Given/When/Then helpers work
    Tool: interactive_bash
    Steps:
      1. bun test src/test/helpers.test.ts
    Expected: BDD helper tests pass
    Evidence: .sisyphus/evidence/task-5-bdd-helpers.{ext}
  ```

- [ ] 6. Store commands - create/list environments

  **What to do**:
  - `jolly store create --name <name>` - Create Saleor Cloud store
  - `jolly store list` - List your stores
  - `jolly store env create` - Create environment
  - Call Saleor Cloud API directly

  **QA Scenarios**:
  ```
  Scenario: store create command creates store (mocked)
    Tool: interactive_bash
    Steps:
      1. SALEOR_CLOUD_TOKEN=test ./dist/jolly.js store create --name test-store
    Expected: Store creation initiated or mock response
    Evidence: .sisyphus/evidence/task-6-store-create.{ext}

  Scenario: store list command lists stores
    Tool: interactive_bash
    Steps:
      1. SALEOR_CLOUD_TOKEN=test ./dist/jolly.js store list
    Expected: List output (may be empty)
    Evidence: .sisyphus/evidence/task-6-store-list.{ext}
  ```

- [ ] 7. App scaffold command - Dashboard extensions

  **What to do**:
  - `jolly app create --name <name> --type dashboard-extension`
  - Scaffold new Dashboard extension app
  - Register with Saleor Cloud

  **References**:
  - `https://github.com/saleor/saleor-app-sdk` - App SDK
  - Dashboard extension structure: src/pages/add/, useAppBridge()

  **QA Scenarios**:
  ```
  Scenario: app create scaffold dashboard-extension
    Tool: interactive_bash
    Steps:
      1. ./dist/jolly.js app create --name my-dashboard --type dashboard-extension
    Expected: Directory my-dashboard created with dashboard extension template
    Evidence: .sisyphus/evidence/task-7-dashboard-scaffold.{ext}

  Scenario: app create shows help for missing name
    Tool: interactive_bash
    Steps:
      1. ./dist/jolly.js app create --type dashboard-extension
    Expected: Error about missing required --name flag
    Evidence: .sisyphus/evidence/task-7-missing-name.{ext}
  ```

- [ ] 8. App scaffold command - Payment apps (hosted)

  **What to do**:
  - `jolly app create --name <name> --type payment`
  - Options: Dummy Payment App OR Stripe Payment App (hosted on saleor.io)
  - Register hosted payment app with Saleor Cloud

  **QA Scenarios**:
  ```
  Scenario: app create scaffold payment with default (dummy)
    Tool: interactive_bash
    Steps:
      1. ./dist/jolly.js app create --name my-payment --type payment
    Expected: Payment app registered with Dummy (default)
    Evidence: .sisyphus/evidence/task-8-payment-dummy.{ext}

  Scenario: app create scaffold payment with stripe
    Tool: interactive_bash
    Steps:
      1. ./dist/jolly.js app create --name my-payment --type payment --provider stripe
    Expected: Payment app registered with Stripe
    Evidence: .sisyphus/evidence/task-8-payment-stripe.{ext}
  ```

- [ ] 9. App scaffold command - Webhook handlers

  **What to do**:
  - `jolly app create --name <name> --type webhook`
  - Scaffold webhook handler app
  - Register with Saleor Cloud

  **QA Scenarios**:
  ```
  Scenario: app create scaffold webhook
    Tool: interactive_bash
    Steps:
      1. ./dist/jolly.js app create --name my-webhook --type webhook
    Expected: Directory my-webhook created with webhook handler template
    Evidence: .sisyphus/evidence/task-9-webhook-scaffold.{ext}

  Scenario: webhook app has correct structure
    Tool: interactive_bash
    Steps:
      1. ./dist/jolly.js app create --name test-webhook --type webhook
      2. ls test-webhook/src/webhooks/
    Expected: Webhook handler files present
    Evidence: .sisyphus/evidence/task-9-webhook-structure.{ext}
  ```

- [ ] 10. Agent setup - Skills installation (IDE-aware)

  **What to do**:
  - `jolly agent skills install`
  - Follow agentskills.io best practices for skill structure
  - Detect available agents: OpenCode, Claude Code, OpenClaw, Nanobot
  - Use agent-specific skill paths:
    - OpenCode: `.agents/skills/` (default)
    - Claude Code: `.claude/skills/` or `~/.claude/skills/`
    - OpenClaw: `.openclaw/skills/`
    - Nanobot: `.nanobot/skills/`
  - Install skills: saleor-app, saleor-configurator, saleor-core, saleor-storefront

  **References**:
  - `https://github.com/saleor/agent-skills`
  - `https://agentskills.io` - Agent Skills Specification
  - Skill format: SKILL.md + AGENTS.md + rules/ + references/

  **QA Scenarios**:
  ```
  Scenario: skills install creates correct directory structure
    Tool: interactive_bash
    Steps:
      1. ./dist/jolly.js agent skills install
    Expected: .agents/skills/ directory with saleor-* skills
    Evidence: .sisyphus/evidence/task-10-skills-structure.{ext}

  Scenario: skills have correct format (SKILL.md, AGENTS.md)
    Tool: interactive_bash
    Steps:
      1. ./dist/jolly.js agent skills install
      2. ls .agents/skills/saleor-app/
    Expected: SKILL.md and AGENTS.md files present
    Evidence: .sisyphus/evidence/task-10-skills-format.{ext}
  ```

- [ ] 11. Agent setup - AGENTS.md + IDE detection

  **What to do**:
  - `jolly agent setup` (combined command)
  - Detect IDEs/agents present: OpenCode, Claude Code, OpenClaw, Nanobot
  - Generate AGENTS.md with Saleor conventions (IDE-aware)
  - Include build/lint/test commands
  - Create appropriate skill directory structure for each agent

  **Supported Agents**:
  - OpenCode: `.agents/skills/`
  - Claude Code: `.claude/skills/` or `~/.claude/skills/`
  - OpenClaw: `.openclaw/skills/`
  - Nanobot: `.nanobot/skills/`

  **QA Scenarios**:
  ```
  Scenario: agent setup creates AGENTS.md
    Tool: interactive_bash
    Steps:
      1. ./dist/jolly.js agent setup
    Expected: AGENTS.md created in current directory
    Evidence: .sisyphus/evidence/task-11-agents-md.{ext}

  Scenario: AGENTS.md contains Saleor-specific commands
    Tool: interactive_bash
    Steps:
      1. ./dist/jolly.js agent setup
      2. grep -i "saleor" AGENTS.md
    Expected: Saleor commands and conventions present
    Evidence: .sisyphus/evidence/task-11-agents-content.{ext}
  ```

- [ ] 12. Agent setup - MCP configuration (IDE-aware)

  **What to do**:
  - Detect IDE and create appropriate MCP config:
    - OpenCode: `.mcp.json` in project root
    - Claude Code: `.mcp.json` in project root (compatible)
  - Configure saleor-mcp server
  - Point to https://mcp.saleor.app

  **References**:
  - `https://mcp.saleor.app`
  - MCP config format: { "mcpServers": { "saleor": { "command": "...", "url": "..." } } }

  **QA Scenarios**:
  ```
  Scenario: agent setup creates .mcp.json with saleor-mcp
    Tool: interactive_bash
    Steps:
      1. ./dist/jolly.js agent setup
    Expected: .mcp.json created with saleor-mcp server config
    Evidence: .sisyphus/evidence/task-12-mcp-config.{ext}

  Scenario: .mcp.json points to correct saleor-mcp URL
    Tool: interactive_bash
    Steps:
      1. ./dist/jolly.js agent setup
      2. cat .mcp.json | grep mcp.saleor.app
    Expected: URL https://mcp.saleor.app present
    Evidence: .sisyphus/evidence/task-12-mcp-url.{ext}
  ```

- [ ] 13. Integration tests

  **What to do**:
  - Test store creation flow (mocked API)
  - Test app scaffold flow
  - Test agent setup flow
  - Test error handling

  **QA Scenarios**:
  ```
  Scenario: Full integration test suite passes
    Tool: interactive_bash
    Steps:
      1. bun test
    Expected: All integration tests pass
    Evidence: .sisyphus/evidence/task-13-integration.{ext}

  Scenario: Error handling tests cover edge cases
    Tool: interactive_bash
    Steps:
      1. bun test src/test/error-handling.test.ts
    Expected: Error tests pass
    Evidence: .sisyphus/evidence/task-13-errors.{ext}
  ```

---

## Final Verification Wave

- [ ] F1. **Plan Compliance Audit** — `oracle`
- [ ] F2. **Code Quality Review** — `unspecified-high`
- [ ] F3. **Real Manual QA** — `unspecified-high`
- [ ] F4. **Scope Fidelity Check** — `deep`

---

## Commit Strategy

- **1**: `init: project scaffolding` — package.json (with bin entries), tsconfig, src/
- **2**: `feat: CLI structure` — OpenTUI + yargs setup
- **3**: `feat: Saleor API client` — Cloud API integration
- **4**: `feat: OpenTUI components` — Rich output components
- **5**: `feat: bootstrap command` — Store bootstrap command
- **6**: `feat: agent setup command` — Agent setup command
- **7**: `feat: app commands` — Dashboard/payment/webhook scaffold
- **8**: `test: BDD + integration` — Tests

---

## Success Criteria

### Verification Commands
```bash
# Build
bun run build

# Full CLI via npx
./dist/jolly.js --help

# npm create entry point (store bootstrap)
./dist/create-saleor-jolly.js --help

# npm init entry point (agent setup)
./dist/init-saleor-jolly.js --help

# Run tests
bun test
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] CLI produces working executable

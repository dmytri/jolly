# Jolly - Saleor CLI for AI Agents

Bootstraps Saleor projects and configures AI agents with Saleor skills.

## Installation

```bash
npm install -g @saleor/jolly
```

## Commands

### Store Management

```bash
# Create a new Saleor Cloud store
jolly store create --name my-store

# Create with specific region
jolly store create --name my-store --region eu-west-1

# List your stores
jolly store list

# Create environment
jolly store env create --store <store-id> --name production
```

### App Scaffolding

```bash
# Create a dashboard extension
jolly app create --name my-dashboard --type dashboard-extension

# Create a payment app (hosted)
jolly app create --name my-payment --type payment --provider stripe

# Create a webhook handler
jolly app create --name my-webhook --type webhook
```

### Agent Setup

```bash
# Setup AI agent with Saleor skills and MCP
jolly agent setup

# Install skills only
jolly agent skills install

# Setup in specific directory
jolly agent setup --path /my/project
```

### Configuration

```bash
# Deploy configuration to store
jolly config deploy --store <store-id>

# Introspect current configuration
jolly config introspect --store <store-id>
```

## npm Entry Points

```bash
# Bootstrap new Saleor project
npm create @saleor/jolly my-project

# Configure AI agent for Saleor
npm init @saleor/jolly
```

## Environment Variables

```bash
# Required for store and app commands
SALEOR_CLOUD_TOKEN=your-token-here
```

Get your token at: https://cloud.saleor.io/settings/api-tokens

## Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Run tests
bun test

# Type check
bun run typecheck
```

## Architecture

- **CLI Framework**: yargs for argument parsing
- **Runtime**: Bun
- **API Client**: Direct Saleor Cloud API integration
- **Agent Skills**: saleor/agent-skills from GitHub
- **MCP**: Official saleor-mcp at mcp.saleor.app

## License

MIT

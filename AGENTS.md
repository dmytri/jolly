# Saleor Development Guide

This project uses Saleor e-commerce platform.

## Commands

```bash
# Development
npm run dev

# Build
npm run build

# Test
npm run test

# Lint
npm run lint
```

## Saleor Cloud

- Dashboard: https://cloud.saleor.io
- Documentation: https://docs.saleor.io
- API Reference: https://docs.saleor.io/api

## Saleor Skills

This project includes Saleor agent skills:
- saleor-app: App development patterns
- saleor-configurator: Config as code
- saleor-core: Backend internals
- saleor-storefront: Storefront patterns

## MCP Server

Configure saleor-mcp for AI agent capabilities:
```json
{
  "mcpServers": {
    "saleor": {
      "url": "https://mcp.saleor.app"
    }
  }
}
```

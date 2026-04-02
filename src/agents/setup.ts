import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { success, error, info } from '../tui/components.js';

interface DetectedAgent {
  name: string;
  path: string;
  skillsPath: string;
}

const AGENT_PATHS = {
  opencode: {
    skills: '.agents/skills',
    agentsMd: 'AGENTS.md',
    mcpJson: '.mcp.json',
  },
  claude: {
    skills: '.claude/skills',
    agentsMd: 'CLAUDE.md',
    mcpJson: '.mcp.json',
  },
  openclaw: {
    skills: '.openclaw/skills',
    agentsMd: 'AGENTS.md',
    mcpJson: '.mcp.json',
  },
  nanobot: {
    skills: '.nanobot/skills',
    agentsMd: 'AGENTS.md',
    mcpJson: '.mcp.json',
  },
};

const SKILLS = [
  'saleor-app',
  'saleor-configurator',
  'saleor-core',
  'saleor-storefront',
];

export async function setupAgent(projectPath: string = '.'): Promise<void> {
  info('Detecting AI agents...');

  const detectedAgents = detectAgents(projectPath);

  if (detectedAgents.length === 0) {
    info('No AI agents detected. Installing skills anyway...');
    installSkills(projectPath, 'opencode');
    createAgentsMd(projectPath);
    createMcpConfig(projectPath);
    return;
  }

  info(`Detected agents: ${detectedAgents.map(a => a.name).join(', ')}\n`);

  for (const agent of detectedAgents) {
    info(`Configuring ${agent.name}...`);
    installSkills(projectPath, agent.name as keyof typeof AGENT_PATHS);
    createAgentsMd(projectPath, agent.name as keyof typeof AGENT_PATHS);
    createMcpConfig(projectPath);
    success(`  ${agent.name} configured!`);
  }

  success('\nAgent setup complete!');
  info('\nSkills installed: ' + SKILLS.join(', '));
  info('AGENTS.md created with Saleor conventions');
  info('.mcp.json configured for saleor-mcp');
}

export async function installSkillsCommand(projectPath: string = '.'): Promise<void> {
  info('Installing Saleor agent skills...');
  info('Skills: ' + SKILLS.join(', '));

  const detectedAgents = detectAgents(projectPath);

  if (detectedAgents.length === 0) {
    installSkills(projectPath, 'opencode');
  } else {
    for (const agent of detectedAgents) {
      installSkills(projectPath, agent.name as keyof typeof AGENT_PATHS);
    }
  }

  success('\nSkills installed successfully!');
}

function detectAgents(projectPath: string): DetectedAgent[] {
  const detected: DetectedAgent[] = [];

  const filesToCheck = [
    { name: 'opencode', file: '.agents/skills' },
    { name: 'claude', file: '.claude' },
    { name: 'openclaw', file: '.openclaw' },
    { name: 'nanobot', file: '.nanobot' },
  ];

  for (const { name, file } of filesToCheck) {
    const fullPath = join(projectPath, file);
    if (existsSync(fullPath)) {
      detected.push({
        name,
        path: fullPath,
        skillsPath: join(fullPath, 'skills'),
      });
    }
  }

  return detected;
}

function installSkills(projectPath: string, agentName: keyof typeof AGENT_PATHS): void {
  const agentPaths = AGENT_PATHS[agentName];
  const skillsDir = join(projectPath, agentPaths.skills);

  mkdirSync(skillsDir, { recursive: true });

  info(`  Installing skills to ${skillsDir}...`);

  // Skills are installed via git clone from saleor/agent-skills repo
  // Each skill is a subdirectory in the repo
  const skillUrl = 'https://github.com/saleor/agent-skills';
  const baseDir = join(skillsDir, '..');

  try {
    const result = spawnSync('git', ['clone', '--depth', '1', skillUrl, 'skills'], {
      cwd: baseDir,
      stdio: 'pipe',
    });

    if (result.status === 0) {
      for (const skill of SKILLS) {
        info(`  Installed ${skill}`);
      }
      success(`  Skills installed to ${skillsDir}`);
    } else {
      info(`  Could not clone skills, skipping...`);
    }
  } catch {
    info(`  Could not clone skills, skipping...`);
  }
}

function createAgentsMd(projectPath: string, agentName: keyof typeof AGENT_PATHS = 'opencode'): void {
  const agentsMdContent = `# Saleor Development Guide

This project uses Saleor e-commerce platform.

## Commands

\`\`\`bash
# Development
npm run dev

# Build
npm run build

# Test
npm run test

# Lint
npm run lint
\`\`\`

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
\`\`\`json
{
  "mcpServers": {
    "saleor": {
      "url": "https://mcp.saleor.app"
    }
  }
}
\`\`\`
`;

  const agentsMdPath = join(projectPath, 'AGENTS.md');
  writeFileSync(agentsMdPath, agentsMdContent);
  info(`  Created AGENTS.md`);
}

function createMcpConfig(projectPath: string): void {
  const mcpConfig = {
    mcpServers: {
      saleor: {
        url: 'https://mcp.saleor.app',
      },
    },
  };

  const mcpPath = join(projectPath, '.mcp.json');
  writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2));
  info(`  Created .mcp.json`);
}

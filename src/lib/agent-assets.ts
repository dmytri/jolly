// Jolly-managed local agent assets (features 007 and 009), shared by
// `jolly init` and `jolly skills install`.
//
// - The default Saleor skill set is installed into the standard project-local
//   `skills/` directory (one directory per skill, entry point SKILL.md — the
//   same convention Paper's embedded skills use), never into a Jolly-only
//   store such as `.jolly/skills`.
// - Installed versions are recorded in the standard lock/metadata file
//   `skills/skills-lock.json`; version management stays centralized in the
//   Jolly CLI (`jolly skills install` / `jolly skills update`).
// - Small agent-specific glue files point each supported agent environment
//   (Claude Code, Cursor, Zed, OpenCode, Pi.dev, and generic AGENTS.md
//   agents) at the installed skills. Glue references skills instead of
//   duplicating their content.
// - Files Jolly manages carry a marker comment. Existing files without the
//   marker are user-authored: they are never overwritten, only reported as
//   skipped.
// - Local-only and secret-free: nothing here touches Saleor Cloud or Vercel,
//   and no secret values are ever written into skills or guidance.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const SKILLS_DIR = "skills";
export const SKILLS_LOCK_FILE = "skills/skills-lock.json";
export const SKILLS_SOURCE = "saleor/agent-skills";
export const MANAGED_MARKER = "<!-- jolly:managed-glue v1 -->";

const SKILL_SET_VERSION = "0.1.0";

export type AssetStatus = "installed" | "updated" | "unchanged" | "skipped";

export interface SkillDisposition {
  name: string;
  version?: string;
  path: string;
  status: AssetStatus;
  detail?: string;
}

export interface GuidanceDisposition {
  agent: string;
  path: string;
  status: AssetStatus;
  detail?: string;
}

export interface AgentAssetSync {
  skillsDir: string;
  lockFile: string;
  source: string;
  skills: SkillDisposition[];
  guidance: GuidanceDisposition[];
}

// --- Default Saleor skill set (feature 003 research notes) -------------------

interface SkillSpec {
  name: string;
  description: string;
  body: string;
}

const DEFAULT_SKILLS: SkillSpec[] = [
  {
    name: "saleor-storefront",
    description:
      "Framework-agnostic Saleor Storefront API patterns: data model, permissions, GraphQL patterns, checkout lifecycle, channels, purchasability, and variants.",
    body: `Use this skill whenever you read from or write to the Saleor Storefront API.

## What it covers

- The Saleor data model as seen from a storefront: products, variants, and how
  attributes and channel listings shape what a customer can actually buy.
- Permissions: which queries and mutations the storefront token may perform,
  and which require an app token instead.
- GraphQL patterns: pagination, fragments for product and checkout data, and
  error handling conventions for Saleor's typed errors.
- The checkout lifecycle from \`checkoutCreate\` through delivery and payment
  steps to \`checkoutComplete\`, and where payment apps plug in.
- Channels: every storefront query is channel-scoped; always pass the channel
  slug explicitly rather than relying on defaults.
- Purchasability and variant selection: availability, stock, and pricing are
  resolved per channel and per variant, not per product.

## How to use it

Consult this skill before writing storefront GraphQL so queries match Saleor's
data model and permission boundaries on the first attempt.`,
  },
  {
    name: "saleor-configurator",
    description:
      "Saleor Configurator usage: config.yml structure, entity identity, CLI workflow, deployment pipeline, diff behavior, and sync debugging.",
    body: `Use this skill when inspecting, planning, or applying Saleor store
configuration as code with \`saleor/configurator\`.

## What it covers

- \`config.yml\` structure and how entities (channels, product types,
  attributes, categories, and more) are declared.
- Entity identity rules: how the Configurator matches local entities to remote
  ones, and why renames differ from replacements.
- The safe CLI workflow: validate, diff, plan, then deploy — never deploy a
  change you have not diffed.
- Diff behavior: how creations, updates, and deletions are reported, and the
  flags that block destructive or breaking changes.
- Sync debugging: interpreting exit codes and structured logs when local and
  remote configuration drift apart.

## How to use it

Prefer Configurator recipes over hand-written mutations for initial store
configuration, and parse the structured output instead of scraping prose.`,
  },
  {
    name: "storefront-builder",
    description:
      "Stepwise, framework-agnostic Saleor storefront playbook; explicitly stops between steps and asks for user confirmation.",
    body: `Use this skill when building or extending a Saleor storefront step by
step with the customer in the loop.

## What it covers

- A stepwise, framework-agnostic playbook for assembling a Saleor storefront:
  product listing, product detail, cart, checkout, and order confirmation.
- Explicit stop points: the playbook pauses between steps and asks for user
  confirmation before continuing, so the customer stays in control of scope.
- Verification habits: after each step, confirm the storefront still builds
  and the new surface renders against the live Saleor API.

## How to use it

Follow the steps in order, stop where the playbook stops, and let the
customer confirm direction before moving on. Combine with the
\`saleor-storefront\` skill for the underlying API patterns.`,
  },
  {
    name: "saleor-core",
    description:
      "Saleor backend internals such as discounts and stock availability; useful for advanced diagnostics and troubleshooting.",
    body: `Use this skill for advanced troubleshooting that depends on how the
Saleor backend actually computes things.

## What it covers

- Discounts: how sales, vouchers, and promotion rules combine, and why a
  displayed price may differ from a naive expectation.
- Stock and availability: how stock, allocations, and channel listings
  interact to decide whether a variant is purchasable.
- Other backend internals that explain surprising storefront behavior, which
  makes this skill useful for doctor-style diagnostics.

## How to use it

Reach for this skill when symptoms point below the Storefront API — for
example when prices, stock, or availability look wrong despite correct
storefront queries.`,
  },
  {
    name: "saleor-app",
    description:
      "Saleor app development: apps, webhooks, and Dashboard iframe apps. Situational — relevant only when creating or configuring Saleor apps.",
    body: `Use this skill only when the work involves creating or configuring
Saleor apps, webhooks, or Dashboard iframe apps.

## What it covers

- The Saleor app model: app installation, app tokens, and the permissions an
  app needs for its mutations.
- Webhooks: subscribing to Saleor events, verifying payloads, and the
  delivery/retry behavior to design around.
- Dashboard iframe apps: how an app embeds UI inside the Saleor Dashboard.

## How to use it

This skill is situational: it is not needed for the first storefront-only
path. Consult it when payment app setup, webhook handling, or any Saleor app
configuration enters the picture.`,
  },
];

// Paper's embedded skill is storefront-conditional: it ships inside the cloned
// Paper storefront rather than being installed by Jolly.
const PAPER_SKILL = "saleor-paper-storefront";

function renderSkill(spec: SkillSpec): string {
  return `---
name: ${spec.name}
description: ${spec.description}
source: ${SKILLS_SOURCE}
version: ${SKILL_SET_VERSION}
---

# ${spec.name}

${spec.body}
`;
}

function renderLockFile(): string {
  const skills: Record<string, { version: string; resolved: string; path: string }> = {};
  for (const spec of DEFAULT_SKILLS) {
    skills[spec.name] = {
      version: SKILL_SET_VERSION,
      resolved: `github:${SKILLS_SOURCE}#${spec.name}`,
      path: `${SKILLS_DIR}/${spec.name}/SKILL.md`,
    };
  }
  return `${JSON.stringify({ lockfileVersion: 1, source: SKILLS_SOURCE, skills }, null, 2)}\n`;
}

// --- Agent-specific glue (feature 009 supported environments) ----------------

interface GlueSpec {
  agent: string;
  path: string;
  render: () => string;
}

const GLUE_BODY = `# Jolly agent guidance

Saleor agent skills are installed project-locally in \`${SKILLS_DIR}/\` (one
directory per skill; read \`${SKILLS_DIR}/<skill-name>/SKILL.md\`). Installed
versions are recorded in \`${SKILLS_LOCK_FILE}\`.

Manage skills through the Jolly CLI (\`jolly skills install\`, \`jolly skills
update\`) so version management stays centralized; do not edit installed
skills by hand. When a cloned storefront exists, also use its embedded
\`${PAPER_SKILL}\` skill. Run \`jolly doctor\` for diagnostics.
`;

function markdownGlue(): string {
  return `${MANAGED_MARKER}\n${GLUE_BODY}`;
}

const GLUE_TARGETS: GlueSpec[] = [
  { agent: "generic", path: "AGENTS.md", render: markdownGlue },
  { agent: "claude-code", path: "CLAUDE.md", render: markdownGlue },
  {
    agent: "cursor",
    path: ".cursor/rules/jolly.mdc",
    render: () =>
      `---\ndescription: Jolly-managed pointer to the installed Saleor agent skills\nalwaysApply: true\n---\n${markdownGlue()}`,
  },
  { agent: "zed", path: ".rules", render: markdownGlue },
  { agent: "opencode", path: ".opencode/AGENTS.md", render: markdownGlue },
  { agent: "pi", path: ".pi/AGENTS.md", render: markdownGlue },
];

// --- Sync ---------------------------------------------------------------------

function syncManagedFile(
  cwd: string,
  relativePath: string,
  desired: string,
  write: boolean,
): AssetStatus {
  const path = join(cwd, relativePath);
  if (!existsSync(path)) {
    if (write) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, desired);
    }
    return "installed";
  }
  if (readFileSync(path, "utf8") === desired) return "unchanged";
  if (write) writeFileSync(path, desired);
  return "updated";
}

/**
 * Install or check the default Saleor skill set, the skills lock/metadata
 * file, and the agent-specific glue files. With `write: false` (dry run) the
 * same dispositions are computed without touching the filesystem.
 */
export function syncAgentAssets(cwd: string, options: { write: boolean }): AgentAssetSync {
  const { write } = options;

  const skills: SkillDisposition[] = DEFAULT_SKILLS.map((spec) => {
    const path = `${SKILLS_DIR}/${spec.name}/SKILL.md`;
    const status = syncManagedFile(cwd, path, renderSkill(spec), write);
    return {
      name: spec.name,
      version: SKILL_SET_VERSION,
      path,
      status,
      detail:
        status === "unchanged"
          ? `${spec.name} is already installed and up to date`
          : `${spec.name} ${status} at ${path}`,
    };
  });

  // Paper's embedded skill: included when a storefront exists, never
  // installed by Jolly itself.
  const storefrontDir = join(cwd, "storefront");
  const embeddedSkillPath = `storefront/${SKILLS_DIR}/${PAPER_SKILL}`;
  if (existsSync(join(cwd, embeddedSkillPath))) {
    skills.push({
      name: PAPER_SKILL,
      path: embeddedSkillPath,
      status: "unchanged",
      detail: `Paper's embedded ${PAPER_SKILL} skill is present in the cloned storefront (checked, managed by Paper)`,
    });
  } else {
    skills.push({
      name: PAPER_SKILL,
      path: embeddedSkillPath,
      status: "skipped",
      detail: existsSync(storefrontDir)
        ? `the cloned storefront does not embed the ${PAPER_SKILL} skill`
        : `no storefront exists yet; Paper's embedded ${PAPER_SKILL} skill becomes available after \`jolly create storefront\``,
    });
  }

  syncManagedFile(cwd, SKILLS_LOCK_FILE, renderLockFile(), write);

  const guidance: GuidanceDisposition[] = GLUE_TARGETS.map((target) => {
    const fullPath = join(cwd, target.path);
    if (existsSync(fullPath) && !readFileSync(fullPath, "utf8").includes(MANAGED_MARKER)) {
      // User-authored instructions detected: never overwritten without approval.
      return {
        agent: target.agent,
        path: target.path,
        status: "skipped" as const,
        detail: `${target.path} already exists with user-authored content; left untouched`,
      };
    }
    const status = syncManagedFile(cwd, target.path, target.render(), write);
    return {
      agent: target.agent,
      path: target.path,
      status,
      detail:
        status === "unchanged"
          ? `Jolly-managed guidance in ${target.path} is already up to date`
          : `Jolly-managed guidance ${status} at ${target.path}`,
    };
  });

  return {
    skillsDir: SKILLS_DIR,
    lockFile: SKILLS_LOCK_FILE,
    source: SKILLS_SOURCE,
    skills,
    guidance,
  };
}

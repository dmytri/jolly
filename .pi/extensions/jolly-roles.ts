/**
 * Jolly Roles Extension
 *
 * Registers /captain, /qm, and /crew slash commands that set the active
 * role for the session by injecting the role instructions from the
 * .claude/commands/*.md files into the system prompt.
 *
 * Implements the Three-Role Agent Workflow from AGENTS.md inside pi:
 * - /captain — product/technical discovery, writes feature files, no code
 * - /qm      — Quartermaster, writes tests, dispatches Crew Mates, no code
 * - /crew    — implementation agent, makes a specific failing test pass
 *
 * Installation:
 *   This file lives in .pi/extensions/ (project-local, git-tracked).
 *   Pi auto-discovers and loads it when the project is trusted.
 *   Run /reload in pi after adding or changing it.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// --- Types ---

interface RoleState {
  /** Short name: "captain" | "qm" | "crew" */
  name: string;
  /** Full role instructions (stripped frontmatter, $ARGUMENTS resolved) */
  instructions: string;
  /** Whether the role instructions have been injected for the current session */
  injected: boolean;
}

// --- Module-level state (per-extensions-instance) ---

let roleState: RoleState | null = null;

// --- Helpers ---

/** Resolve project paths from a cwd (typically ctx.cwd from a handler). */
function projectPaths(cwd: string) {
  return {
    commandsDir: path.join(cwd, ".claude", "commands"),
    agentsDir: path.join(cwd, ".claude", "agents"),
    agentsPath: path.join(cwd, "AGENTS.md"),
    handoverPath: path.join(cwd, "HANDOVER.md"),
  };
}

/** Read a markdown file, strip YAML frontmatter (--- ... ---), return body. */
function readCommandFile(filePath: string): string | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    // Strip YAML frontmatter delimited by --- lines
    const frontmatterMatch = /^---\n[\s\S]*?\n---\n*/;
    return raw.replace(frontmatterMatch, "").trim();
  } catch {
    return null;
  }
}

/** Build role instructions for a given role name, optional argument, and project cwd. */
function buildRoleInstructions(
  role: string,
  args: string,
  cwd: string,
): { name: string; instructions: string } | null {
  const { commandsDir, agentsDir, agentsPath, handoverPath } = projectPaths(cwd);
  const commandFile = path.join(commandsDir, `${role}.md`);

  // Read the command markdown (stripped of frontmatter)
  let instructions = readCommandFile(commandFile);
  if (!instructions) {
    return null;
  }

  // For /crew, also append the crew-mate agent definition for extra detail
  if (role === "crew") {
    const agentFile = path.join(agentsDir, "crew-mate.md");
    const agentContent = readCommandFile(agentFile);
    if (agentContent) {
      instructions += "\n\n## Crew Mate Agent Definition\n\n" + agentContent;
    }
  }

  // Build AGENTS.md context
  let agentsSection = "";
  if (fs.existsSync(agentsPath)) {
    const roleSectionMap: Record<string, string[]> = {
      captain: [
        "Three-Role Agent Workflow → Captain",
        "Product Vision",
        "V1 Scope and Boundaries",
        "Spec-Driven Development Philosophy",
      ],
      qm: [
        "Three-Role Agent Workflow → Quartermaster",
        "Testing Strategy",
        "CLI Output Contract",
        "Agent Risk Context",
        "Idempotency and Resumability",
      ],
      crew: [
        "Three-Role Agent Workflow → Crew Mates",
        "Testing Strategy",
        "Secret and Environment Handling",
      ],
    };

    const sections = roleSectionMap[role] ?? [];
    agentsSection =
      `\n\n## Repository Charter (AGENTS.md)\n\nThe authoritative project charter is AGENTS.md. Read it for the full product vision, V1 scope, pinned contracts (output envelope, risk context, idempotency), and complete role definitions. Key sections for this role:\n\n` +
      sections.map((s) => `- ${s}`).join("\n") +
      `\n\nRead AGENTS.md using the read tool before starting work.\n`;
  }

  // HANDOVER.md for QM
  let handoverSection = "";
  if (role === "qm" && fs.existsSync(handoverPath)) {
    handoverSection = "\n\n## Handover (current state)\n\n" + fs.readFileSync(handoverPath, "utf8");
  }

  // Merge everything
  let finalInstructions = instructions + agentsSection + handoverSection;

  // Resolve $ARGUMENTS placeholder
  if (args.trim()) {
    finalInstructions = finalInstructions.replace(/\$ARGUMENTS/g, args.trim());
  } else {
    finalInstructions = finalInstructions.replace(/\$ARGUMENTS/g, "");
  }

  return { name: role, instructions: finalInstructions };
}

// --- Extension ---

export default function jollyRolesExtension(pi: ExtensionAPI) {
  // --- Register /captain ---

  pi.registerCommand("captain", {
    description:
      "Start a Captain (discovery) session — collaborate with the customer, write feature files, never production code",
    handler: async (args, ctx) => {
      const role = buildRoleInstructions("captain", args, ctx.cwd);
      if (!role) {
        ctx.ui.notify(
          "Captain command file not found at .claude/commands/captain.md. Is the project set up?",
          "error",
        );
        return;
      }

      roleState = { ...role, injected: false };
      ctx.ui.setStatus("jolly-role", "🧭 Captain");
      ctx.ui.notify("🧭 Captain role activated. You are the discovery agent — write feature files, not code.", "info");

      const focus = args.trim()
        ? `Read AGENTS.md and the relevant .feature files, then collaborate with the customer on: ${args.trim()}`
        : "Read AGENTS.md for your charter, review existing .feature files, and start discovery with the customer.";
      pi.sendUserMessage(`Captain session started.\n\n${focus}`);
    },
  });

  // --- Register /qm ---

  pi.registerCommand("qm", {
    description:
      "Start a Quartermaster session — write tests and step definitions, dispatch Crew Mates, never production code",
    handler: async (args, ctx) => {
      const role = buildRoleInstructions("qm", args, ctx.cwd);
      if (!role) {
        ctx.ui.notify(
          "QM command file not found at .claude/commands/qm.md. Is the project set up?",
          "error",
        );
        return;
      }

      roleState = { ...role, injected: false };
      ctx.ui.setStatus("jolly-role", "⚙️ Quartermaster");
      ctx.ui.notify(
        "⚙️ Quartermaster role activated. Derive worklist from test status — write tests, dispatch Crew Mates, no production code.",
        "info",
      );

      const focus = args.trim()
        ? `Narrow focus: ${args.trim()}\n\nRead AGENTS.md and HANDOVER.md. Run \`bunx cucumber-js --dry-run\` first to see the worklist.`
        : "Read AGENTS.md and HANDOVER.md. Run `bunx cucumber-js --dry-run` to see the worklist, then write step definitions for any undefined scenarios, and dispatch Crew Mates for failing ones.";
      pi.sendUserMessage(`Quartermaster session started.\n\n${focus}`);
    },
  });

  // --- Register /crew ---

  pi.registerCommand("crew", {
    description:
      "Run a single Crew Mate against a named scenario — implementation only, no spec changes, no conversation",
    getArgumentCompletions: (_prefix) => null,
    handler: async (args, ctx) => {
      if (!args.trim()) {
        ctx.ui.notify(
          "Usage: /crew <feature or scenario to implement>\n\nExample: /crew 020-cli-output-contract.feature: The envelope includes a checks array",
          "error",
        );
        return;
      }

      const role = buildRoleInstructions("crew", args, ctx.cwd);
      if (!role) {
        ctx.ui.notify(
          "Crew Mate command file not found at .claude/commands/crew.md or .claude/agents/crew-mate.md. Is the project set up?",
          "error",
        );
        return;
      }

      roleState = { ...role, injected: false };
      ctx.ui.setStatus("jolly-role", "🔧 Crew Mate");
      ctx.ui.notify(
        `🔧 Crew Mate role activated. Target: ${args.trim()}\nMake the failing tests pass — minimal production code, strictly per the committed specs.`,
        "info",
      );

      pi.sendUserMessage(
        `Crew Mate session started.\n\nTarget: ${args.trim()}\n\nRead the relevant .feature files, their step definitions, and AGENTS.md. Then implement the minimal production code to make the specified scenario pass. Run \`bun test\`, \`bunx cucumber-js\`, and \`bunx tsc --noEmit\` to confirm.`,
      );
    },
  });

  // --- /clearrole command to exit current role ---

  pi.registerCommand("clearrole", {
    description: "Exit the current Jolly role and return to normal mode",
    handler: async (_args, ctx) => {
      const previousRole = roleState?.name;
      roleState = null;
      ctx.ui.setStatus("jolly-role", undefined);
      ctx.ui.notify(
        previousRole ? `Cleared ${previousRole} role. Back to normal mode.` : "No role was active.",
        "info",
      );
    },
  });

  // --- Inject role instructions into system prompt on the first turn ---

  pi.on("before_agent_start", async (event) => {
    if (!roleState || roleState.injected) return;

    roleState.injected = true;

    return {
      systemPrompt:
        `# Active Role: ${roleState.name.toUpperCase()}\n\n` +
        `You are currently operating in the "${roleState.name}" role, as defined by the Jolly project's three-role workflow.\n\n` +
        `Role instructions:\n\n${roleState.instructions}\n\n---\n\n` +
        event.systemPrompt,
    };
  });

  // --- Clean up role on session shutdown ---

  pi.on("session_shutdown", async () => {
    roleState = null;
  });
}

// Verification support for the two custody-hook scenarios in feature
// methodology-conformance (@logic @invariant): the Shipshape Bash custody hook
// denies an internal-role search that reaches the Captain-only notes, and
// permits a search the ignore artifact already covers.
//
// The hook is the real PreToolUse Bash guard the Shipshape plugin configures
// for this project (hooks/hooks.json, matcher "Bash",
// hooks/scripts/bash-custody.sh). These steps resolve that exact configured
// script, feed it a real payload on stdin naming the running agent
// (`agent_type`) and the command, and observe its verdict: exit 2 with a
// recovery message on stderr is a deny, exit 0 is a permit. Nothing is mocked;
// the guard's own logic renders the verdict.
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { JollyWorld } from "../support/world.ts";

/**
 * Resolve the Bash custody-hook script the Shipshape plugin configures for this
 * project. The plugin declares it in hooks/hooks.json under the PreToolUse
 * "Bash" matcher as `${CLAUDE_PLUGIN_ROOT}/hooks/scripts/bash-custody.sh`; the
 * plugin root is the enabled-plugin marketplace clone. Read the declaration and
 * resolve the placeholder against that root, so the test drives the exact
 * script the runtime runs, not a copy.
 */
function resolveCustodyHook(): string {
  const pluginRoot =
    process.env.CLAUDE_PLUGIN_ROOT ??
    join(homedir(), ".claude", "plugins", "marketplaces", "dmytri-shipshape");
  const hooksJson = join(pluginRoot, "hooks", "hooks.json");
  assert.ok(
    existsSync(hooksJson),
    `the Shipshape plugin hooks declaration must exist at ${hooksJson}; the custody hook is not configured for this project`,
  );
  const declaration = JSON.parse(readFileSync(hooksJson, "utf8")) as {
    hooks?: { PreToolUse?: Array<{ matcher?: string; hooks?: Array<{ command?: string }> }> };
  };
  const bashEntry = (declaration.hooks?.PreToolUse ?? []).find(
    (entry) => entry.matcher === "Bash",
  );
  const command = bashEntry?.hooks?.[0]?.command;
  assert.ok(
    command,
    `${hooksJson} declares no PreToolUse "Bash" hook, so no custody hook guards Bash for this project`,
  );
  const script = command
    .replaceAll("${CLAUDE_PLUGIN_ROOT}", pluginRoot)
    .replaceAll('"', "")
    .trim();
  assert.ok(
    existsSync(script),
    `the configured custody-hook script must exist at ${script}`,
  );
  return script;
}

/** Run the custody hook with a PreToolUse payload; return its exit code and stderr. */
function runCustodyHook(
  script: string,
  agentType: string,
  command: string,
): { code: number | null; stderr: string } {
  const payload = JSON.stringify({
    tool_name: "Bash",
    tool_input: { command },
    agent_type: agentType,
  });
  const result = spawnSync("/bin/sh", [script], {
    input: payload,
    encoding: "utf8",
    timeout: 20_000,
  });
  if (result.error) {
    throw new Error(`failed to run the custody hook at ${script}: ${result.error.message}`);
  }
  return { code: result.status, stderr: result.stderr ?? "" };
}

Given(
  "the Shipshape Bash custody hook configured for this project",
  function (this: JollyWorld) {
    this.notes.custodyHookScript = resolveCustodyHook();
  },
);

When(
  "it receives a {string} payload whose command is {string}",
  function (this: JollyWorld, agentType: string, command: string) {
    const script = this.notes.custodyHookScript as string;
    this.notes.custodyVerdict = runCustodyHook(script, agentType, command);
    this.notes.custodyCommand = command;
  },
);

Then("it should deny the command", function (this: JollyWorld) {
  const verdict = this.notes.custodyVerdict as { code: number | null; stderr: string };
  assert.equal(
    verdict.code,
    2,
    `the hook should deny "${this.notes.custodyCommand}" (exit 2); got exit ${verdict.code}, stderr:\n${verdict.stderr}`,
  );
});

Then(
  "it should name a safe search form in its recovery message",
  function (this: JollyWorld) {
    const verdict = this.notes.custodyVerdict as { code: number | null; stderr: string };
    assert.match(
      verdict.stderr,
      /`rg [^`]+`/,
      `the deny message should name a safe search form such as \`rg <pattern>\`; got:\n${verdict.stderr}`,
    );
  },
);

Then("it should permit the command", function (this: JollyWorld) {
  const verdict = this.notes.custodyVerdict as { code: number | null; stderr: string };
  assert.equal(
    verdict.code,
    0,
    `the hook should permit "${this.notes.custodyCommand}" (exit 0); got exit ${verdict.code}, stderr:\n${verdict.stderr}`,
  );
});

// Shell completion for the jolly CLI, served by Bombshell (@bomb.sh/tab) as the
// single completion-script generator (feature 027). `jolly completion <shell>`
// prints the script the user sources; at completion time the shell invokes
// `jolly complete -- <words>` to receive candidate completions for the command
// surface. `completion`/`complete` are the one pair exempt from the feature 020
// `--json` envelope: their stdout is a shell script / candidate list consumed by
// the shell, never a JSON envelope.
import t from "@bomb.sh/tab";

// The top-level command surface offered for completion (feature 006).
/**
 * @planks("Then the error should name the supported commands login, logout, auth status, init, start, doctor, upgrade, skills, create, and completion")
 */
const COMMANDS: ReadonlyArray<readonly [string, string]> = [
  ["login", "Authenticate to Saleor Cloud"],
  ["logout", "Remove the stored Saleor Cloud token"],
  ["auth", "Inspect authentication status"],
  ["init", "Set up the local project (skills, .mcp.json, AGENTS.md)"],
  ["start", "Run the guided end-to-end setup"],
  ["doctor", "Diagnose the project setup"],
  ["upgrade", "Upgrade Jolly and the installed skills"],
  ["skills", "Install the Jolly and Saleor agent-skills"],
  ["create", "Create a store"],
  ["completion", "Print a shell completion script"],
];

let registered = false;
/**
 * @planks("When the agent runs `jolly completion bash`")
 * @planks("When the agent runs `jolly complete -- lo`")
 */
function register(): void {
  if (registered) return;
  for (const [name, description] of COMMANDS) t.command(name, description);
  registered = true;
}

/**
 * Handle `jolly completion <shell>` (prints the completion script) and
 * `jolly complete -- <words>` (prints candidate completions). Returns the
 * process exit code.
 * @planks("When the agent runs `jolly completion bash`")
 * @planks("Then stdout should contain a shell completion script for the `jolly` command")
 * @planks("Then the script should reference the supported commands login, logout, init, start, doctor, upgrade, skills, and create")
 * @planks("When the agent runs `jolly complete -- lo`")
 * @planks("Then stdout should list the candidate completions `login` and `logout`")
 * @planks("Then the error should name the supported commands login, logout, auth status, init, start, doctor, upgrade, skills, create, and completion")
 */
export function runCompletion(argv: string[]): number {
  register();
  const [command, ...rest] = argv;

  if (command === "completion") {
    if (rest.length === 0 || rest[0] === "--help" || rest[0] === "-h") {
      process.stdout.write(
        "Usage: jolly completion <bash|zsh|fish|powershell> [--help]\n" +
          "Prints a shell completion script for the `jolly` command to source.\n",
      );
      return 0;
    }
    // @bomb.sh/tab generates the shell-specific completion script; it delegates
    // back to `jolly complete -- <words>` at completion time.
    t.setup("jolly", "jolly", rest[0]);
    return 0;
  }

  // `complete -- <words>`: everything after `--` is the words being completed.
  const sep = rest.indexOf("--");
  const words = sep >= 0 ? rest.slice(sep + 1) : rest;
  t.parse(words);
  return 0;
}

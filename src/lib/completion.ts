// Shell completion for the jolly CLI, served by Bombshell (@bomb.sh/tab) as the
// single completion-script generator (feature 027). `jolly completion <shell>`
// prints the script the user sources; at completion time the shell invokes
// `jolly complete -- <words>` to receive candidate completions for the command
// surface. `completion`/`complete` are the one pair exempt from the feature 020
// `--json` envelope: their stdout is a shell script / candidate list consumed by
// the shell, never a JSON envelope.
import t from "@bomb.sh/tab";
import { cliMessage } from "./messages.ts";

// The top-level command surface offered for completion: every top-level command
// a user may invoke, the feature 029 stage commands included (feature
// command-surface-consistency).
/**
 * @planks("the script should reference the supported commands help, login, logout, auth, init, start, create, storefront, recipe, stock, stripe, deploy, doctor, upgrade, skills, and completion")
 * @planks("the completion command descriptions and the `jolly completion --help` usage text are joined against the catalog entries")
 */
const COMMANDS: ReadonlyArray<readonly [string, string]> = [
  ["help", cliMessage("completion.command.help")],
  ["login", cliMessage("completion.command.login")],
  ["logout", cliMessage("completion.command.logout")],
  ["auth", cliMessage("completion.command.auth")],
  ["init", cliMessage("completion.command.init")],
  ["start", cliMessage("completion.command.start")],
  ["create", cliMessage("completion.command.create")],
  ["storefront", cliMessage("completion.command.storefront")],
  ["recipe", cliMessage("completion.command.recipe")],
  ["stock", cliMessage("completion.command.stock")],
  ["stripe", cliMessage("completion.command.stripe")],
  ["deploy", cliMessage("completion.command.deploy")],
  ["doctor", cliMessage("completion.command.doctor")],
  ["upgrade", cliMessage("completion.command.upgrade")],
  ["skills", cliMessage("completion.command.skills")],
  ["completion", cliMessage("completion.command.completion")],
];

let registered = false;
/**
 * @planks("the agent runs `jolly completion bash`")
 * @planks("the agent runs `jolly complete -- lo`")
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
 * @planks("the agent runs `jolly completion bash`")
 * @planks("stdout should contain a shell completion script for the `jolly` command")
 * @planks("the script should reference the supported commands help, login, logout, auth, init, start, create, storefront, recipe, stock, stripe, deploy, doctor, upgrade, skills, and completion")
 * @planks("the agent runs `jolly complete -- lo`")
 * @planks("stdout should list the candidate completions `login` and `logout`")
 * @planks("the completion command descriptions and the `jolly completion --help` usage text are joined against the catalog entries")
 */
export function runCompletion(argv: string[]): number {
  register();
  const [command, ...rest] = argv;

  if (command === "completion") {
    if (rest.length === 0 || rest[0] === "--help" || rest[0] === "-h") {
      process.stdout.write(cliMessage("completion.usage"));
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

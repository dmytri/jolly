// Real-PTY test support: run the Jolly CLI with a genuine controlling terminal
// on stdin so the interactive token-paste login path (feature 018) can be
// exercised for real. Node lacks openpty and the harness does not ship node-pty,
// so the PTY is allocated by an out-of-process Python driver (pty-driver.py).
// The kernel PTY is real, not a mock: the CLI sees `process.stdin.isTTY` true,
// prints its prompt, disables echo, and reads the pasted line from the tty.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "pty-driver.py");

export interface PtyRunResult {
  exitCode: number;
  /** Everything written to the terminal (prompt + output), verbatim. */
  output: string;
  /**
   * Only in `separateStreams` mode: the child's stdout and stderr captured on
   * distinct PTYs, so the feature 020 progress contract (progress on stderr, a
   * clean stdout) is observable. `output` is their concatenation.
   */
  stdout?: string;
  stderr?: string;
}

export interface PtyRunOptions {
  runtime: string;
  /** Args after the runtime: the CLI entry path plus flags. */
  argv: string[];
  cwd: string;
  /** Full, resolved child environment (no undefined values). */
  env: Record<string, string>;
  /** The token "pasted" at the prompt; a trailing newline is added. */
  input?: string;
  /**
   * A scripted input sequence sent verbatim, one chunk per prompt with a delay
   * between each (the interactive `jolly start` walk-through). Each chunk is
   * written exactly as given — e.g. `"\r"` presses Enter, `"n"` declines a
   * confirm. Mutually exclusive with `input`.
   */
  inputs?: string[];
  inputDelayMs?: number;
  /**
   * Prompt-aware feeding: one marker substring per `inputs` chunk. Each chunk is
   * sent only AFTER its marker appears in the captured output, so a genuinely
   * completing interactive run — whose prompts arrive after network gaps of
   * unknown length — is driven reliably instead of on a fixed (and easily
   * mistimed) cadence. A null/empty marker falls back to the `inputDelayMs`
   * cadence for that chunk.
   */
  waitFor?: Array<string | null>;
  /** Settle delay after a marker is seen before sending its chunk (default 250ms). */
  settleMs?: number;
  /** Per-chunk cap waiting for a marker before sending anyway (default 180000ms). */
  perChunkTimeoutMs?: number;
  timeoutMs?: number;
  /**
   * Allocate distinct PTYs for stdin, stdout, and stderr so stdout and stderr
   * are captured SEPARATELY (each still a genuine terminal, `isTTY` true). The
   * default merged mode cannot tell the two streams apart; the feature 020
   * progress contract needs them distinguished.
   */
  separateStreams?: boolean;
}

/** True when python3 with the `pty` module is available to allocate a PTY. */
export function ptyAvailable(): boolean {
  const probe = spawnSync("python3", ["-c", "import pty"], { encoding: "utf8" });
  return probe.status === 0;
}

/** Run a command under a real PTY, pasting `input` at the prompt. */
export function runUnderPty(options: PtyRunOptions): PtyRunResult {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const cfgDir = mkdtempSync(join(tmpdir(), "jolly-pty-"));
  const cfgPath = join(cfgDir, "config.json");
  writeFileSync(cfgPath, JSON.stringify({ inputDelayMs: 300, timeoutMs, ...options }));
  try {
    const result = spawnSync("python3", [DRIVER, cfgPath], {
      encoding: "utf8",
      timeout: timeoutMs + 5_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error) {
      throw new Error(`PTY driver failed: ${result.error.message}`);
    }
    if (options.separateStreams) {
      let parsed: { out?: string; err?: string; code?: number };
      try {
        parsed = JSON.parse(result.stdout ?? "");
      } catch {
        throw new Error(
          `PTY driver returned no JSON in separate-streams mode:\n${result.stdout}\n${result.stderr}`,
        );
      }
      const stdout = Buffer.from(parsed.out ?? "", "base64").toString("utf8");
      const stderr = Buffer.from(parsed.err ?? "", "base64").toString("utf8");
      return { exitCode: parsed.code ?? -1, output: stdout + stderr, stdout, stderr };
    }
    return {
      exitCode: result.status ?? -1,
      output: (result.stdout ?? "") + (result.stderr ?? ""),
    };
  } finally {
    rmSync(cfgDir, { recursive: true, force: true });
  }
}

// Custom Cucumber World carrying a per-run namespace and cleanup registry so
// every scenario isolates and tears down the real resources it creates.
// See features/023-test-architecture.feature.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setWorldConstructor, World, type IWorldOptions } from "@cucumber/cucumber";
import { CleanupRegistry, runNamespace } from "./sandbox.ts";
import { runJolly, type RunResult, type RunOptions } from "./cli.ts";

export class JollyWorld extends World {
  readonly namespace: string;
  readonly cleanup = new CleanupRegistry();

  /** Result of the most recent CLI invocation in this scenario. */
  lastRun?: RunResult;
  /** Result of the invocation before lastRun (for compare-two-runs steps). */
  previousRun?: RunResult;
  /** Scratch values steps share within one scenario (never across scenarios). */
  readonly vars = new Map<string, unknown>();

  private _projectDir?: string;

  constructor(options: IWorldOptions) {
    super(options);
    this.namespace = runNamespace();
  }

  /**
   * A fresh throwaway project directory for this scenario; the CLI under test
   * runs here so it can never touch the Jolly repository itself.
   */
  get projectDir(): string {
    if (!this._projectDir) {
      const dir = mkdtempSync(join(tmpdir(), `${this.namespace}-`));
      this._projectDir = dir;
      this.cleanup.register(`temp project dir ${dir}`, async () => {
        rmSync(dir, { recursive: true, force: true });
      });
    }
    return this._projectDir;
  }

  /** Run the Jolly CLI in this scenario's project dir, recording the result. */
  async jolly(args: string[], opts: Partial<RunOptions> = {}): Promise<RunResult> {
    const result = await runJolly(args, { cwd: this.projectDir, ...opts });
    this.previousRun = this.lastRun;
    this.lastRun = result;
    return result;
  }
}

setWorldConstructor(JollyWorld);

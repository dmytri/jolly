// Custom Cucumber World carrying a per-run namespace and cleanup registry so
// every scenario isolates and tears down the real resources it creates.
// See features/023-test-architecture.feature.
import { setWorldConstructor, World, type IWorldOptions } from "@cucumber/cucumber";
import { CleanupRegistry, runNamespace } from "./sandbox.ts";

export class JollyWorld extends World {
  readonly namespace: string;
  readonly cleanup = new CleanupRegistry();

  constructor(options: IWorldOptions) {
    super(options);
    this.namespace = runNamespace();
  }
}

setWorldConstructor(JollyWorld);

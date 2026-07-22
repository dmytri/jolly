// The one ts-morph Project the verification layer's structural checkers share.
//
// Every structural conformance checker in features/support parses the SAME
// tree against the SAME tsconfig. Each one used to build and cache its own
// `Project`, and cucumber loads every support module into every worker, so a
// tier run held fifteen independent full TypeScript ASTs and type checkers of
// one tree in one worker heap. That is a duplicated parse, not isolation: the
// checkers only READ the project, so a second copy buys no separation and
// costs a whole program's worth of heap.
//
// It is also load-bearing rather than tidiness. The @logic tier terminated
// with ERR_WORKER_OUT_OF_MEMORY partway through its enumeration sweep, at a
// measured 2.4 GB peak RSS against the worker thread's ~2 GB heap ceiling, so
// the sweep never enumerated the tier and its red list was silently partial.
// Sharing the parse once per worker is the fix for that, per the Verification
// agreement's reuse rule: state no scenario asserts is setup cost, provisioned
// once and shared.
//
// Sharing stays safe because the checkers read. A checker that must add source
// files (composition-lane-conformance's injected-source pass) removes exactly
// what it added in a `finally`, so the shared project returns to the tree's
// own shape.
import { Project } from "ts-morph";
import { join } from "node:path";
import { REPO_ROOT } from "./repo-root.ts";

let cachedProject: Project | undefined;

/** The shared, lazily-built ts-morph project over this repository's tsconfig. */
export function sharedProject(): Project {
  cachedProject ??= new Project({
    tsConfigFilePath: join(REPO_ROOT, "tsconfig.json"),
  });
  return cachedProject;
}

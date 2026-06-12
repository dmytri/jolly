// Logic-tier units for the sandbox harness machinery (feature 023):
// credential gating on runtime JOLLY_* variables, the per-run namespace,
// and the LIFO, idempotent, best-effort cleanup registry.
import { describe, expect, test } from "bun:test";
import {
  ALL_CREDENTIAL_GROUPS,
  classifyCredentials,
  CREDENTIAL_GROUPS,
  CleanupRegistry,
  DERIVABLE_GROUPS,
  makeNamespace,
  missingCredentials,
  requiredGroups,
  runId,
  SANDBOX_REQUIREMENTS,
} from "../features/support/sandbox.ts";
import { leftoverTestEnvironments } from "../features/support/cloud.ts";

describe("credential gating", () => {
  test("reports the exact runtime variable names that are absent", () => {
    const env = { JOLLY_SALEOR_APP_TOKEN: "set" };
    expect(missingCredentials(["saleorEndpoint", "saleorAppToken"], env)).toEqual([
      "NEXT_PUBLIC_SALEOR_API_URL",
    ]);
  });

  test("treats blank values as absent", () => {
    const env = { JOLLY_VERCEL_TOKEN: "   " };
    expect(missingCredentials(["vercel"], env)).toEqual(["JOLLY_VERCEL_TOKEN"]);
  });

  test("returns nothing when every required variable is present", () => {
    const env = {
      JOLLY_STRIPE_PUBLISHABLE_KEY: "pk_test_x",
      JOLLY_STRIPE_SECRET_KEY: "sk_test_x",
    };
    expect(missingCredentials(["stripe"], env)).toEqual([]);
  });

  test("deduplicates variables shared across groups", () => {
    const missing = missingCredentials(ALL_CREDENTIAL_GROUPS, {});
    expect(new Set(missing).size).toBe(missing.length);
  });

  test("uses only runtime variable names — no JOLLY_TEST_* namespace", () => {
    for (const names of Object.values(CREDENTIAL_GROUPS)) {
      for (const name of names) {
        expect(name).not.toMatch(/^JOLLY_TEST_/);
        expect(name).not.toMatch(/^HARNESS_/);
      }
    }
  });

  test("unmapped @sandbox scenarios conservatively require every group", () => {
    expect(requiredGroups("some future scenario")).toEqual(ALL_CREDENTIAL_GROUPS);
  });

  test("every mapped requirement names known groups", () => {
    for (const groups of Object.values(SANDBOX_REQUIREMENTS)) {
      for (const group of groups) {
        expect(Object.keys(CREDENTIAL_GROUPS)).toContain(group);
      }
    }
  });
});

describe("credential derivation (feature 023 self-provisioned endpoints)", () => {
  test("endpoint and app token are derivable when the Cloud token is present", () => {
    const env = { JOLLY_SALEOR_CLOUD_TOKEN: "token" };
    const gate = classifyCredentials(["saleorEndpoint", "saleorAppToken"], env);
    expect(gate.missing).toEqual([]);
    expect(gate.derivable.sort()).toEqual([
      "JOLLY_SALEOR_APP_TOKEN",
      "NEXT_PUBLIC_SALEOR_API_URL",
    ]);
  });

  test("without the Cloud token nothing is derivable — plain skip", () => {
    const gate = classifyCredentials(["saleorEndpoint", "saleorAppToken"], {});
    expect(gate.derivable).toEqual([]);
    expect(gate.missing.sort()).toEqual([
      "JOLLY_SALEOR_APP_TOKEN",
      "NEXT_PUBLIC_SALEOR_API_URL",
    ]);
  });

  test("Vercel and Stripe credentials are never derivable", () => {
    const env = { JOLLY_SALEOR_CLOUD_TOKEN: "token" };
    const gate = classifyCredentials(["vercel", "stripe"], env);
    expect(gate.derivable).toEqual([]);
    expect(gate.missing.sort()).toEqual([
      "JOLLY_STRIPE_PUBLISHABLE_KEY",
      "JOLLY_STRIPE_SECRET_KEY",
      "JOLLY_VERCEL_TOKEN",
    ]);
  });

  test("configured values are neither missing nor derivable", () => {
    const env = {
      JOLLY_SALEOR_CLOUD_TOKEN: "token",
      NEXT_PUBLIC_SALEOR_API_URL: "https://shop.saleor.cloud/graphql/",
      JOLLY_SALEOR_APP_TOKEN: "app",
    };
    const gate = classifyCredentials(
      ["saleorEndpoint", "saleorAppToken", "saleorCloud"],
      env,
    );
    expect(gate.missing).toEqual([]);
    expect(gate.derivable).toEqual([]);
  });

  test("only the Saleor endpoint and app-token groups are derivable", () => {
    expect([...DERIVABLE_GROUPS].sort()).toEqual([
      "saleorAppToken",
      "saleorEndpoint",
    ]);
  });
});

describe("leftover jolly-test environment detection (feature 012)", () => {
  const ns = "jolly-test-current";
  test("flags jolly-test environments from other runs only", () => {
    const leftovers = leftoverTestEnvironments(
      [
        { org: "o", key: "1", name: "jolly-test-old-run-shared" },
        { org: "o", key: "2", name: `${ns}-shared` },
        { org: "o", key: "3", name: "customer-production" },
        { org: "o", key: "4", name: "jolly-env-abc" },
      ],
      ns,
    );
    expect(leftovers.map((env) => env.key)).toEqual(["1"]);
  });

  test("reports nothing when only this run's environments exist", () => {
    expect(
      leftoverTestEnvironments([{ org: "o", key: "1", name: `${ns}-1` }], ns),
    ).toEqual([]);
  });
});

describe("per-run namespace", () => {
  test("namespace embeds the run id and is jolly-test prefixed", () => {
    expect(makeNamespace("abc123")).toBe("jolly-test-abc123");
  });

  test("run id is stable within a process", () => {
    expect(runId()).toBe(runId());
  });

  test("HARNESS_RUN_ID overrides the generated id", () => {
    const previous = process.env.HARNESS_RUN_ID;
    process.env.HARNESS_RUN_ID = "pinned-run";
    try {
      expect(runId()).toBe("pinned-run");
      expect(makeNamespace(runId())).toBe("jolly-test-pinned-run");
    } finally {
      if (previous === undefined) delete process.env.HARNESS_RUN_ID;
      else process.env.HARNESS_RUN_ID = previous;
    }
  });
});

describe("cleanup registry", () => {
  test("runs registered cleanups in LIFO order", async () => {
    const registry = new CleanupRegistry();
    const order: string[] = [];
    registry.register("first", () => void order.push("first"));
    registry.register("second", () => void order.push("second"));
    registry.register("third", () => void order.push("third"));
    const failures = await registry.runAll();
    expect(failures).toEqual([]);
    expect(order).toEqual(["third", "second", "first"]);
  });

  test("is best-effort: failures are reported, later cleanups still run", async () => {
    const registry = new CleanupRegistry();
    const order: string[] = [];
    registry.register("removable", () => void order.push("removable"));
    registry.register("stuck-resource jolly-test-x-1", () => {
      throw new Error("api unavailable");
    });
    const failures = await registry.runAll();
    expect(order).toEqual(["removable"]);
    expect(failures).toEqual([
      {
        description: "stuck-resource jolly-test-x-1",
        error: "api unavailable",
      },
    ]);
  });

  test("is idempotent: a second run has nothing left to do", async () => {
    const registry = new CleanupRegistry();
    let calls = 0;
    registry.register("once", () => void calls++);
    await registry.runAll();
    const second = await registry.runAll();
    expect(calls).toBe(1);
    expect(second).toEqual([]);
    expect(registry.size).toBe(0);
  });

  test("supports async cleanups", async () => {
    const registry = new CleanupRegistry();
    let done = false;
    registry.register("async", async () => {
      await Promise.resolve();
      done = true;
    });
    await registry.runAll();
    expect(done).toBe(true);
  });
});

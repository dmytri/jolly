// Steps for features/016-homepage-and-agent-setup-guide.feature (all @logic).
// DOM-level checks use happy-dom (AGENTS.md testing strategy); artifact
// discovery convention lives in features/support/homepage.ts.
import assert from "node:assert/strict";
import { Given, When, Then } from "@cucumber/cucumber";
import { lit } from "../support/text.ts";
import {
  homepage,
  homepageText,
  guideText,
  copyPrompt,
  assertHomepageMentions,
  assertGuideMentions,
  assertPromptMentions,
} from "../support/content.ts";

Given(lit("the customer visits the Jolly homepage"), function () {
  homepage(); // resolvable and parseable, or this fails with the discovery hint
});

When(lit("the homepage loads"), function () {
  assert.ok(homepageText().trim().length > 0, "homepage has no readable content");
});

Then(
  lit("it should explain that Jolly helps the customer's own agent set up an end-to-end Saleor Cloud storefront"),
  function () {
    assertHomepageMentions(/agent/i, "must talk about the customer's agent");
    assertHomepageMentions(/Saleor Cloud/i, "must name Saleor Cloud");
    assertHomepageMentions(/storefront/i, "must name the storefront outcome");
  },
);

Then(lit("it should position Jolly as Saleor's Hydrogen for the agentic age"), function () {
  assertHomepageMentions(/Hydrogen for the agentic age/i, "must carry the tagline");
});

Then(
  lit("it should make clear that Jolly depends on Saleor Cloud rather than replacing Saleor"),
  function () {
    assertHomepageMentions(/Saleor Cloud/i, "must name the Saleor Cloud dependency");
    assertHomepageMentions(/not (a )?replac|depends on|built on|powered by/i, "must clarify Jolly does not replace Saleor");
  },
);

Then(
  lit("it should make clear that the primary path starts by copying instructions into the customer's agent"),
  function () {
    assertHomepageMentions(/copy/i, "must describe the copy-into-agent entry path");
  },
);

Then(lit("it should set the expectation that setup takes minutes with minimal manual steps"), function () {
  assertHomepageMentions(/minute/i, "must promise a minutes-scale setup");
  assertHomepageMentions(/minimal|only|few/i, "must promise minimal manual steps");
});

Given(lit("the customer is on the homepage"), function () {
  homepage();
});

When(lit("they view the primary copy box"), function () {
  copyPrompt(); // copy box and copyable prompt must both exist
});

Then(lit("it should provide a copyable prompt for the customer's agent"), function () {
  assert.ok(copyPrompt().trim().length > 0, "the copy box has no copyable prompt content");
});

Then(lit("the prompt should include the Jolly homepage/setup-guide URL"), function () {
  // Canonical URL is deferred; a placeholder URL is acceptable but it must be
  // URL-shaped (or an explicit placeholder token).
  assertPromptMentions(/https?:\/\/\S+|<[A-Za-z0-9 _-]*url[A-Za-z0-9 _-]*>/i, "must carry the setup-guide URL or placeholder");
});

Then(lit("the prompt should instruct the agent to read the setup guide"), function () {
  assertPromptMentions(/read|setup guide|guide/i, "must point the agent at the setup guide");
});

Then(lit("the prompt should instruct the agent to run Jolly via `npx`"), function () {
  assertPromptMentions(/npx/, "must instruct npx invocation");
});

Then(lit("the prompt should instruct the agent to use Jolly CLI skill management"), function () {
  assertPromptMentions(/skills?/i, "must instruct Jolly CLI skill management");
});

Then(lit("the prompt should instruct the agent to run `jolly start`"), function () {
  assertPromptMentions(/jolly start/i, "must instruct running jolly start");
});

Given(lit("the customer pasted the copied prompt into an agent"), function () {
  copyPrompt();
});

When(lit("the agent opens or reads the setup guide"), function () {
  assert.ok(guideText().trim().length > 0, "setup guide has no readable content");
});

Then(lit("it should see generic agent instructions"), function () {
  assertGuideMentions(/agent/i, "must address agents generically");
});

Then(lit("it should see that Jolly exists to empower the agent, not replace it"), function () {
  assertGuideMentions(/empower/i, "must state the empower-not-replace principle");
});

Then(
  lit("it should see the Saleor MCP server URL (mcp.saleor.app) for read-only live store data access after setup"),
  function () {
    assertGuideMentions(/mcp\.saleor\.app/i, "must carry the MCP server URL");
    assertGuideMentions(/read.?only/i, "must describe the MCP server as read-only");
  },
);

Then(
  lit("it should understand that Jolly handles setup automation while the MCP server enables the agent to query live store data post-setup"),
  function () {
    assertGuideMentions(/setup/i, "must describe Jolly's setup role");
    assertGuideMentions(/live store data|live data|query/i, "must describe the MCP server's live-data role");
  },
);

Then(
  lit("it should see supported agent targets: Zed, Claude Code, Cursor, OpenCode, and Pi.dev"),
  function () {
    for (const target of ["Zed", "Claude Code", "Cursor", "OpenCode", "Pi.dev"]) {
      assertGuideMentions(new RegExp(target.replace(".", "\\."), "i"), `must list supported agent target ${target}`);
    }
  },
);

Then(lit("it should see production invocation examples using `npx @saleor/jolly`"), function () {
  assertGuideMentions(/npx @saleor\/jolly/, "must show the production npx invocation");
});

Then(lit("it should see testing invocation examples using `npx @dk/jolly`"), function () {
  assertGuideMentions(/npx @dk\/jolly/, "must show the testing npx invocation");
});

Then(
  lit("it should see the recommended command sequence starting with `jolly init`, `jolly skills install`, and `jolly start`"),
  function () {
    const guide = guideText();
    const positions = ["jolly init", "jolly skills install", "jolly start"].map((command) => {
      const index = guide.indexOf(command);
      assert.ok(index >= 0, `setup guide must include \`${command}\``);
      return index;
    });
    assert.ok(positions[0] < positions[1] && positions[1] < positions[2], "commands must appear in init → skills install → start order");
  },
);

Given(lit("the customer wants to understand what Jolly will do"), function () {
  homepage();
});

When(lit("they read the homepage"), function () {
  assert.ok(homepageText().trim().length > 0);
});

Then(lit("it should summarize the v1 flow"), function () {
  assertHomepageMentions(/how it works|flow|steps|journey/i, "must summarize the v1 flow");
});

Then(
  lit("the flow should include checking whether the customer already has a Saleor store or wants to register one"),
  function () {
    assertHomepageMentions(/already (have|has)|existing/i, "must mention the existing-store branch");
    assertHomepageMentions(/register|new store|create.*store/i, "must mention the register branch");
  },
);

Then(lit("the flow should include Saleor Cloud setup or connection"), function () {
  assertHomepageMentions(/Saleor Cloud/i, "must include Saleor Cloud setup/connection");
});

Then(lit("the flow should include Configurator-based store configuration"), function () {
  assertHomepageMentions(/configurator/i, "must include Configurator-based configuration");
});

Then(lit("the flow should include cloning Saleor Paper"), function () {
  assertHomepageMentions(/paper/i, "must include the Paper storefront");
});

Then(lit("the flow should include Stripe test-mode checkout setup"), function () {
  assertHomepageMentions(/stripe/i, "must include Stripe checkout setup");
  assertHomepageMentions(/test mode|test-mode/i, "must say Stripe runs in test mode");
});

Then(lit("the flow should include Vercel deployment"), function () {
  assertHomepageMentions(/vercel/i, "must include Vercel deployment");
});

Then(lit("the flow should include automatic trusted-origin updates where possible"), function () {
  assertHomepageMentions(/trusted|allowed.?origin/i, "must include trusted-origin updates");
});

Then(
  lit("the flow should include final verification of deployed product browsing, cart, and checkout to Stripe test payment step"),
  function () {
    assertHomepageMentions(/brows/i, "must include product browsing verification");
    assertHomepageMentions(/cart/i, "must include cart verification");
    assertHomepageMentions(/checkout/i, "must include checkout verification");
  },
);

Then(
  lit("the flow should explain that after setup, the agent and Jolly help the customer iterate and customize their commerce experience"),
  function () {
    assertHomepageMentions(/iterat|customiz/i, "must describe the post-setup iteration phase");
  },
);

Given(lit("the customer is evaluating Jolly"), function () {
  homepage();
});

Then(lit("it should state that v1 supports Saleor Cloud only"), function () {
  assertHomepageMentions(/Saleor Cloud only|only.*Saleor Cloud/i, "must state the Saleor Cloud-only boundary");
});

Then(lit("it should state that Jolly does not replace Saleor Dashboard"), function () {
  assertHomepageMentions(/dashboard/i, "must mention Saleor Dashboard");
  assertHomepageMentions(/not.*(replac).*dashboard|dashboard.*not.*replac/i, "must state the Dashboard is not replaced");
});

Then(
  lit("it should state that Jolly uses the customer's own agent and workflow for post-setup iteration"),
  function () {
    assertHomepageMentions(/own agent/i, "must credit the customer's own agent for iteration");
  },
);

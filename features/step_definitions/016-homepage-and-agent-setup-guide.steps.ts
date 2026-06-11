// Steps for features/016-homepage-and-agent-setup-guide.feature.
// "the copy box should say ..." is defined in the feature 001 step file
// (shared step text).
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import {
  copyBoxPrompt,
  homepageText,
  loadHomepage,
  loadSetupGuide,
  type HomepageDom,
} from "../support/homepage.ts";
import type { JollyWorld } from "../support/world.ts";

function dom(world: JollyWorld): HomepageDom {
  if (!world.notes.homepage) world.notes.homepage = loadHomepage();
  return world.notes.homepage as HomepageDom;
}

function page(world: JollyWorld): string {
  return homepageText(dom(world));
}

function guide(world: JollyWorld): string {
  if (!world.notes.guide) world.notes.guide = loadSetupGuide();
  return world.notes.guide as string;
}

// --- Customer sees the homepage hero (@logic) -----------------------------------

Given("the customer visits the Jolly homepage", function (this: JollyWorld) {
  dom(this);
});

When("the homepage loads", function (this: JollyWorld) {
  // Context only.
});

Then(
  "it should explain that Jolly helps the customer's own agent set up an end-to-end Saleor Cloud storefront",
  function (this: JollyWorld) {
    const text = page(this);
    assert.match(text, /Saleor Cloud/i);
    assert.match(text, /agent/i);
    assert.match(text, /storefront/i);
  },
);

Then(
  "it should position Jolly as Saleor's Hydrogen for the agentic age",
  function (this: JollyWorld) {
    assert.match(page(this), /Hydrogen for the agentic age/i);
  },
);

Then(
  "it should make clear that Jolly depends on Saleor Cloud rather than replacing Saleor",
  function (this: JollyWorld) {
    assert.match(
      page(this),
      /(depends on|built on|powered by|runs on).{0,40}Saleor|not.{0,40}replac/i,
      "the homepage does not clarify Jolly's dependence on Saleor Cloud",
    );
  },
);

Then(
  "it should make clear that the primary path starts by copying instructions into the customer's agent",
  function (this: JollyWorld) {
    assert.match(page(this), /copy/i);
  },
);

Then(
  "it should set the expectation that setup takes minutes with minimal manual steps",
  function (this: JollyWorld) {
    assert.match(page(this), /minute/i, "no setup-time expectation is set");
    assert.match(page(this), /minimal|few|only/i, "no minimal-steps expectation is set");
  },
);

// --- Customer copies the agent setup prompt (@logic) -----------------------------

Given("the customer is on the homepage", function (this: JollyWorld) {
  dom(this);
});

When("they view the primary copy box", function (this: JollyWorld) {
  this.notes.prompt = copyBoxPrompt(dom(this));
});

Then(
  "it should provide a copyable prompt for the customer's agent",
  function (this: JollyWorld) {
    assert.ok((this.notes.prompt as string).length > 0);
  },
);

Then(
  /^the prompt should include the Jolly homepage\/setup-guide URL$/,
  function (this: JollyWorld) {
    assert.match(this.notes.prompt as string, /https?:\/\/\S+/);
  },
);

Then(
  "the prompt should instruct the agent to read the setup guide",
  function (this: JollyWorld) {
    assert.match(this.notes.prompt as string, /read|setup[\s-]?guide/i);
  },
);

Then(
  "the prompt should instruct the agent to run Jolly via `npx`",
  function (this: JollyWorld) {
    assert.match(this.notes.prompt as string, /npx/);
  },
);

Then(
  "the prompt should instruct the agent to use Jolly CLI skill management",
  function (this: JollyWorld) {
    assert.match(this.notes.prompt as string, /skill/i);
  },
);

Then(
  "the prompt should instruct the agent to run `jolly start`",
  function (this: JollyWorld) {
    assert.match(this.notes.prompt as string, /jolly start/);
  },
);

// --- Agent follows the setup guide (@logic) ---------------------------------------

Given("the customer pasted the copied prompt into an agent", function (this: JollyWorld) {
  guide(this);
});

When("the agent opens or reads the setup guide", function (this: JollyWorld) {
  // Context only.
});

Then("it should see generic agent instructions", function (this: JollyWorld) {
  assert.match(
    guide(this),
    /generic|any (AI )?agent/i,
    "the setup guide is not framed as generic agent instructions",
  );
});

Then(
  "it should see that Jolly exists to empower the agent, not replace it",
  function (this: JollyWorld) {
    assert.match(guide(this), /empower/i);
    assert.match(guide(this), /not replace/i);
  },
);

Then(
  /^it should see the Saleor MCP server URL \(mcp\.saleor\.app\) for read-only live store data access after setup$/,
  function (this: JollyWorld) {
    assert.match(guide(this), /mcp\.saleor\.app/);
    assert.match(guide(this), /read[- ]only/i);
  },
);

Then(
  "it should understand that Jolly handles setup automation while the MCP server enables the agent to query live store data post-setup",
  function (this: JollyWorld) {
    assert.match(guide(this), /setup automation/i);
    assert.match(guide(this), /live store data|query/i);
  },
);

Then(
  "it should see supported agent targets: Zed, Claude Code, Cursor, OpenCode, and Pi.dev",
  function (this: JollyWorld) {
    for (const target of ["Zed", "Claude Code", "Cursor", "OpenCode", "Pi.dev"]) {
      assert.ok(
        guide(this).includes(target),
        `supported agent target ${target} is missing from the setup guide`,
      );
    }
  },
);

Then(
  /^it should see production invocation examples using `npx @saleor\/jolly`$/,
  function (this: JollyWorld) {
    assert.match(guide(this), /npx @saleor\/jolly/);
  },
);

Then(
  /^it should see testing invocation examples using `npx @dk\/jolly`$/,
  function (this: JollyWorld) {
    assert.match(guide(this), /npx @dk\/jolly/);
  },
);

Then(
  "it should see the recommended command sequence starting with `jolly init`, `jolly skills install`, and `jolly start`",
  function (this: JollyWorld) {
    const text = guide(this);
    const init = text.indexOf("jolly init");
    const skills = text.indexOf("jolly skills install");
    const start = text.indexOf("jolly start");
    assert.ok(init >= 0, "`jolly init` is missing from the recommended sequence");
    assert.ok(skills >= 0, "`jolly skills install` is missing from the recommended sequence");
    assert.ok(start >= 0, "`jolly start` is missing from the recommended sequence");
    assert.ok(
      init < skills && skills < start,
      "the recommended sequence is not init → skills install → start",
    );
  },
);

// --- Homepage explains the v1 journey (@logic) -------------------------------------

Given(
  "the customer wants to understand what Jolly will do",
  function (this: JollyWorld) {
    dom(this);
  },
);

When("they read the homepage", function (this: JollyWorld) {
  // Context only (shared by the journey and boundaries scenarios).
});

Then("it should summarize the v1 flow", function (this: JollyWorld) {
  assert.match(page(this), /how it works|flow|journey|steps/i);
});

Then(
  "the flow should include checking whether the customer already has a Saleor store or wants to register one",
  function (this: JollyWorld) {
    assert.match(page(this), /already (has|have)|register/i);
  },
);

Then(
  "the flow should include Saleor Cloud setup or connection",
  function (this: JollyWorld) {
    assert.match(page(this), /Saleor Cloud/i);
  },
);

Then(
  "the flow should include Configurator-based store configuration",
  function (this: JollyWorld) {
    assert.match(page(this), /configurator/i);
  },
);

Then("the flow should include cloning Saleor Paper", function (this: JollyWorld) {
  assert.match(page(this), /Paper/);
});

Then(
  "the flow should include Stripe test-mode checkout setup",
  function (this: JollyWorld) {
    assert.match(page(this), /Stripe/i);
    assert.match(page(this), /test/i);
  },
);

Then("the flow should include Vercel deployment", function (this: JollyWorld) {
  assert.match(page(this), /Vercel/i);
});

Then(
  "the flow should include automatic trusted-origin updates where possible",
  function (this: JollyWorld) {
    assert.match(page(this), /trusted[\s-]origin|allowed[\s-]origin|origin/i);
  },
);

Then(
  "the flow should include final verification of deployed product browsing, cart, and checkout to Stripe test payment step",
  function (this: JollyWorld) {
    const text = page(this);
    assert.match(text, /verif/i);
    assert.match(text, /browsing|browse|cart|checkout/i);
  },
);

Then(
  "the flow should explain that after setup, the agent and Jolly help the customer iterate and customize their commerce experience",
  function (this: JollyWorld) {
    assert.match(page(this), /iterat|customiz/i);
  },
);

// --- Homepage explains boundaries (@logic) -------------------------------------------

Given("the customer is evaluating Jolly", function (this: JollyWorld) {
  dom(this);
});

Then("it should state that v1 supports Saleor Cloud only", function (this: JollyWorld) {
  assert.match(
    page(this),
    /Saleor Cloud only|only.{0,30}Saleor Cloud/i,
    "the Saleor-Cloud-only boundary is not stated",
  );
});

Then(
  "it should state that Jolly does not replace Saleor Dashboard",
  function (this: JollyWorld) {
    assert.match(
      page(this),
      /not (a )?(replac\w+|substitute)[^.]*Dashboard|Dashboard[^.]*not replaced?/i,
      "the Dashboard boundary is not stated",
    );
  },
);

Then(
  "it should state that Jolly uses the customer's own agent and workflow for post-setup iteration",
  function (this: JollyWorld) {
    assert.match(page(this), /own agent/i);
  },
);

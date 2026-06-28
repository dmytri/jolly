Feature: Jolly CLI output contract
  As a customer's AI agent
  I want every Jolly command to share one structured output envelope
  So that I can parse, branch on, and chain any command identically without per-command parsing logic

  Background:
    Given Jolly is executable via `npx`
    And every command supports `--json`, `--quiet`, and (for side-effecting commands) `--dry-run`

  @logic @property
  Scenario Outline: Every command emits one envelope on --json stdout
    When the agent runs `<command>`
    Then stdout should contain a single JSON envelope and nothing else
    And the envelope should include a `command` identifier
    And the envelope should include a top-level `status` of `success`, `warning`, or `error`
    And the envelope should include a human `summary` string
    And the envelope should include a command-specific `data` object
    And the envelope should include a `checks` array
    And the envelope should include a `nextSteps` array
    And the envelope should include an `errors` array that is empty on success

    Examples:
      | command                                |
      | jolly doctor --json                    |
      | jolly auth status --json               |
      | jolly create store --dry-run --json    |

  @logic
  Scenario: Default output is human-friendly and omits the machine envelope
    When the agent runs `jolly doctor`
    Then stdout should contain human-readable check results
    And stdout should not contain a JSON envelope
    And the JSON envelope should appear on stdout only when `--json` is passed

  @logic
  Scenario: --quiet stays silent on a successful run
    When the agent runs `jolly start --dry-run --quiet`
    Then stdout should be empty
    And stderr should be empty

  @logic
  Scenario: --quiet reports only the problem on a failed run
    Given a Saleor Cloud token is configured
    When the agent runs `jolly create store --url https://evil.example.com/graphql/ --quiet`
    Then stderr should name the failure and the stable code `NON_FIRST_PARTY_HOST`
    And stdout should be empty
    And no JSON envelope should be printed

  @logic
  Scenario: Human output is colourful in an interactive terminal
    When `jolly doctor` runs in an interactive terminal
    Then stdout should contain ANSI colour codes

  @logic
  Scenario: Human output is plain when stdout is not a terminal
    When the agent runs `jolly doctor` with stdout not a terminal
    Then stdout should contain no ANSI colour codes
    And `jolly doctor --json` stdout should contain no ANSI colour codes

  @logic
  Scenario: Machine output carries no colour or emoji
    When the agent runs `jolly doctor --json`
    Then the stdout envelope should contain no ANSI colour codes
    And the stdout envelope should contain no emoji

  @logic
  Scenario: Progress is shown in place on stderr, never on the result stream
    Given a fresh empty project directory
    When `jolly start` runs in an interactive terminal
    Then progress for the long stages should be shown on stderr
    And the progress should update in place rather than appending one line per update
    And stdout should carry no progress or spinner text
    And `jolly start --json` should show no progress on stdout

  @logic
  Scenario: Commands that run checks reuse the doctor vocabulary
    Given the agent runs `jolly doctor --json`
    When it reports check results in the envelope
    Then each check should appear in a `checks` array
    And each check should carry a stable check id
    And each check `status` should be one of pass, warning, fail, skipped, or unknown
    And each check should be able to carry a concrete next command or manual step

  @logic
  Scenario: Agent branches on stable codes
    Given the agent runs `jolly login --json` with an invalid JOLLY_SALEOR_CLOUD_TOKEN
    When the agent inspects the envelope
    Then each entry in `errors` should include a stable `code`, a `message`, and optional `remediation`
    And the documented `code` and check id strings should remain stable so the agent can branch on them programmatically

  @logic @property
  Scenario Outline: Output never exposes secrets
    When the agent runs `<command>` in default, `--json`, and `--quiet` modes
    Then no human text, nor any field of the envelope when one is emitted, should contain the secret value
    And the secret should be referenced by name only

    Examples:
      | command                                      |
      | jolly login                                  |

  @logic @property
  Scenario: Jolly's request code contacts only first-party hosts
    Given Jolly's own network-request-sending code
    When the hosts it can contact are enumerated
    Then they should be exactly cloud.saleor.io, auth.saleor.io, the customer's `*.saleor.cloud` domains, and github.com, plus any `JOLLY_SALEOR_CLOUD_API_URL` or `JOLLY_SALEOR_AUTH_URL` override
    And neither api.vercel.com nor api.stripe.com should appear in Jolly's own request code — Vercel is reached only by the spawned Vercel CLI, and api.stripe.com only by the Saleor Stripe app that Jolly installs via Saleor GraphQL `appInstall`
    And the retired hosts id.saleor.online and api.saleor.cloud should not appear anywhere in Jolly's code or output

  @logic
  Scenario: Jolly refuses a request to a non-first-party host instead of sending it
    Given a Saleor Cloud token is configured
    When the agent runs `jolly create store --url https://evil.example.com/graphql/ --json`
    Then the envelope status should be "error" with the stable code `NON_FIRST_PARTY_HOST`
    And the error message should name the refused host evil.example.com
    And nothing should be written to .env

  Rule: Output envelope principles
    - Every command should emit one consistent top-level JSON envelope. The single exception
      is `completion` (feature 027), whose output is a shell-completion script consumed via
      `source`, not a JSON envelope.
    - The envelope fields are `command`, `status`, `summary`, `data`, `checks`, `nextSteps`, and `errors`.
    - `status` is one of `success`, `warning`, or `error`.
    - `checks[].status` reuses the doctor vocabulary: pass, warning, fail, skipped, unknown.
    - `nextSteps[]` should mirror doctor's guidance shape with a human description and an optional concrete command.
    - `errors[]` should each carry a stable `code`, a `message`, and optional `remediation`.
    - `--json` is the only mode that emits the machine-readable envelope: its stdout is exactly
      one envelope and nothing else — no human text, colour, emoji, or progress. It is the
      agent's explicit opt-in to machine output.
    - Default mode (no `--json`) is human-friendly and does NOT emit the envelope: concise,
      colourful output with restrained emoji, and in-place progress for the long stages when
      stdout is a terminal. When stdout is not a terminal the same human text is plain — no
      colour, emoji, or progress — and the envelope still appears only with `--json`.
    - `--quiet` is silent on success (no stdout, no stderr) and prints only warnings and errors,
      each with its stable `code`, to stderr; it never emits the envelope.
    - The result goes to stdout (the human summary in default mode, the envelope with `--json`);
      progress and status chatter go to stderr and update in place, so piping stdout stays clean.
    - Colour and emoji appear only in human terminal output; they are absent when stdout is not a
      terminal, under `--json`, under `--quiet`, and when `NO_COLOR` is set. Emoji stay restrained.
    - Output must never print secret values; reference secrets by name only.
    - Structured side-effect context (see feature 021) should be carried inside `data` and/or `checks`, not in a separate ad hoc format.
    - Field names use camelCase (for example `nextSteps`, `errors[].code`); this applies to the envelope and to the feature 021 risk context.

  Rule: No fabricated success
    - Success, verified, valid, connected, authenticated, and similar claims — in
      `summary`, `checks`, `data`, or human text — are permitted only when backed by an
      operation the command actually performed and confirmed in this run: a real request
      whose response was received and checked, or a local action actually taken and
      observed.
    - A check with status "pass" asserts the described verification really happened.
      Work not attempted is "skipped"; work attempted but unconfirmable is "unknown".
    - Storing is not verifying: when a value is stored without being verified, the output
      must say exactly that ("stored, not verified").
    - Junk or invalid input must never produce success or verification language, from any
      command.
    - Unimplemented behavior is reported as an error naming what is not implemented —
      never simulated with placeholder values, invented identifiers (fake organization
      ids, random task ids), hardcoded responses, or input-pattern guessing (for example
      deciding validity from a token's prefix or a URL's substring).
    - `--dry-run` previews show the real request the command would send — same host, same
      path, real resolved identifiers — and never claim the previewed work happened.

  Rule: First-party hosts only
    - Jolly's code sends network requests only to these hosts: cloud.saleor.io (Saleor Cloud
      API and token page), auth.saleor.io (the `saleor-cloud` Keycloak realm — the device
      authorization grant and its refresh, feature 018), the customer's own *.saleor.cloud
      environment domains, and github.com (cloning saleor/storefront and skills). "Hosts Jolly
      contacts" stays exactly equal to the hosts appearing in Jolly's request-sending code.
    - Neither api.vercel.com nor api.stripe.com is in this allowlist, and Jolly's own
      request-sending code reaches neither: Vercel is reached only by the Vercel CLI (`npx vercel`)
      Jolly delegates to, and api.stripe.com only by the Saleor Stripe app that Jolly installs via
      Saleor GraphQL `appInstall` (feature 005) and which runs server-side in Saleor (see feature 008
      Rule "Surface — composable plumbing commands; `start` orchestrates the official CLIs").
    - Secrets travel only to their own service: the Saleor Cloud token only to cloud.saleor.io
      or the customer's *.saleor.cloud domains; the Saleor device-grant and refresh tokens only
      to auth.saleor.io. No secret is ever sent to github.com or any host not on this list.
      Jolly's own request code holds no Vercel token at all: Vercel auth lives in the Vercel CLI's
      own session.
    - Delegated official CLIs (the Vercel CLI, `@saleor/configurator`) are a distinct
      category from Jolly's own request code: Jolly invokes them and they contact their
      own services under their own auth. This delegation to current, official tooling is
      not a violation of this rule, and is separate from the ban on the deprecated
      saleor/cli (which Jolly must never invoke).
    - Informational mentions are not contacts: Jolly may name other Saleor properties in
      output or docs as guidance for the customer's agent — for example the read-only
      MCP server mcp.saleor.app, which the agent may choose to use later — but Jolly
      itself never sends requests (let alone secrets) to them. The .mcp.json Jolly
      writes configures a local mcp-graphql server against the customer's own store
      endpoint; it does not point at mcp.saleor.app.
    - Enforcement is pre-flight, not just by-construction: when a request target's host is
      not first-party — not on the allowlist, not a `*.saleor.cloud` domain, and not the
      `JOLLY_SALEOR_CLOUD_API_URL` override — Jolly refuses with the stable error code
      `NON_FIRST_PARTY_HOST` and sends nothing; it never silently contacts a foreign host.
      The customer-supplied instance URL (`--url`) is the exposed injection point this
      guards (see the scenario above). The canonical allowlist + predicate live in one
      place in Jolly's code so "hosts Jolly can contact" stays enumerable and enforced.
    - `JOLLY_SALEOR_CLOUD_API_URL` (feature 018) may redirect the Cloud API base; secrets
      then go where the customer explicitly pointed them.
    - The retired saleor/cli-era hosts id.saleor.online and api.saleor.cloud must not
      appear anywhere in Jolly code or output.

  Rule: Open questions
    - Envelope schema versioning, if any, is deferred to CLI design.
    - The canonical registry of stable `code` and check-id strings is deferred to CLI design but must be documented when commands are implemented.

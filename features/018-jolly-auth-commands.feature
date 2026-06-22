Feature: Jolly auth commands
  As a customer's AI agent
  I want explicit Jolly auth commands
  So that Saleor Cloud authentication can be managed independently from the full setup flow

  @logic @exceptional-double
  Scenario: Jolly login stores a token honestly when verification is unreachable
    Given the Saleor Cloud API is unreachable
    And the agent has a Saleor Cloud token value "jolly-login-test-token-abc"
    When the agent runs `jolly login --token jolly-login-test-token-abc`
    Then Jolly should write the token to .env as JOLLY_SALEOR_CLOUD_TOKEN
    And .env should contain JOLLY_SALEOR_CLOUD_TOKEN=jolly-login-test-token-abc
    And .gitignore should contain .env
    And Jolly should load the updated .env values for the current command flow
    And the envelope status should be "warning"
    And the output should state the token was stored, not verified
    And no check may report the token as verified
    And no organization name should be written to .env
    And subsequent `jolly auth status` should report the token is configured
    And Jolly should not print the token value

  @sandbox
  Scenario: Jolly login verifies a headless token against the Cloud API
    Given the agent provides a valid token from https://cloud.saleor.io/tokens
    When Jolly validates the token
    Then it should verify the token with an authenticated read-only request to the Cloud API organizations endpoint
    And it should store the token in .env as JOLLY_SALEOR_CLOUD_TOKEN
    And it should store the organization name returned by the Cloud API in .env as JOLLY_SALEOR_ORGANIZATION
    And it should report the authenticated organization context using values from the real response

  @sandbox
  Scenario: Jolly login rejects an invalid token gracefully
    Given the agent provides an invalid or expired token
    When Jolly validates the token against the Cloud API
    Then the verification request should really be sent and really be rejected
    And Jolly should report a clear error message
    And it should not write any value to .env
    And the output should contain no success, verified, or authenticated language
    And the error message should direct the customer to create a new token at https://cloud.saleor.io/tokens

  @logic
  Scenario: Jolly login with an empty token fails honestly
    Given the agent has no existing Saleor Cloud authentication
    When the agent runs `jolly login --token "" --json`
    Then each entry in `errors` should include a stable `code`, a `message`, and optional `remediation`
    And it should not write any value to .env

  @logic
  Scenario: Jolly login with no token source fails honestly and points to the token flag
    Given the agent has no existing Saleor Cloud authentication
    When the agent runs `jolly login --json` with no token source in a non-interactive shell
    Then the envelope status should be "error" with a stable `code`
    And it should direct the user to run `jolly login --token <value>`
    And no token value should appear in the output
    And it should not write any value to .env

  @logic
  Scenario: Agent logs out
    Given .env contains JOLLY_SALEOR_CLOUD_TOKEN=some-token
    When the agent invokes `jolly logout`
    Then Jolly should remove JOLLY_SALEOR_CLOUD_TOKEN from .env
    And any non-JOLLY_ variable in .env should remain unchanged
    And it should load the updated `.env` values for the current command flow
    And the envelope status should be "success"

  @logic
  Scenario: Agent checks auth status
    Given .env contains JOLLY_SALEOR_CLOUD_TOKEN=some-token
    When it invokes `jolly auth status`
    Then Jolly should report whether Saleor Cloud authentication is configured
    And when .env contains JOLLY_SALEOR_ORGANIZATION, it should report that value as the account context
    And when no organization is stored, it should report the account context as unknown rather than failing
    And the output should not contain the token value
    And it should support `--json` and `--quiet`

  @logic
  Scenario: Jolly login --dry-run does not write to .env
    Given the agent has no existing .env file
    When the agent runs `jolly login --token jolly-dry-run-token --dry-run --json`
    Then the output should include a risk context with action "login"
    And .env should not be created
    And the output should include a nextSteps array with at least one step

  @logic
  Scenario: Jolly logout removes only Jolly-managed auth values from .env
    Given .env contains JOLLY_SALEOR_CLOUD_TOKEN=some-token and JOLLY_SALEOR_APP_TOKEN=some-app-token and JOLLY_SALEOR_ORGANIZATION=some-org and THIRD_PARTY_KEY=keep-me
    When the agent runs `jolly logout`
    Then Jolly should remove JOLLY_SALEOR_CLOUD_TOKEN, JOLLY_SALEOR_APP_TOKEN, and JOLLY_SALEOR_ORGANIZATION from .env
    And THIRD_PARTY_KEY should remain in .env unchanged
    And subsequent `jolly auth status` should report not authenticated

  @logic @exceptional-double
  Scenario: Jolly login reads the token from a file with --token-file
    Given the Saleor Cloud API is unreachable
    And a file at ./cloud-token.txt contains the token value "jolly-token-from-file-001"
    When the agent runs `jolly login --token-file ./cloud-token.txt`
    Then Jolly should write the token to .env as JOLLY_SALEOR_CLOUD_TOKEN
    And .env should contain JOLLY_SALEOR_CLOUD_TOKEN=jolly-token-from-file-001
    And Jolly should not print the token value
    And the envelope status should be "warning"
    And the output should state the token was stored, not verified

  @logic @exceptional-double
  Scenario: Jolly login reads the token from standard input with --token-stdin
    Given the Saleor Cloud API is unreachable
    And the token value "jolly-token-from-stdin-002" is provided on standard input
    When the agent runs `jolly login --token-stdin`
    Then Jolly should write the token to .env as JOLLY_SALEOR_CLOUD_TOKEN
    And .env should contain JOLLY_SALEOR_CLOUD_TOKEN=jolly-token-from-stdin-002
    And Jolly should not print the token value

  @logic @exceptional-double
  Scenario: Jolly login reads the token from $JOLLY_SALEOR_CLOUD_TOKEN when no token flag is given
    Given the Saleor Cloud API is unreachable
    And the environment variable JOLLY_SALEOR_CLOUD_TOKEN is set to "jolly-token-from-env-003"
    When the agent runs `jolly login` with no token flag in a non-interactive shell
    Then Jolly should write the token to .env as JOLLY_SALEOR_CLOUD_TOKEN
    And .env should contain JOLLY_SALEOR_CLOUD_TOKEN=jolly-token-from-env-003
    And Jolly should not print the token value

  @logic @exceptional-double
  Scenario: Jolly login prompts the interactive user to paste a token when no source is given
    # @exceptional-double: the local interactive terminal read is the contract here,
    # not the network verify. A reachable Cloud API would require a real valid token
    # (a @sandbox concern), so the pasted token is exercised via the
    # stored-not-verified path against an unreachable Cloud API — the only double,
    # never the normal verify path (the @sandbox login scenarios cover that).
    Given the Saleor Cloud API is unreachable
    And `jolly login` runs in an interactive terminal with no token flag and no token in the environment
    When the user pastes the token value "jolly-pasted-token-004" at the prompt
    Then Jolly should prompt the user to paste their Saleor Cloud token
    And .env should contain JOLLY_SALEOR_CLOUD_TOKEN=jolly-pasted-token-004
    And the terminal output should not contain the pasted token value

  @logic @exceptional-double
  Scenario: --token-file takes precedence over the $JOLLY_SALEOR_CLOUD_TOKEN environment variable
    Given the Saleor Cloud API is unreachable
    And the environment variable JOLLY_SALEOR_CLOUD_TOKEN is set to "jolly-token-env-loser"
    And a file at ./cloud-token.txt contains the token value "jolly-token-file-winner"
    When the agent runs `jolly login --token-file ./cloud-token.txt`
    Then .env should contain JOLLY_SALEOR_CLOUD_TOKEN=jolly-token-file-winner
    And the value jolly-token-env-loser should not appear in .env

  @logic
  Scenario: Jolly login --token-file with an empty file fails honestly and writes nothing
    Given a file at ./empty-token.txt that is empty
    When the agent runs `jolly login --token-file ./empty-token.txt --json`
    Then the envelope status should be "error" with a stable `code`
    And the error should name the empty token file as the cause
    And it should not write any value to .env

  @sandbox
  Scenario: Jolly login --token-file verifies the file's token against the Cloud API
    Given a file containing a valid token from https://cloud.saleor.io/tokens
    When the agent runs `jolly login --token-file <path>`
    Then it should verify the token with an authenticated read-only request to the Cloud API organizations endpoint
    And it should store the token in .env as JOLLY_SALEOR_CLOUD_TOKEN
    And it should report the authenticated organization context using values from the real response
    And Jolly should not print the token value

  @logic @property @exceptional-double
  Scenario: The .env Jolly writes is private to its owner
    # @exceptional-double: this invariant is about the local .env WRITE, not the
    # network verify. A reachable Cloud API would require a real valid token (a
    # @sandbox concern), so the write is exercised via the stored-not-verified
    # path against an unreachable Cloud API — the only double, never the normal
    # verify path (the @sandbox login scenarios cover that).
    Given the Saleor Cloud API is unreachable
    And the agent has a Saleor Cloud token value "jolly-perms-test-token-001"
    When the agent runs `jolly login --token jolly-perms-test-token-001`
    Then the .env file Jolly wrote should be readable and writable only by its owner (mode 600)
    And Jolly should not print the token value

  @logic @property @exceptional-double
  Scenario: The .env Jolly writes survives POSIX shell sourcing
    # @exceptional-double: as above, the local .env write is exercised via the
    # stored-not-verified path against an unreachable Cloud API; the real verify
    # path is the @sandbox login scenarios. The token value carries a space and
    # an apostrophe to exercise shell-quoting of the value the writer emits.
    Given the Saleor Cloud API is unreachable
    And a file at ./odd-token.txt contains the token value "jolly token's value 002"
    When the agent runs `jolly login --token-file ./odd-token.txt`
    Then sourcing the written .env in a POSIX shell should exit zero
    And the value read back for JOLLY_SALEOR_CLOUD_TOKEN should equal "jolly token's value 002"

  Rule: The .env Jolly writes is private and shell-safe
    - Every .env Jolly creates or updates (the Cloud token, app token, organization name,
      Stripe keys, storefront variables) is written with owner-only permissions (mode 600);
      a file holding credentials is never group- or world-readable.
    - Values are written so the file stays a valid POSIX shell env file: a value containing
      whitespace, an apostrophe, or another shell-significant character is quoted so
      `set -a; . ./.env` sources it without error and round-trips the original value. An
      apostrophe in the organization name (e.g. "Dmytri's Organization") is the common case.
    - This is a cross-cutting invariant of the shared .env writer, not one command's behaviour;
      it holds wherever Jolly writes .env.

  Rule: Auth command principles
    - V1 should include `jolly login`, `jolly logout`, and `jolly auth status`.
    - Auth commands are helpers that empower the customer's agent; they do not make Jolly a separate control plane.
    - `jolly login` authenticates with a Saleor Cloud token. The customer creates a token at
      https://cloud.saleor.io/tokens and hands it to Jolly through one of the token sources (Rule
      "Token input is flexible so the secret need never be a process argument").
    - Jolly should not depend on the deprecated Saleor CLI for authentication.
    - Auth output must not expose secret values.
    - Jolly auth secrets should be written to `.env` as environment variables in v1.
    - Successful login flows also store the authenticated organization name in `.env` as
      JOLLY_SALEOR_ORGANIZATION. It is non-secret account context, not a credential; it may
      appear in output, and `jolly auth status` reads it back so it can report account
      context without a network call. When it is absent, account context is reported as
      unknown — never an error. The stored value is always the organization name returned
      by the Cloud API — never a placeholder or invented label.

  Rule: Token verification is a real request or it is not verification
    - Token verification means one thing: an authenticated read-only
      GET of the Cloud API organizations endpoint
      (`https://cloud.saleor.io/platform/api/organizations/`, `Authorization: Token <value>`)
      whose response was actually received and checked. A 2xx response with a parseable
      organization list is verified; a 401/403 is an invalid token (error, nothing written);
      any other failure (network unreachable, 5xx, timeout) means verification did not
      happen.
    - When verification did not happen but the token was stored, every surface (summary,
      checks, data) must say "stored, not verified"; the envelope status is "warning" and
      the verification check status is "unknown" — never "pass".
    - `JOLLY_SALEOR_CLOUD_API_URL` optionally overrides the Cloud API base URL (default
      `https://cloud.saleor.io/platform/api`) for proxy or self-routing setups; all Cloud
      API requests honor it. Pointing it elsewhere is the customer's explicit choice.
    - All Cloud API requests target the first-party host cloud.saleor.io, which serves both the
      Cloud API and the token page at https://cloud.saleor.io/tokens.

  Rule: Token input is flexible so the secret need never be a process argument
    - `jolly login` accepts the Cloud token from four explicit sources, in precedence order:
      `--token-file <path>` (read the file, trim surrounding whitespace and the trailing
      newline) > `--token-stdin` (read standard input) > `--token <value>` > the
      `JOLLY_SALEOR_CLOUD_TOKEN` environment variable. The file, stdin, and environment
      paths exist so an agent can supply the token without placing the literal in `argv`,
      where it is visible in process listings and shell history; the agent therefore never
      has to hand-write the secret into `.env` itself and skip Jolly's verify-before-write.
    - When none of those four sources supplies a token AND `jolly login` runs in an
      interactive terminal (stdin is a TTY), Jolly prompts the user to paste the Cloud
      token and reads it from the controlling terminal with echo disabled, then verifies
      and stores it exactly as a `--token <value>` login. This interactive paste is the
      lowest-precedence source — any explicit source above skips it. It lets a human at the
      terminal hand Jolly the secret directly, so when an agent is driving Jolly the token
      reaches Jolly through the terminal and never through the agent's process arguments,
      output, or context.
    - The interactive prompt is gated on an interactive terminal. When stdin is NOT a TTY —
      the agent-driven subprocess case — Jolly never prompts and never blocks waiting for
      input; with no token from any source it fails honestly with a stable error code that
      directs the user to `jolly login --token <value>`.
    - Every source is trimmed and checked non-empty BEFORE the verification request. An
      empty file, empty stdin, or an explicit empty `--token ""` fails with a stable error
      code naming the empty input.
    - A token from any source is verified and stored exactly as a `--token <value>` login
      is (Rule "Token verification is a real request or it is not verification"):
      verified-and-stored on a real 2xx, error-and-nothing-written on a real 401/403,
      stored-not-verified when the Cloud API is unreachable.
    - With no token from any source and no interactive terminal, `jolly login` fails honestly
      with a stable error code directing the user to `jolly login --token <value>`. A
      present-but-empty source is an honest error, not a fall-through.

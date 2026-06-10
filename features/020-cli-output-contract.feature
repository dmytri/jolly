Feature: Jolly CLI output contract
  As a customer's AI agent
  I want every Jolly command to share one structured output envelope
  So that I can parse, branch on, and chain any command identically without per-command parsing logic

  Background:
    Given Jolly is executable via `npx`
    And every command supports `--json`, `--quiet`, and (for side-effecting commands) `--dry-run`

  Scenario: Agent parses any command through one envelope
    Given the agent invokes any Jolly command with `--json`
    When the command completes
    Then stdout should contain a single JSON envelope and nothing else
    And the envelope should include a `command` identifier
    And the envelope should include a top-level `status` of `success`, `warning`, or `error`
    And the envelope should include a human `summary` string
    And the envelope should include a command-specific `data` object
    And the envelope should include a `nextSteps` array
    And the envelope should include an `errors` array that is empty on success
    And the agent should be able to parse the same shape regardless of which command produced it

  Scenario: Default output combines human text and the envelope
    Given the agent invokes a Jolly command without `--json`
    When the command completes
    Then Jolly should print concise human-readable text for a developer reading along
    And it should still include the machine-readable envelope for the agent
    And `--quiet` should reduce nonessential human text without removing the envelope

  Scenario: Commands that run checks reuse the doctor vocabulary
    Given a command performs verification such as `jolly start` or `jolly doctor`
    When it reports check results in the envelope
    Then each check should appear in a `checks` array
    And each check should carry a stable check id
    And each check `status` should be one of pass, warning, fail, skipped, or unknown
    And each check should be able to carry a concrete next command or manual step

  Scenario: Agent branches on stable codes
    Given a command fails or partially succeeds
    When the agent inspects the envelope
    Then each entry in `errors` should include a stable `code`, a `message`, and optional `remediation`
    And the documented `code` and check id strings should remain stable so the agent can branch on them programmatically

  Scenario: Output never exposes secrets
    Given a command handles secret values such as tokens or API keys
    When it produces output in any mode
    Then no field in the envelope or human text should contain a secret value
    And secrets should be referenced by name only

  Rule: Output envelope principles
    - Every command should emit one consistent top-level JSON envelope.
    - The envelope fields are `command`, `status`, `summary`, `data`, `checks`, `nextSteps`, and `errors`.
    - `status` is one of `success`, `warning`, or `error`.
    - `checks[].status` reuses the doctor vocabulary: pass, warning, fail, skipped, unknown.
    - `nextSteps[]` should mirror doctor's guidance shape with a human description and an optional concrete command.
    - `errors[]` should each carry a stable `code`, a `message`, and optional `remediation`.
    - With `--json`, stdout should contain only the envelope so it is machine-parseable.
    - Default mode should combine concise human text with the same envelope; `--quiet` trims nonessential human text only.
    - Output must never print secret values; reference secrets by name only.
    - Structured side-effect context (see feature 021) should be carried inside `data` and/or `checks`, not in a separate ad hoc format.
    - Field names use camelCase (for example `nextSteps`, `errors[].code`); this applies to the envelope and to the feature 021 risk context.

  Rule: Open questions
    - Envelope schema versioning, if any, is deferred to CLI design.
    - The canonical registry of stable `code` and check-id strings is deferred to CLI design but must be documented when commands are implemented.

Feature: Envelope human copy from one message catalog

  As a customer's AI agent
  I want every human sentence Jolly emits to come from one source
  So that product copy stays consistent and is not duplicated across the code

  Rule: One catalog owns the human copy

    # Code-inspection candidate from harbour, not verified product intent. The
    # interactive CLI already routes its prompts, notes, and stage labels through
    # the `cliMessage` catalog in `src/lib/messages.ts`. The machine-envelope
    # human copy — `summary`, `remediation`, and check `description` prose — is
    # written as inline string literals throughout `src/index.ts` and the leaf
    # libs (for example `src/lib/saleor-url.ts` and `src/lib/device-grant.ts`)
    # instead. Captain decides with the customer whether envelope prose should
    # also be catalog-sourced, or whether inline envelope copy is intended.

    @logic @property @captain
    Scenario: The doctor summary sentence is sourced from the message catalog
      Given the message catalog defines the doctor all-passed summary
      When the agent runs `jolly doctor --json` with every check passing
      Then the envelope `summary` should equal the catalog entry for the doctor all-passed summary
      And no `summary` string should be a literal defined inline in `src/index.ts`

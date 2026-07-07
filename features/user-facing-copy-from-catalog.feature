Feature: User-facing copy is sourced from the message catalog

  Jolly's human-facing copy is human-owned material that lives in the `cliMessage`
  catalog (assets/messages/cli.json), so the wording is owned in one place rather
  than scattered as string literals in `src/`. The interactive start flow already
  renders through the catalog; the rest of the CLI surface (login, logout, auth,
  create, init, doctor, skills, upgrade, help, and the stage-failure remediations)
  MUST do the same. The pasted-URL clarifying question in `src/lib/saleor-url.ts`
  is the concrete anchor for this policy.

  @logic @property
  Scenario: The pasted-URL clarifying question comes from the message catalog
    Given the message catalog defines the clarifying question for an unusable Saleor URL
    When the agent pastes "not-a-saleor-url" as the store URL
    Then the clarifying question Jolly returns should match the catalog's entry

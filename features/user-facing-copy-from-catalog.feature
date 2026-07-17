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

  @logic @property
  Scenario: Every envelope prose field resolves through the message catalog
    Given Jolly's source tree
    When its envelope prose fields are checked against the message catalog
    Then no inline user-facing literal is found
    And planting a prose literal at an envelope prose field should redden the check
    And planting a prose literal in a `cliMessage` variable should redden the check

  Rule: The envelope prose surface

    - Seven typed fields carry the prose Jolly prints, and the check is keyed on each field's resolved TYPE, never on its property name: `Envelope.summary`, `Check.description`, `Check.remediation`, `NextStep.description`, `ErrorEntry.message`, `ErrorEntry.remediation`, and `SkillSpec.description`. Name-keying over-matches, because the `@clack` prompt options carry a `message` property too and already render through the catalog. A literal counts when it is structurally one of these types even where TypeScript infers the shape rather than declaring it.
    - `Envelope.summary` reaches the envelope two ways: as a property, and as `errorEnvelope`'s second positional argument. A check that walks only property assignments silently misses the positional ones, so it must follow the argument too.
    - A catalog value may carry `{name}` placeholders the renderer fills with run values. Interpolated DATA — a thrown error's text, a store URL, a captured stderr, a count — is a placeholder and stays in code. Interpolated COPY is not: a word or phrase selected by a condition resolves through its own catalog key, so prose never hides inside a template as a fragment.
    - Prose handed to `cliMessage` as a variable is still prose. The check reddens on a prose literal inside a `cliMessage` call's variables; without that, the rule passes while inline copy still ships through the placeholder.
    - This is a testable conformance invariant about where Jolly's copy lives, not a product behavior — the same discriminator as the module-layering boundaries: testability decides admissibility, not whether the subject is the product or its structure.

  Rule: A key is a contract, resolved or refused

    - The join between code and catalog is total in both directions. A referenced key the catalog lacks would ship the word "undefined" as prose; a catalog entry no site references is dead copy that drifts unread.
    - The renderer refuses an unresolvable key loudly, naming the key. A silent fallback renders "undefined" on a human's screen, the output equivalent of a green check that proves nothing.

  @logic @property
  Scenario: Every referenced message key resolves and every catalog entry is referenced
    Given Jolly's source tree and the message catalog
    When every `cliMessage` key referenced in "src/" and "bin/" is joined against the catalog entries
    Then every referenced key should resolve to a catalog entry
    And every catalog entry should be referenced by at least one site
    And planting a reference to a key the catalog lacks should redden the check
    And planting a catalog entry no site references should redden the check

  @logic
  Scenario: A message key the catalog lacks fails loudly instead of rendering prose
    Given the message catalog has no entry for the key "start.noSuchKey"
    When the CLI renders the `start.noSuchKey` message
    Then the render should fail, naming "start.noSuchKey" as the missing key
    And no rendered output should carry the text "undefined"

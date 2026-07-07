Feature: Command surface stays consistent between help and the unknown-command error

  Jolly names its top-level command surface in two invocation-style places that
  must agree: the `jolly --help` output and the unknown-command error. Today
  they disagree, help names "create store" while the unknown-command error names
  "create". A command added, renamed, or split in one but not the other misleads
  the agent driving Jolly. Shell completion is deliberately excluded here: it
  offers top-level tokens such as "auth" and "create" that a shell completes one
  word at a time, a different surface by design.

  @logic @property
  Scenario: Help and the unknown-command error name the same command set
    When the agent runs `jolly --help`
    And the agent runs `jolly frobnicate --json`
    Then the command set `jolly --help` advertises should equal the set the unknown-command error names

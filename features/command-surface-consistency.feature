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

  Rule: The command surface is declared once

    - A command name is written in four independent places today: the shell
      completion registration, the help output's command data, the dispatch
      switch, and the unknown-command remediation prose in the message
      catalog. Adding, renaming, or splitting a command means editing all four,
      and nothing joins them. The scenario above holds two of the four in
      agreement by hand.
    - The anchor that reveals the identity is the command name itself, which
      appears as a registration, a data string, a case label, and a prose
      token. One declared surface every site derives from would discharge this
      structurally instead of by enumeration.
    - The surface is every top-level command a user may invoke: help, login,
      logout, auth, init, start, create, storefront, recipe, stock, stripe,
      deploy, doctor, upgrade, skills, and completion. The five stage commands
      are on it because feature 029 makes each stage a first-class command, so
      a surface that hides them contradicts the feature that specifies them.
    - The surface names top-level commands, so `auth` is the entry and `status`
      is its subcommand, exactly as `create` carries its own. A two-word entry
      would put a subcommand on a surface whose other entries are commands.
    - Two invocations stay off the surface: the no-argument default, which is
      help reached without naming it, and `complete`, which a shell calls at
      completion time and a human never types.

  @logic @property
  Scenario: Every command site derives from one declared command surface
    Given the command surface Jolly declares
    When the completion registration, the help command data, the dispatch cases, and the unknown-command remediation are each read
    Then each site's command set should equal the declared surface
    And a command present in one site and absent from another should redden the check, naming the command and the site missing it

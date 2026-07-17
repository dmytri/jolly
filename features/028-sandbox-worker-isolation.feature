Feature: Sandbox worker isolation
  As the maintainer of Jolly's verification suite
  I want parallel @sandbox workers to share ambient state safely, with every worker-created resource namespaced and the licensed spends serialized
  So that the light query scenarios run fast in parallel while no two full toolchain chains pile onto the instance at once

  Rule: Shared ambient state, namespaced creation, licensed spends serial
    - AGENTS.md "Sandbox harness mechanics" is the binding contract. A run's
      workers coordinate so exactly one provisions or adopts the shared store and
      the rest adopt its derived values; ambient state no scenario asserts is
      provisioned once and shared, per feature verification-economy.
    - Anything a worker itself creates stays namespaced by run id and worker id —
      the harmless-by-design boundary — so a creating scenario never collides
      with a sibling worker's resources, and reclamation can positively identify
      every disposable leftover.
    - Sharing removes redundant provisioning, not concurrent load, and the
      binding constraint is the local test VM rather than the Saleor instance.
      A full toolchain chain (clone, install, configurator deploy, Vercel
      deploy) saturates this VM's CPU, memory, and network, so the licensed
      full-pipeline proofs (@pipeline) and the env-creating scenarios
      (@creates-env) run serially, and only the light query and check scenarios
      run in parallel.

  @logic @property
  Scenario: Two parallel sandbox workers provision distinct Saleor environments
    Given the @sandbox provisioner running under two different worker ids
    When each worker derives the Saleor environment it provisions
    Then the two workers derive different jolly-cannon-fodder-namespaced environment names

  @logic @property
  Scenario: Two parallel sandbox workers deploy to distinct Vercel projects
    Given the @sandbox harness running under two different worker ids
    When each worker derives the Vercel project it deploys to
    Then the two workers derive different jolly-cannon-fodder-namespaced Vercel project names

  @logic @property
  Scenario: The @sandbox tier serializes the licensed spends and parallelizes the light ones
    Given the project's cucumber run profiles
    When the @sandbox run profiles are enumerated
    Then the parallel @sandbox profile runs its workers in parallel and excludes the @pipeline and @creates-env scenarios
    And a separate profile runs the @pipeline and @creates-env scenarios serially

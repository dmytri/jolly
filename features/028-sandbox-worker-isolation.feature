Feature: Sandbox worker isolation
  As the maintainer of Jolly's verification suite
  I want each parallel @sandbox worker to provision its own isolated store, with heavy scenarios serialized
  So that the light query scenarios run in parallel while no two full jolly-start deploys pile onto the free instance at once

  Rule: Per-worker isolation, with a heavy/light phase split
    - AGENTS.md "Sandbox harness mechanics" is the binding contract. Each parallel
      worker provisions its own isolated jolly-cannon-fodder environment,
      namespaced by run id and worker id, so no two workers share a store. This
      feature makes the isolation clause executable: a harness that pins every
      worker onto one shared per-run store fails here, because two workers then
      derive the same environment name and the same Vercel project name.
    - Isolation removes cross-worker collision, not concurrent load. Measured
      against the free org, two workers each running a full jolly-start (provision,
      configurator deploy, storefront, Vercel) drive the instance to sustained
      not-serving, which no retry rides out. So the heavy scenarios (tagged @heavy)
      and the env-creating scenarios (@creates-env) run serially, and only the
      light query and check scenarios run in parallel across the two isolated
      worker environments.

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
  Scenario: The @sandbox tier serializes heavy scenarios and parallelizes the light ones
    Given the project's cucumber run profiles
    When the @sandbox run profiles are enumerated
    Then the parallel @sandbox profile runs its workers in parallel and excludes the heavy scenarios
    And a separate profile runs the heavy scenarios serially

Feature: Sandbox worker isolation
  As the maintainer of Jolly's verification suite
  I want each parallel @sandbox worker to provision its own isolated store
  So that concurrent jolly-start deploys never contend on one shared instance and the suite runs parallel on the free two-environment org

  Rule: Per-worker isolation on the two-environment budget
    - AGENTS.md "Sandbox harness mechanics" is the binding contract. The bulk
      store-touching @sandbox scenarios run in parallel with one isolated
      jolly-cannon-fodder environment per worker, so no two workers share a store
      and concurrent load never lands on one instance. This feature makes the
      isolation clause executable: a harness that pins every worker onto one shared
      per-run store fails here, because two workers then derive the same
      environment name and the same Vercel project name.
    - The free org holds two concurrent environments, so the bulk worker count is
      capped at two. The env-creating scenarios run in a serial second phase,
      tagged @creates-env, which needs the slot the parallel bulk frees.

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

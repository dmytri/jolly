Feature: Git provider support for deployment
  As a customer deploying a Jolly-created storefront
  I want GitHub to work by default while retaining support for other Git providers
  So that Vercel deployment can fit my preferred source control workflow

  Background:
    Given Vercel is the first deployment target
    And Git-based deployment may require or benefit from a remote Git repository

  Scenario: GitHub is the default provider
    Given the customer wants Git-backed deployment
    When Jolly asks about repository setup
    Then GitHub should be presented as the default Git provider
    And Jolly should support GitHub repository creation or configuration where possible
    And Jolly should explain any GitHub authentication or permission steps required

  Scenario: Customer chooses a different Git provider
    Given the customer does not want to use GitHub
    When Jolly asks about repository setup
    Then the customer should be able to use another Git provider
    And supported planning targets should include Codeberg, Tangled, SourceHut, and Bitbucket
    And Jolly should distinguish between providers it can automate and providers it can only guide manually
    And Jolly should still support Vercel deployment when the selected provider can be connected or imported

  Scenario: Agent handles unsupported Git providers
    Given the customer prefers a Git provider not explicitly supported by Jolly
    When the agent reaches repository setup
    Then Jolly should allow a generic Git remote flow where feasible
    And the agent should explain any limitations for Vercel import, webhooks, or automated deployment

  Rule: Git provider priorities
    - GitHub is the default Git provider for v1.
    - Jolly should be designed to support other Git providers, including Codeberg, Tangled, SourceHut, and Bitbucket.
    - Provider automation should be capability-based: automate when APIs/auth are supported, guide manually when they are not.
    - Git provider choice should not change the core Saleor Cloud, Paper, Configurator, or Stripe setup model.

  Rule: Open questions
    - Which non-GitHub providers should have first-class automation in v1 versus guided manual instructions?
    - Should Git provider setup be a separate command or part of `jolly create deployment` / `jolly deploy`?
    - What provider capability matrix should Jolly expose to agents?

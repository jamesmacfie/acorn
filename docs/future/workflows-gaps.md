# Workflow gaps

Date: October 4, 2026. Status: proposed.

These are known gaps in workflows:

- The graph has no groups, no minimap, and no labels on its edges, so a definition larger than a
  screen is read by panning.
- A run pane node shows what a step last said, not a rendered view of the prompt it was given, though
  the run holds the prompt.
- The desktop must be open for UI interaction, although the Node keeps working while the renderer is
  closed, including the trigger sweep.
- A failed node is retried by hand through the retry route. An operation whose external outcome is
  unknown isn't retried automatically, because acorn can't tell a side effect that landed from one that
  didn't.
- An agent can't start or drive a workflow run, because no workflow control tool is registered.
  The `agent_*` tools drive managed sessions only.
- Repository and user workflow files don't get an implicit trigger from their contents. Only a
  published database workflow can have an owner-approved Node schedule.

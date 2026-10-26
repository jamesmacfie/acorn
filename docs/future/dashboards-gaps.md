# Dashboard followup work

Date: October 26, 2026. Status: what remains after the October 26 followups.

Use this page to pick up unfinished dashboard work. [The panel editor](../dashboards/mapping-and-editor.md)
and [derived sources](../data-sources/derived-sources.md) own implemented behavior. Recheck each gap
against the code before building.

Keep `PanelPlan` version 2 and published revision digests compatible. The Node executes plans;
the client displays results. Use host components for controls and keep plugin code in data-source
handlers. A studio opening from a task must preserve that task's panes and terminal drawer.

## Done on October 26, 2026

- A run's `diagnostics.filters` says whether each filter step ran in the source or in the panel, and
  the step inspector words it, naming a source that returned only part of its records.
- A studio preview's table header has an **Ask AI about this** menu for plan columns. Under review,
  the outline marks the proposed plan's own problems and drops them when review ends.
- GitHub's local-branches source stays a compiled exception. The reasons are in
  [derived sources](../data-sources/derived-sources.md#limits-and-known-gaps).

## Walk the changes in the desktop driver

The work above was checked with unit and component tests only. Use the
[isolated desktop driver](../local-development/agent-drivers.md) to check, with a real source:

- The filter note on a filter step, for a source that applies it and one that doesn't, against the
  preview's 25-record read.
- The column header menu by keyboard, and at a narrow preview width.
- Proposal problem marks, with a reply arriving after the plan changed. Record the model backend.

## Assess the relations inspector

The relations inspector did not receive the usability rewrite applied to the other inspectors.
Assess it with a real multi-source panel before proposing changes to its forms.

## Move the Workflows conversation to a dock

Workflows uses the shared authoring conversation in a modal. Moving it to a dock needs its own
proposal comparison and layout design. Treat that as a separate Workflows task; preserve its
approval and publish rules.

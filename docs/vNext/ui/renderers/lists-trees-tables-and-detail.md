# Lists, trees, tables and detail

Status: Normative<br>
Requirement prefix: `UI-COLLECTION`

## Shared collection contract

- **UI-COLLECTION-001:** Every item has a stable opaque ID, accessible primary label, optional
  secondary/status projection, resource reference and declared actions.
- **UI-COLLECTION-002:** Collections declare source revision, total when known, paging cursor,
  sort/filter model, selection mode, empty/error state and item sensitivity.
- **UI-COLLECTION-003:** Maximum delivered page is 2,000 items or 8 MiB, whichever comes first.
  Host may request smaller pages and virtualize visible content.
- **UI-COLLECTION-004:** Selection stores stable IDs, not row indexes. Removing selected items
  updates selection predictably and announces the change.
- **UI-COLLECTION-005:** Sort/filter values are typed requests to a declared data source. UI labels
  and column text never become SQL or provider query fragments directly.

## List and detail

- **UI-COLLECTION-006:** `list` rows support leading icon/status, primary/secondary text, badges,
  trailing actions and one primary navigation/select action. Nested arbitrary layout is prohibited.
- **UI-COLLECTION-007:** `virtualList` adds estimated host row metric, overscan policy and total/
  loaded semantics. Keyboard and assistive access work beyond mounted rows.
- **UI-COLLECTION-008:** `detail` is sections of key/value, status, content and actions linked to
  one resource/version. Mutation refreshes or patches by resulting version.
- **UI-COLLECTION-009:** Master/detail uses separate selection binding and detail query so a large
  list document never embeds all detail bodies.

## Trees

- **UI-COLLECTION-010:** Tree nodes have stable ID, parent relation, label, kind, expandable state,
  child-loading state, resource reference and actions. Cycles and duplicate ancestry are invalid.
- **UI-COLLECTION-011:** Lazy expansion invokes a declared bounded child query with parent resource
  and revision. The Node reauthorizes child visibility.
- **UI-COLLECTION-012:** Tree keyboard behavior follows platform tree conventions: arrows,
  Home/End, type-ahead and focus distinct from selection.
- **UI-COLLECTION-013:** Drag-and-drop is available only when a declared move command supplies
  valid target classes, precondition and keyboard equivalent.

## Tables and data grids

Column types are text, number, boolean, date/time, duration, status, badge list, resource link,
monospace, JSON summary and action.

- **UI-COLLECTION-014:** Columns declare stable ID, accessible header, type, alignment, sortable/
  filterable flags, width class, sensitivity and cell fallback. Arbitrary cell components are
  invalid.
- **UI-COLLECTION-015:** Table is for bounded non-virtual data; data grid supports virtual rows,
  sticky header, paging, server sort/filter and selection. Maximum columns is 100.
- **UI-COLLECTION-016:** Values preserve types over the wire. Formatting is locale/renderer-owned;
  display strings are not parsed back into command input.
- **UI-COLLECTION-017:** JSON cells display a bounded tree/summary with depth and byte limits;
  prototype-like keys are inert text.
- **UI-COLLECTION-018:** Export is a Node command or host copy intent with permission, row/byte cap,
  sensitivity warning and safe file destination. A renderer never synthesizes unrestricted CSV
  from hidden rows.
- **UI-COLLECTION-019:** Tabular/code geometry uses host metrics and monospace where alignment is
  semantic. Theme/style cannot change measured row height without renderer remeasurement.

## Acceptance

- **UI-COLLECTION-020:** Tests MUST cover large paging/virtualization, cursor expiry, sort/filter
  injection, selection during patches, lazy tree cycles, keyboard move, 100-column grid, typed
  formatting, malicious JSON keys, sensitive export and compact card/detail fallback.

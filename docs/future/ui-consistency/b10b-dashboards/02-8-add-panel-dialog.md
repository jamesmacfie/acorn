# 02-8. The Add panel dialog shows a raw workspace id and a preview that does not match the panel

**Status:** not started. Batch B10b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The Add panel dialog's first line is "Workspace: 0b4db4d0-a9aa-430b-…", beside a lower-case "not saved"
badge made from the save state's id. The preview is a hand-built box with no padding, so it does not
look like the placed panel, which is a `Card`. The unavailable-view reasons are cut off with an
ellipsis. **Use exact source states** and **Add board column** show while the view is List, where they
do nothing. **Publish** is enabled before any data is chosen. This is the only thing Home asks a new user
to do, and it opens on an internal id.

## Where to see it

Home › **Add panel**. Do not press **Send** in the AI authoring box; it calls a model.

## Already done

- K1a's 04-6 stopped **Remove data query** and **Add another query** stretching to the column's width.
- K4b made **Close** ghost (it stays **Close**, because the draft is kept on the device).
- K2's 00-8 made fold summaries static, so the AI authoring summary no longer sticks over **Send**.
- K1a's 00-20b gave the prompt box a token pad.

## The fix

In `packages/client-core/src/features/dashboards/DashboardEditor.tsx` and `dashboards.css`:

- `:246`: remove "Workspace: {uuid}".
- `:245`: words for all five `SaveState` values.
- `dashboards.css:18-25`: the preview draws in a `Card` with the panel's pad (the default 14 after
  [10-14](./10-14-panel-frame.md)).
- `:240-356`: **Remove data query** and **Add another query** in an `Inline`. Unavailable-view reasons
  wrap. **Use exact source states** and **Add board column** show only for the board view.
- `:358`: **Publish** disabled until a query has a source.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `DashboardEditor.tsx:246` | Workspace: {uuid} | Remove | |
| `DashboardEditor.tsx:245` | not saved (the save state's id) | Rewrite | Words for all five save states, for example "Not saved", "Saving…", "Saved". Read `SaveState` for the full list. |
| `DashboardEditor.tsx:283` | Display changes redraw the retained preview without querying the source. | Remove | |
| `DashboardEditor.tsx:288` | board: Needs a mapped status or other finite field. / chart: Needs a status/category field for bars or a datetime field for a line. | Rewrite, wrap | "Board needs a status or other field with a fixed set of values." / "Chart needs a status, category, or date field." |
| `DashboardEditor.tsx:347` | Preview ready after refresh. Configure each query, then choose Refresh preview. Display changes use those retained records. | Rewrite | Title "No preview yet". Body "Choose **Refresh preview** on each query to see it here." |
| `AuthoringConversation.tsx:158` | Only source metadata is shared. Preview record contents stay off. | Rewrite after checking | "The AI sees your field names, not your records." Check first that this is exactly what the AI sees. |
| `DashboardEditor.tsx:274, 277` | Remove data query / Add another query | Keep | |
| `DashboardEditor.tsx:240` | Add dashboard panel / Edit dashboard panel | Rewrite | Add panel / Edit panel |
| `DashboardEditor.tsx:98` | This dashboard draft could not be loaded. Its placement remains unchanged. | Rewrite | Couldn't load this panel's draft. The panel on your dashboard hasn't changed. |
| `DashboardEditor.tsx:136` | The draft changed elsewhere or the Node could not save it. Your local copy is retained. | Rewrite | Couldn't save. The panel changed somewhere else, or the node didn't answer. Your edits are kept on this computer. |
| `DashboardEditor.tsx:217` | Choose at least one complete data query before publishing. | Rewrite | Choose what to show before you publish. |
| `DashboardEditor.tsx:204` | The dashboard changed while AI was working: {paths}. | Rewrite | This panel changed since you opened it. |
| `DashboardEditor.tsx:206, 208` | The reconciled dashboard no longer has a valid typed shape. / The reconciled dashboard is no longer valid. | Rewrite | The AI's suggestion doesn't fit this panel, so it wasn't applied. |
| `DashboardEditor.tsx:263` | Undo AI edit | Keep | |

The plan's overrules: row 589 keeps "a status or other field with a fixed set of values"; row 590 keeps
"Choose **Refresh preview** on each query to see it here."; row 591 needs the check above; row 587 needs
words for all five states; row 721 reads "This panel changed since you opened it.", because the change
may come from another device.

## Risk and checks

- Before you start, read `SaveState` and the AI authoring request to confirm what the AI receives.
- `AuthoringConversation.tsx` is shared with the workflow editor. B07b gave it `onClose`, which draws
  it as a modal body and footer with **Send** in the footer, and `describePath`. The panel editor still
  uses the fold form; see [deferred.md](../deferred.md) § B07b.
- Screens: the Add panel dialog before and after choosing a source, and the board view.
- Tests: the client-core dashboards tests.

import { Show } from 'solid-js'
import { Card, EmptyState } from '../ui/primitives'
import type { PanelDraft } from './draft'
import PanelBody from './views/PanelBody'
import './dashboards.css'

// THE WIZARD'S LIVE PREVIEW (docs/future/dashboards/wizard.md § The live preview) — the draft panel,
// drawn by the REAL view components over the real compose/mapping/shaping pipeline, in a fixed slot.
// Not a thumbnail renderer: there is exactly one way to draw a panel (views/PanelBody.tsx) and this is
// that way, which is what makes "the committed panel is what you were looking at" true by
// construction rather than by care.
//
// Three things it deliberately is not:
//
//   IT FETCHES NOTHING. Its rows are whatever this device has cached, reactive to the cache revision
//   so an answer landing mid-compose fills it in place (draft.ts § pages). Whether an editor may RUN a
//   collection to learn its shape is the run-once-and-pin question and it is answered once, by a
//   person pressing a button (docs/future/dashboards/dynamic-collections.md). When that ships its
//   button belongs on the Data step, not here.
//
//   IT DOES NOT POLL AND IT DOES NOT ACT. No refresh timer, no freshness badge, no risk strip, and
//   row actions are inert — a preview is a rendering of a draft, not a placed panel. `panelId` is
//   withheld for the same reason: a stat's recorded trend is a read keyed by it, and a draft that has
//   never existed has no series to ask for.
//
//   IT IS NOT A SECOND EMPTY-STATE VOCABULARY. The cold case says what the sheet's own notice says,
//   because it is the same fact about the same collection.

export default function PanelPreview(props: { draft: PanelDraft }) {
  const draft = () => props.draft
  return (
    <div class="dash-preview" aria-label="Panel preview">
      <Card class="dash-panel" pad="sm">
        <div class="dash-panel-head">
          <span class="dash-panel-title">{draft().definition().title || 'Untitled panel'}</span>
        </div>
        <div class="dash-panel-body">
          <Show
            when={draft().ready()}
            fallback={<EmptyState align="start" size="sm">Pick a collection to see the panel.</EmptyState>}
          >
            <Show
              when={draft().preview.answered()}
              fallback={(
                <EmptyState align="start" size="sm" title="Nothing read on this device yet">
                  This collection describes itself in the answer. Add the panel and it fills in as soon
                  as it loads.
                </EmptyState>
              )}
            >
              <PanelBody
                view={draft().definition().view}
                schema={draft().preview.schema()}
                fields={draft().preview.fields()}
                rows={draft().preview.rows()}
                {...(draft().definition().shaping.groupBy ? { groupBy: draft().definition().shaping.groupBy } : {})}
                {...(draft().queries().length > 1 ? { provenance: true } : {})}
                onActivate={() => {}}
              />
            </Show>
          </Show>
        </div>
      </Card>
    </div>
  )
}

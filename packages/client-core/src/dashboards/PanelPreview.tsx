import { Show } from 'solid-js'
import { Card, EmptyState } from '../ui/primitives'
import type { PanelDraft } from './draft'
import PanelBody from './views/PanelBody'
import './dashboards.css'

// The wizard's live preview (docs/dashboards.md § The generated editor): the draft panel, drawn by the real view
// components over the real compose, mapping and shaping pipeline, in a fixed slot. Not a thumbnail
// renderer: there's exactly one way to draw a panel (views/PanelBody.tsx) and this is that way, which
// makes "the committed panel is what you were looking at" true by construction.
//
// Three things it deliberately isn't:
//
//   It fetches nothing. Its rows are whatever this device has cached, reactive to the cache revision so
//   an answer landing mid-compose fills it in place (draft.ts § pages). Whether an editor may run a
//   collection to learn its shape is the run-once-and-pin question, answered by a person pressing a
//   button (docs/future/dashboards/dynamic-collections.md), and that button belongs on the Data step.
//
//   It doesn't poll and it doesn't act. No refresh timer, no freshness badge, no risk strip, and row
//   actions are inert. `panelId` is withheld for the same reason: a stat's recorded trend is a read
//   keyed by it, and a draft that has never existed has no series to ask for.
//
//   It isn't a second empty-state vocabulary. The cold case says what the sheet's own notice says,
//   because it's the same fact about the same collection.

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

import { Show } from 'solid-js'
import type { CollectionContribution } from '../registries/collections'
import { Button, Field, SegmentedControl } from '../ui/primitives'
import { Modal } from '../ui/Modal'
import Picker from '../ui/Picker'
import { createPanelDraft } from './draft'
import { viewsFor } from './editor'
import type { PanelDefinition, PanelViewKind } from './model'
import {
  ColdNotice,
  GroupByField,
  LimitField,
  MappingSection,
  ParamInputs,
  RefreshField,
  ShapingSection,
  SourceRows,
  TitleField,
  ViewOptions,
  VIEW_LABELS,
} from './PanelForm'
import './dashboards.css'

// THE panel editor as ONE SHEET (docs/dashboards.md § The generated editor) — every decision at once,
// in one scroll, for a panel that already exists.
//
// It is the EDIT path. Creation is staged instead (PanelWizard.tsx), because nobody can pick a view by
// reading a select — but this remains able to do everything the wizard can: the wizard is a staging of
// creation, not a capability tier. Both render the same sections over the same draft (PanelForm.tsx,
// draft.ts), so there is no second implementation of any rule here.
//
// It still serves the add flow when there is no wizard to open it from — `panel` absent is a fresh
// draft, exactly as it always was, which is also what the wizard's "Open in editor" escape hands over.

export default function PanelEditor(props: {
  collections: readonly CollectionContribution[]
  /** The view kinds a plugin-reserved region allows, when composing into one (dashboards/region.ts).
   *  Absent on the user's own surfaces, which allow every view the data supports. */
  views?: readonly PanelViewKind[]
  /** Absent for the add flow. */
  panel?: PanelDefinition
  /** A panel handed over mid-creation by the wizard: it has a definition but has never been saved,
   *  so the words are the add flow's even though there is a draft to edit. */
  creating?: boolean
  onSave: (panel: PanelDefinition) => void
  onClose: () => void
}) {
  const draft = createPanelDraft(props)
  const existing = draft.existing
  /** The WORDS, which are about whether this panel has ever been saved rather than about whether
   *  there is a draft to edit — the wizard hands over both at once. */
  const creating = () => !existing || !!props.creating

  let pickerHost: HTMLDivElement | undefined
  let titleBox: HTMLInputElement | undefined

  const submit = () => {
    if (!draft.ready()) return
    props.onSave(draft.definition())
    props.onClose()
  }

  return (
    <Modal
      title={creating() ? 'Add panel' : 'Edit panel'}
      size="md"
      onClose={props.onClose}
      // The collection is the first decision for a new panel and already made for an existing one, so
      // the two flows want different landing spots. A bare `autofocus` does not survive a Solid modal
      // (ui/Modal.tsx).
      autoFocus={() => (existing ? titleBox : pickerHost?.querySelector<HTMLElement>('button')) ?? undefined}
      onKeyDown={(event) => {
        if (!(event.key === 'Enter' && (event.metaKey || event.ctrlKey))) return false
        submit()
        return true
      }}
    >
      <Modal.Body class="dash-editor">
        <Field
          label={draft.queries().length > 1 ? 'Collections' : 'Collection'}
          hint="Add a second one and the panel unions their rows. Grouped by the plugin that provides it."
        >
          <SourceRows draft={draft} />
          <div class="dash-add-picker" ref={pickerHost}>
            <Picker<CollectionContribution>
              label={draft.queries().length ? 'Add a collection' : 'Choose a collection'}
              ariaLabel="Collection"
              placeholder="Filter collections"
              emptyText="No collection matches."
              results={draft.addable}
              rowLabel={(entry) => entry.name}
              rowDescription={(entry) => entry.pluginId}
              // Nothing is ever active: `addable` already drops what the panel holds, so the list is
              // exactly what may still be added.
              isActive={() => false}
              onSelect={draft.addSource}
            />
          </div>
        </Field>

        <ColdNotice draft={draft} />

        <Show when={draft.queries().length}>
          <TitleField draft={draft} ref={(el) => { titleBox = el }} />

          <Field label="View" hint="Only the views this panel's fields can support.">
            <SegmentedControl<PanelViewKind>
              ariaLabel="View"
              size="sm"
              value={draft.view().kind as PanelViewKind}
              onChange={draft.chooseView}
              options={viewsFor({ schema: draft.schema() }, undefined, props.views)
                .map((kind) => ({ value: kind, label: VIEW_LABELS[kind] }))}
            />
          </Field>

          <GroupByField draft={draft} />
          <ViewOptions draft={draft} />
          <MappingSection draft={draft} />
          <ParamInputs draft={draft} />
          <ShapingSection draft={draft} />

          <div class="dash-editor-pair">
            <LimitField draft={draft} />
            <RefreshField draft={draft} />
          </div>
        </Show>
      </Modal.Body>

      <Modal.Actions>
        <Button variant="bare" onClick={props.onClose}>Cancel</Button>
        <Button variant="solid" tone="accent" disabled={!draft.ready()} onClick={submit}>
          {creating() ? 'Add panel' : 'Save'}
        </Button>
      </Modal.Actions>
    </Modal>
  )
}

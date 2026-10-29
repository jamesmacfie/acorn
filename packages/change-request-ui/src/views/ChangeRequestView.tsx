import { Show, type JSX } from 'solid-js'
import { Sections, Stack } from '@acorn/plugin-api/ui'
import type { Check } from '../model/types'
import type { ChangeRequestModel } from './detailModel'
import { ChangeRequestOverview } from './Overview'
import { ChangeRequestDescription, changeRequestSections } from './sections'

// One change request: its overview, its sections, and its diff. The split is the `Sections` node's,
// so the view that knows what a change request is made of says so, and the host decides whether the
// diff gets a column beside the tabs or a tab of its own (docs/ui-design/closed-kit.md § The closed
// kit). A browse surface and a task pane draw the same view, with their own diff and file selection.
export function ChangeRequestView(props: {
  /** The `Sections` id, such as `github.pull`. */
  id: string
  model: ChangeRequestModel
  /** Drawn above the overview, such as a strip of related change requests. */
  header?: () => JSX.Element
  hideNumber?: boolean
  currentFile: () => string | undefined
  onOpenFile: (path: string) => void
  onLinkClick: (event: MouseEvent) => void
  diff: () => JSX.Element
  diffActions?: () => JSX.Element
  /** The change request's own verbs, such as a refresh. At the end of the tab strip, whichever tab is
   *  open, because they act on every tab at once. */
  actions?: () => JSX.Element
  /** The host's step log for a check row the reader opened. A row opens only when its check has a
   *  `runId`, so a host whose checks have no log, such as Bitbucket's build statuses, passes none. */
  checkPanel?: (check: Check, close: () => void) => JSX.Element
}) {
  const noun = () => props.model.host.noun
  // The strip draws only the open tab's actions, so every tab carries the same ones. No section here
  // has actions of its own to lose.
  const actions = () => (props.actions ? { actions: props.actions } : {})
  return (
    <>
      <Sections
        id={props.id}
        ariaLabel={noun().charAt(0).toUpperCase() + noun().slice(1)}
        header={{
          id: 'details',
          label: 'Details',
          ...actions(),
          render: () => (
            <Stack gap="section">
              {props.header?.()}
              <ChangeRequestOverview
                model={props.model}
                onOpenFile={props.onOpenFile}
                onLinkClick={props.onLinkClick}
                hideNumber={props.hideNumber}
              />
              <ChangeRequestDescription model={props.model} onLinkClick={props.onLinkClick} />
            </Stack>
          ),
        }}
        sections={changeRequestSections({
          model: props.model,
          currentFile: props.currentFile,
          onOpenFile: props.onOpenFile,
          onLinkClick: props.onLinkClick,
        }).map((section) => ({ ...section, ...actions() }))}
        main={{
          id: 'diff',
          label: 'Diff',
          ...(props.diffActions ? { actions: props.diffActions } : {}),
          render: props.diff,
        }}
      />
      {/* The one overlay this view owns: a check's step log, opened from a check row. */}
      <Show when={props.model.openCheck()}>
        {(check) => props.checkPanel?.(check(), () => props.model.setOpenCheck(null))}
      </Show>
    </>
  )
}

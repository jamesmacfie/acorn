import { createEffect, Show } from 'solid-js'
import type { Accessor } from 'solid-js'
import type { DiffFindController } from './findController'
import type { ViewMode } from '../ui/diff/model'
import { FindBar } from '../ui/FindBar'
import { SegmentedControl, ToggleButton } from '../ui/primitives'
import { tip } from '../ui/tips'

export function DiffToolbar(props: { find: DiffFindController; viewMode: Accessor<ViewMode>; setViewMode: (mode: ViewMode) => Promise<void> }) {
  let findInput: HTMLInputElement | undefined
  createEffect(() => {
    props.find.findFocusTick()
    if (props.find.findOpen() && findInput) {
      findInput.focus()
      findInput.select()
    }
  })

  return (
    <div class="diff-toolbar">
      <Show when={props.find.findOpen()}>
        <FindBar
          class="diff-find"
          ref={(element) => { findInput = element }}
          placeholder="Find in diff…"
          query={props.find.findQuery()}
          onQuery={props.find.setFindQuery}
          count={props.find.findQuery()
            ? { current: props.find.matches().length ? props.find.matchIdx() + 1 : 0, total: props.find.matches().length }
            : undefined}
          onNext={() => props.find.gotoMatch(1)}
          onPrev={() => props.find.gotoMatch(-1)}
          onClose={props.find.closeFind}
          toggles={
            <ToggleButton
              variant="bare"
              size="sm"
              class="diff-find-btn"
              {...tip('Match case')}
              pressed={props.find.findCase()}
              onPressedChange={(pressed) => props.find.setFindCase(pressed)}
            >
              Aa
            </ToggleButton>
          }
        />
      </Show>
      {/* aria-pressed on two mutually exclusive buttons said "two independent toggles"; this is one
          value with two options, which is a radiogroup, and it gains arrow keys. */}
      <SegmentedControl
        class="diff-viewmode"
        ariaLabel="Diff view mode"
        size="sm"
        value={props.viewMode()}
        onChange={(mode) => void props.setViewMode(mode)}
        options={[
          { value: 'unified', label: 'Unified' },
          { value: 'split', label: 'Split' },
        ]}
      />
    </div>
  )
}

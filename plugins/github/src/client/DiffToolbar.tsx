import { createEffect, Show } from 'solid-js'
import type { DiffFindController } from './DiffFindController'
import type { Accessor } from 'solid-js'
import type { ViewMode } from '@acorn/client-core/ui/diff/model.ts'

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
        <div class="diff-find" role="search">
          <input
            ref={findInput}
            class="diff-find-input"
            type="text"
            placeholder="Find in diff…"
            value={props.find.findQuery()}
            onInput={(e) => props.find.setFindQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                props.find.gotoMatch(e.shiftKey ? -1 : 1)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                props.find.closeFind()
              }
            }}
          />
          <span class="diff-find-count">{props.find.findQuery() ? `${props.find.matches().length ? props.find.matchIdx() + 1 : 0}/${props.find.matches().length}` : ''}</span>
          <button type="button" class="diff-find-btn" title="Previous match (⇧⏎)" disabled={!props.find.matches().length} onClick={() => props.find.gotoMatch(-1)}>
            ↑
          </button>
          <button type="button" class="diff-find-btn" title="Next match (⏎)" disabled={!props.find.matches().length} onClick={() => props.find.gotoMatch(1)}>
            ↓
          </button>
          <button type="button" class="diff-find-btn" classList={{ active: props.find.findCase() }} title="Match case" onClick={() => props.find.setFindCase((value) => !value)}>
            Aa
          </button>
          <button type="button" class="diff-find-btn" title="Close (Esc)" onClick={props.find.closeFind}>
            ✕
          </button>
        </div>
      </Show>
      <div class="diff-viewmode" role="group" aria-label="Diff view mode">
        <button type="button" class="diff-viewmode-btn" classList={{ active: props.viewMode() === 'unified' }} aria-pressed={props.viewMode() === 'unified'} onClick={() => void props.setViewMode('unified')}>
          Unified
        </button>
        <button type="button" class="diff-viewmode-btn" classList={{ active: props.viewMode() === 'split' }} aria-pressed={props.viewMode() === 'split'} onClick={() => void props.setViewMode('split')}>
          Split
        </button>
      </div>
    </div>
  )
}

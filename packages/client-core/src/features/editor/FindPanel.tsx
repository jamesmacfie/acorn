import { Show, type Accessor } from 'solid-js'
import { render } from 'solid-js/web'
import type { SearchQuery } from '@codemirror/search'
import { Button } from '../../kit/components/inputs/Button'
import { FindBar } from '../../kit/components/inputs/FindBar'
import { IconButton } from '../../kit/components/inputs/IconButton'
import { Input } from '../../kit/components/inputs/Input'
import { ToggleButton } from '../../kit/components/inputs/ToggleButton'
import Icon from '../../kit/components/content/Icon'
import { Toolbar } from '../../kit/components/layout/Toolbar'

// The editor's find panel as kit controls. It draws what ./search.ts reads out of CodeMirror and hands
// every action back to it; nothing here holds a query of its own.

/** CodeMirror's search state, read out for display. */
export type FindSnapshot = {
  query: SearchQuery
  readOnly: boolean
  /** Absent while the query is empty or invalid. `more` means counting stopped at the ceiling. */
  count?: { current: number; total: number; more: boolean }
  error?: string
}

export type FindPanelProps = {
  snapshot: Accessor<FindSnapshot>
  /** Whether the replace row is open. */
  replacing: Accessor<boolean>
  setReplacing: (replacing: boolean) => void
  /** The find input, for the engine to focus and select. */
  field: (element: HTMLInputElement) => void
  replaceField: (element: HTMLInputElement) => void
  change: (patch: { search?: string; replace?: string; caseSensitive?: boolean; wholeWord?: boolean; regexp?: boolean }) => void
  next: () => void
  previous: () => void
  selectAll: () => void
  replaceNext: () => void
  replaceAll: () => void
  close: () => void
}

function FindPanel(props: FindPanelProps) {
  const query = () => props.snapshot().query
  const noMatches = () => !props.snapshot().count?.total
  const option = (o: { label: string; icon: string; key: 'caseSensitive' | 'wholeWord' | 'regexp' }) => (
    <ToggleButton variant="bare" size="sm" iconOnly label={o.label} tip={o.label} pressed={query()[o.key]} onPressedChange={(on) => props.change({ [o.key]: on })}>
      <Icon name={o.icon} />
    </ToggleButton>
  )
  return (
    <>
      <FindBar
        ref={(element) => {
          // CodeMirror's marker for the field its open-search command focuses and selects.
          element.setAttribute('main-field', 'true')
          props.field(element)
        }}
        query={query().search}
        onQuery={(search) => props.change({ search })}
        count={props.snapshot().count}
        error={props.snapshot().error}
        onNext={props.next}
        onPrev={props.previous}
        onClose={props.close}
        toggles={
          <>
            <Toolbar.Group>
              {option({ label: 'Match case', icon: 'case-sensitive', key: 'caseSensitive' })}
              {option({ label: 'Whole word', icon: 'whole-word', key: 'wholeWord' })}
              {option({ label: 'Regular expression', icon: 'regex', key: 'regexp' })}
            </Toolbar.Group>
            <IconButton icon="text-cursor-input" label="Select all matches" disabled={noMatches()} onPress={props.selectAll} />
            <Show when={!props.snapshot().readOnly}>
              <IconButton icon="replace" label="Replace" expanded={props.replacing()} onPress={() => props.setReplacing(!props.replacing())} />
            </Show>
          </>
        }
      />
      <Show when={props.replacing() && !props.snapshot().readOnly}>
        <Toolbar size="sm" ariaLabel="Replace">
          <Input
            ref={props.replaceField}
            kind="filter"
            label="Replace"
            placeholder="Replace…"
            assist={false}
            value={query().replace}
            onInput={(replace) => props.change({ replace })}
            onSubmit={props.replaceNext}
          />
          <Button size="sm" disabled={noMatches()} onPress={props.replaceNext}>Replace next</Button>
          <Button size="sm" disabled={noMatches()} onPress={props.replaceAll}>Replace all</Button>
        </Toolbar>
      </Show>
    </>
  )
}

/** Draw the panel into CodeMirror's element and hand back the disposer its `destroy` calls. */
export const renderFindPanel = (element: HTMLElement, props: FindPanelProps): (() => void) =>
  render(() => <FindPanel {...props} />, element)

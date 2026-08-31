/** @jsxImportSource @opentui/solid */
import { Show } from 'solid-js'
import type { LayoutProps } from '@acorn/client-core/host/layouts/regions.ts'
import { Button } from '../kit/asking'
import { Line } from '../kit/cells'
import { regionFocus } from '../keys/regions'

// `wizard`: one step at a time, the step count on the header line, the actions on the footer line
// (docs/panes.md § Layout model). Its projection is "unchanged", and the only thing a terminal cannot
// spend is the horizontal room a numbered indicator takes, so the indicator is `Step 2 of 5 · Repos`.
//
// The plugin owns which step it is on and what happens when someone advances; the host owns the
// chrome, which is the part every wizard drew twice.
export function Wizard(props: LayoutProps) {
  const steps = () => props.steps ?? []
  const at = () => steps().findIndex((step) => step.id === props.current)

  const step = (offset: number) => {
    const next = steps()[at() + offset]
    if (next) props.onStep?.(next.id)
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      <Show when={steps().length}>
        <Line role="eyebrow">
          {`Step ${at() + 1} of ${steps().length} · ${steps()[at()]?.label ?? ''}`}
        </Line>
      </Show>
      <box flexDirection="column" flexGrow={1} ref={regionFocus({ paneId: props.stateKey, regionId: 'step' }, 0)}>
        {props.regions.step?.()}
      </box>
      <box flexDirection="row" gap={1}>
        <box flexGrow={1} />
        <Show when={at() > 0}><Button variant="bare" onPress={() => step(-1)}>Back</Button></Show>
        <Show when={at() >= 0 && at() < steps().length - 1}>
          <Button tone="accent" disabled={props.canAdvance === false} onPress={() => step(1)}>Next</Button>
        </Show>
      </box>
    </box>
  )
}

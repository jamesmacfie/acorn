import { Alert } from '../../ui/primitives'

/**
 * What the reader sees where a remote tree could not be drawn: a node this build has never heard of,
 * a batch over the caps, a worker that threw or stopped answering.
 *
 * Named, never blank. This is the forward-compatibility rule docs/plugins.md already has for
 * declarations, applied to drawing: a plugin written for a later acorn says so where it would have
 * been, and the surface around it keeps working.
 *
 * The kit's own Alert rather than a stylesheet of its own, so the placeholder is dressed by whichever
 * style pack is on, in a plugin's frame as in a first-party pane.
 */
export function TreePlaceholder(props: { pluginId: string; detail?: string }) {
  return (
    <Alert variant="inline" tone="warn">
      {`Part of ${props.pluginId} this version of acorn cannot draw`}
      {props.detail ? ` — ${props.detail}` : ''}
    </Alert>
  )
}

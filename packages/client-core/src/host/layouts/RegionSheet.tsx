import { createSignal, Show, type JSX } from 'solid-js'
import { Button } from '../../kit/components/primitives'
import { Drawer } from '../../kit/components/overlays/Drawer'
// Imported for `use:regionFocus` below: Solid compiles a directive to a bare reference, so the
// import has to be here even though nothing calls it.
// eslint-disable-next-line no-unused-vars -- used by the `use:regionFocus` directive.
import { regionFocus } from '../keys/focusRegions'

// A narrow layout's second region as a sheet over the first: a bar with **Show panel** where the split
// would have been, and the region in a full-height `Drawer` once it is pressed (docs/panes/layout.md
// § Named layouts). `document-over-frame`, `frame-beside-document` and `stack-split` share it.
//
// The region mounts when the sheet opens and goes when it closes, so a closed sheet costs nothing. A
// region that has to keep its state across a close keeps it in the pane's model.
export function RegionSheet(props: { stateKey: string; regionId: string; label: string; children: JSX.Element }) {
  const [open, setOpen] = createSignal(false)
  return (
    <>
      <div class="layout-sheet-bar">
        <Button variant="bare" label="Show panel" opens="dialog" expanded={open()} onPress={() => setOpen(true)} />
      </div>
      <Show when={open()}>
        <Drawer height={0} maximized ariaLabel={`${props.label} panel`}>
          <div class="layout-sheet-bar">
            <Button variant="bare" label="Close" onPress={() => setOpen(false)} />
          </div>
          <div class="layout-sheet-body" use:regionFocus={{ paneId: props.stateKey, regionId: props.regionId }}>
            {props.children}
          </div>
        </Drawer>
      </Show>
    </>
  )
}

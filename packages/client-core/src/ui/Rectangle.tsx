import { createSignal, type JSX } from 'solid-js'

/* Rectangle: a box the kit owns and something else fills with pixels.

   The kit's one admission of defeat, and a deliberate one (docs/future/layout/03-extension-kinds.md,
   "does it own pixels, heavy typing, or a third-party library?"). A PTY, a webview and a plugin's own
   iframe are not trees of nodes and never will be; what the kit can still own is the box they sit in,
   and the keyboard contract for getting in and out of it.

   Three kinds and no fourth, because the name says what is inside and a `kind` a host does not know
   is a rectangle nobody can project. `pty` is the one a terminal host draws natively; the other two
   are absent there and draw their `Fallback` child instead.

   At 80×24: `pty` is native. `webview` and `frame` are the `Fallback` child or nothing. */
export function Rectangle(props: {
  kind: 'pty' | 'webview' | 'frame'
  /** The accessible name of the box. Not optional: a region a reader can tab into and get stuck in
   *  has to announce what it is. */
  label: string
  children: JSX.Element
}) {
  const [inside, setInside] = createSignal(false)
  let box: HTMLDivElement | undefined

  // One stop from outside. Enter hands the keys to whatever is in the box; Escape takes them back.
  // Without this a PTY swallows Tab and there is no way out of the pane with the keyboard, which is
  // exactly what the two hand-rolled terminal hosts did before the kit had this node.
  const enter = () => {
    setInside(true)
    box?.querySelector<HTMLElement>('textarea, [tabindex="0"], input, button')?.focus()
  }

  return (
    <div
      ref={box}
      class="ui-rect"
      data-kind={props.kind}
      data-inside={inside() ? '' : undefined}
      role="group"
      aria-label={props.label}
      tabindex={inside() ? -1 : 0}
      onFocusOut={(event) => {
        if (!box?.contains(event.relatedTarget as Node | null)) setInside(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === box) {
          event.preventDefault()
          enter()
          return
        }
        if (event.key !== 'Escape' || !inside()) return
        event.preventDefault()
        setInside(false)
        box?.focus()
      }}
      onPointerDown={() => setInside(true)}
    >
      {props.children}
    </div>
  )
}

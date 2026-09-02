import { createSignal, Show, type JSX } from 'solid-js'

/* Rectangle: a box the kit owns and something else fills with pixels.

   The kit's one admission of defeat, and a deliberate one (docs/plugins.md § Cooperative extension points,
   "does it own pixels, heavy typing, or a third-party library?"). A PTY, a webview and a plugin's own
   iframe are not trees of nodes and never will be; what the kit can still own is the box they sit in,
   and the keyboard contract for getting in and out of it.

   Four kinds and no fifth, because the name says what is inside and a `kind` a host does not know is
   a rectangle nobody can project. `pty` is the one a terminal host draws natively, and `editor` is
   the one it draws as its own text editor; the other two are absent there and draw their `Fallback`
   child instead.

   `editor` arrived in phase 9 of the layout programme with the app's two editor hosts — the editor
   pane's and the host's own document surface — which had been a `<div>` and a stylesheet each. A code
   editor is the case the kit is least able to express and the easiest of the four to project: at 80
   columns it is the text of the file.

   At 80×24: `pty` and `editor` are native. `webview` and `frame` are the `Fallback` child or nothing. */
export function Rectangle(props: {
  kind: 'pty' | 'webview' | 'frame' | 'editor'
  /** The accessible name of the box. Not optional: a region a reader can tab into and get stuck in
   *  has to announce what it is. */
  label: string
  /**
   * The element the library attaches to, handed over once.
   *
   * Every rectangle in the app holds something that wants a DOM node of its own — xterm, CodeMirror, a
   * WebContentsView, an iframe — and each of them used to be a bare `<div ref={host}>` the plugin
   * wrote next to a stylesheet giving it a size. That is the one shape the closed kit cannot express
   * and the one a plugin must not spell, so the host draws the element and the caller is given it.
   */
  mount?: (element: HTMLElement) => void
  /**
   * Drawn but not shown. The one thing a rectangle's caller cannot get any other way: what a
   * rectangle holds is expensive to build and expensive to throw away — an xterm carries a WebGL
   * context and a screen the node had to serialize — so a tab strip over several of them keeps them
   * all and hides the ones nobody is looking at, the same trade `Tabs.Panel` makes for scroll
   * position (docs/terminal.md § Client).
   */
  hidden?: boolean
  children?: JSX.Element
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
      hidden={props.hidden}
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
      <Show when={props.mount} keyed>{(mount) => <div class="ui-rect-mount" ref={mount} />}</Show>
      {props.children}
    </div>
  )
}

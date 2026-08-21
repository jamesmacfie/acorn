import { setFocusedPane } from './tasks'

// The one impure member of what used to be ui/focus.ts: it writes the focused-pane store on
// pointer/focusin. It lives beside the pane host that uses it because ui/ is pure presentation,
// props in, DOM out, no store writes, and a design-system entrypoint a plugin author imports must
// not carry a directive that reaches into core's task state.
export type PaneFocusOptions = { taskId: string; paneId: string }

export function paneFocus(element: HTMLElement, value: () => PaneFocusOptions): void {
  const mark = () => {
    const options = value()
    setFocusedPane(options.taskId, options.paneId)
  }
  element.addEventListener('focusin', mark)
  element.addEventListener('pointerdown', mark)
}

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      paneFocus: PaneFocusOptions
    }
  }
}

import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { createAnchoredPopover } from './anchor'

// Detect an @-mention fragment ending at the cursor. Returns null when not in one.
function detectFragment(value: string, cursor: number): { atIdx: number; query: string } | null {
  const before = value.slice(0, cursor)
  const atIdx = before.lastIndexOf('@')
  if (atIdx === -1) return null
  const fragment = before.slice(atIdx + 1)
  if (/\s/.test(fragment)) return null
  // Don't trigger on email-style word@word
  if (atIdx > 0 && /\w/.test(before[atIdx - 1])) return null
  return { atIdx, query: fragment }
}

// Drop-in textarea replacement with @mention autocomplete. Inserts `@login ` on selection;
// popup appears below the textarea anchored to its bottom-left edge (no cursor math needed).
// Part of the shared kit because the diff viewer's composers use it (ui/diff/DiffRows.tsx) and
// client-core may not import a plugin; its `.mention-popup` styling already lived in
// styles/overlays.css here.
export default function MentionTextarea(props: {
  value: string
  onInput: (value: string) => void
  mentions: string[]
  placeholder?: string
  class?: string
  disabled?: boolean
  onKeyDown?: (e: KeyboardEvent) => void
  ref?: (el: HTMLTextAreaElement) => void
}) {
  let textareaEl: HTMLTextAreaElement | undefined
  const [fragment, setFragment] = createSignal<{ atIdx: number; query: string } | null>(null)
  const [cursorAt, setCursorAt] = createSignal(0)
  const [sel, setSel] = createSignal(0)

  // Anchoring, outside-click and Escape come from ui/anchor.ts. This used to be a private
  // pointerdown listener plus a one-shot measurement, so the popup did not follow a scrolling pane;
  // it stayed where the textarea had been. The hook re-measures on scroll and resize.
  //
  // The fragment drives the surface rather than a toggle: an @-mention popup opens because the text
  // says so, not because anything was clicked.
  const popover = createAnchoredPopover({
    anchor: () => textareaEl,
    onDismiss: () => setFragment(null),
  })

  const items = createMemo(() => {
    const f = fragment()
    if (!f) return []
    const q = f.query.toLowerCase()
    return props.mentions.filter((m) => m.toLowerCase().includes(q)).slice(0, 8)
  })

  createEffect(() => {
    if (fragment() && items().length) popover.show()
    else popover.close()
  })

  const insert = (login: string) => {
    const f = fragment()
    if (!f || !textareaEl) return
    const cur = cursorAt()
    const before = props.value.slice(0, f.atIdx)
    const after = props.value.slice(cur)
    const newValue = `${before}@${login} ${after}`
    props.onInput(newValue)
    setFragment(null)
    const newCursor = f.atIdx + login.length + 2
    queueMicrotask(() => {
      textareaEl?.focus()
      textareaEl?.setSelectionRange(newCursor, newCursor)
    })
  }

  const handleInput = (e: Event & { currentTarget: HTMLTextAreaElement }) => {
    const value = e.currentTarget.value
    const cur = e.currentTarget.selectionStart ?? value.length
    setCursorAt(cur)
    props.onInput(value)
    const f = detectFragment(value, cur)
    if (f) {
      setFragment(f)
      setSel(0)
    } else {
      setFragment(null)
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    props.onKeyDown?.(e)
    if (!fragment() || !items().length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, items().length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      const item = items()[sel()]
      if (item) {
        e.preventDefault()
        insert(item)
      }
    } else if (e.key === 'Escape') {
      setFragment(null)
    }
  }

  return (
    <>
      <textarea
        ref={(el) => {
          textareaEl = el
          props.ref?.(el)
        }}
        class={props.class}
        placeholder={props.placeholder}
        value={props.value}
        disabled={props.disabled}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
      />
      <Show when={popover.open()}>
        <Portal>
          <ul
            ref={(el) => popover.setSurface(el)}
            class="mention-popup"
            style={popover.surfaceStyle()}
            role="listbox"
          >
            <For each={items()}>
              {(login, i) => (
                <li
                  class="mention-item"
                  classList={{ 'mention-item-sel': i() === sel() }}
                  role="option"
                  aria-selected={i() === sel()}
                  onPointerDown={(e) => {
                    e.preventDefault() // keep textarea focus
                    insert(login)
                  }}
                >
                  <span class="mention-at">@</span>
                  {login}
                </li>
              )}
            </For>
          </ul>
        </Portal>
      </Show>
    </>
  )
}

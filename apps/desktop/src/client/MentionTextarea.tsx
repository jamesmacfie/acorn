import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { Portal } from 'solid-js/web'

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
  const [pos, setPos] = createSignal({ top: 0, left: 0 })
  const [sel, setSel] = createSignal(0)

  const items = createMemo(() => {
    const f = fragment()
    if (!f) return []
    const q = f.query.toLowerCase()
    return props.mentions.filter((m) => m.toLowerCase().includes(q)).slice(0, 8)
  })

  const reposition = () => {
    const rect = textareaEl?.getBoundingClientRect()
    if (rect) setPos({ top: rect.bottom + 2, left: rect.left })
  }

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
      reposition()
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

  const onDocPointer = (e: PointerEvent) => {
    if (!fragment()) return
    if (textareaEl && !textareaEl.contains(e.target as Node)) setFragment(null)
  }
  onMount(() => document.addEventListener('pointerdown', onDocPointer))
  onCleanup(() => document.removeEventListener('pointerdown', onDocPointer))

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
      <Show when={fragment() !== null && items().length > 0}>
        <Portal>
          <ul
            class="mention-popup"
            style={{ top: `${pos().top}px`, left: `${pos().left}px` }}
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

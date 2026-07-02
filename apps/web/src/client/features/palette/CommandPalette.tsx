import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { useQueryClient } from '@tanstack/solid-query'
import { tasksKey } from '../../queries'
import { refreshSessions } from '../terminal/sessions'
import { terminalApi } from '../terminal/terminalClient'
import { activeLayout, activeTaskId, dispatchActiveLayout, isTerminalOpen, setTerminalOpen } from '../tasks/tasks'
import { composeItems, fuzzyFilter, type PaletteItem } from './model'
import './palette.css'

// ⌘K command palette (docs/next 13 §D): fuzzy search over run targets, built-in actions, and
// config parse-error rows (13 §B — a broken .acorn/config.toml is visible, not silent). Thin glue
// over the pure model; reuses the shared overlay shell.
export default function CommandPalette() {
  const api = terminalApi()
  const queryClient = useQueryClient()
  const [open, setOpen] = createSignal(false)
  const [query, setQuery] = createSignal('')
  const [sel, setSel] = createSignal(0)
  let inputRef: HTMLInputElement | undefined

  const [runData, { refetch }] = createResource(
    () => (open() ? activeTaskId() : null),
    async (id) => (id && api ? await api.run.targets(id) : null),
  )

  const actions = () => {
    const id = activeTaskId()
    if (!id) return []
    const layout = activeLayout()
    const current = layout.maximised ?? layout.panes[layout.panes.length - 1]
    return [
      { id: 'action:new-terminal', label: 'New terminal', hint: 'open a shell in the task worktree' },
      { id: 'action:toggle-terminal', label: isTerminalOpen(id) ? 'Hide terminal drawer' : 'Show terminal drawer' },
      { id: 'action:pane-pr', label: 'Show pane: PR review' },
      { id: 'action:pane-editor', label: 'Show pane: editor' },
      { id: 'action:pane-preview', label: 'Show pane: browser preview' },
      { id: 'action:pane-linear', label: 'Show pane: Linear' },
      { id: 'action:maximise', label: layout.maximised ? 'Restore pane' : `Maximise ${current} pane` },
      { id: 'action:pin', label: layout.pinned ? `Unpin ${layout.pinned} pane` : `Pin ${current} pane` },
      { id: 'action:archive', label: 'Archive task', hint: 'guarded teardown' },
    ]
  }

  const items = createMemo<PaletteItem[]>(() => {
    const data = runData()
    const targets = data && 'targets' in data ? data.targets : []
    const errors = data && 'targets' in data ? data.errors : []
    return fuzzyFilter(composeItems({ targets, errors, actions: actions() }), query())
  })

  const close = () => {
    setOpen(false)
    setQuery('')
    setSel(0)
  }

  async function invoke(item: PaletteItem) {
    const taskId = activeTaskId()
    if (item.kind === 'error') return // visible, not invocable
    close()
    if (!taskId || !api) return
    if (item.kind === 'run') {
      const targetId = item.id.slice('run:'.length)
      if (item.running) await api.run.stop(taskId, targetId)
      else {
        await api.run.start(taskId, targetId)
        setTerminalOpen(taskId, true)
      }
      await refreshSessions()
      return
    }
    if (item.kind === 'layout') return // recipes invoke via TaskView (docs/next 13 §C)
    switch (item.id) {
      case 'action:new-terminal':
        await api.create({ taskId, profileId: 'shell' })
        setTerminalOpen(taskId, true)
        await refreshSessions()
        break
      case 'action:toggle-terminal':
        setTerminalOpen(taskId, !isTerminalOpen(taskId))
        break
      case 'action:pane-pr':
        dispatchActiveLayout({ type: 'show', pane: 'pr' })
        break
      case 'action:pane-editor':
        dispatchActiveLayout({ type: 'show', pane: 'editor' })
        break
      case 'action:pane-preview':
        dispatchActiveLayout({ type: 'show', pane: 'preview' })
        break
      case 'action:pane-linear':
        dispatchActiveLayout({ type: 'show', pane: 'linear' })
        break
      case 'action:maximise': {
        const layout = activeLayout()
        dispatchActiveLayout({ type: 'toggleMaximise', pane: layout.maximised ?? layout.panes[layout.panes.length - 1] })
        break
      }
      case 'action:pin': {
        const layout = activeLayout()
        if (layout.pinned) dispatchActiveLayout({ type: 'unpin' })
        else dispatchActiveLayout({ type: 'pin', pane: layout.panes[layout.panes.length - 1] })
        break
      }
      case 'action:archive': {
        if (!window.confirm('Archive this task?')) break
        const res = await api.task.archive(taskId)
        if (!res.ok) window.alert(res.reason)
        await queryClient.invalidateQueries({ queryKey: tasksKey })
        break
      }
    }
  }

  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      if (open()) close()
      else {
        setOpen(true)
        void refetch()
        queueMicrotask(() => inputRef?.focus())
      }
      return
    }
    if (!open()) return
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, items().length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = items()[sel()]
      if (item) void invoke(item)
    }
  }

  onMount(() => window.addEventListener('keydown', onKey))
  onCleanup(() => window.removeEventListener('keydown', onKey))

  return (
    <Show when={open()}>
      <div class="overlay-backdrop" onClick={close}>
        <div class="overlay palette" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
          <input
            ref={inputRef}
            class="palette-input"
            placeholder="Run a target, switch a pane, archive…"
            value={query()}
            onInput={(e) => {
              setQuery(e.currentTarget.value)
              setSel(0)
            }}
          />
          <ul class="palette-list">
            <For each={items()} fallback={<li class="palette-empty muted">No matches.</li>}>
              {(item, i) => (
                <li>
                  <button
                    type="button"
                    class="palette-row"
                    classList={{ selected: i() === sel(), 'palette-error': item.kind === 'error' }}
                    onMouseEnter={() => setSel(i())}
                    onClick={() => void invoke(item)}
                  >
                    <span class="palette-label">{item.label}</span>
                    <Show when={'hint' in item && item.hint}>
                      <span class="palette-hint muted">{'hint' in item ? item.hint : ''}</span>
                    </Show>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </div>
      </div>
    </Show>
  )
}

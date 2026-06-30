import { createSignal, For, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { activeId, addTab, GLYPHS, removeTab, selectTab, setIcon, tabs } from './tabs'
import { repoOf } from './model'
import { workingCountFor } from '../terminal/sessions'
import './tabrail.css'

// Vertical workspace rail. Each tab is a square glyph button; clicking an inactive tab switches to
// its saved location. Clicking the already-active tab opens a popover to re-pick its glyph or close
// it. The `+` at the bottom opens a fresh tab at home.
export default function TabRail() {
  const navigate = useNavigate()
  const [menuId, setMenuId] = createSignal<string | null>(null)

  function onTabClick(id: string, path: string) {
    if (id === activeId()) {
      setMenuId((v) => (v === id ? null : id))
      return
    }
    setMenuId(null)
    selectTab(id)
    navigate(path)
  }

  function onAdd() {
    setMenuId(null)
    addTab('/')
    navigate('/')
  }

  return (
    <nav class="tabrail">
      <div class="tabrail-list">
        <For each={tabs()}>
          {(t) => (
            <div class="tabrail-item">
              <button
                type="button"
                class="tabrail-tab"
                classList={{ active: t.id === activeId() }}
                title={t.path === '/' ? 'New tab' : t.path}
                onClick={() => onTabClick(t.id, t.path)}
              >
                {t.icon}
              </button>
              <Show when={(() => { const r = repoOf(t.path); return workingCountFor(r.owner, r.repo) > 0 })()}>
                <span class="tabrail-spinner" aria-label="agent working" title="Agent working">
                  <span class="spin">✻</span>
                </span>
              </Show>
              <Show when={menuId() === t.id}>
                <div class="tabrail-menu">
                  <div class="tabrail-glyphs">
                    <For each={GLYPHS}>
                      {(g) => (
                        <button
                          type="button"
                          class="tabrail-glyph"
                          classList={{ active: g === t.icon }}
                          onClick={() => {
                            setIcon(t.id, g)
                            setMenuId(null)
                          }}
                        >
                          {g}
                        </button>
                      )}
                    </For>
                  </div>
                  <Show when={tabs().length > 1}>
                    <button
                      type="button"
                      class="tabrail-close"
                      onClick={() => {
                        removeTab(t.id)
                        setMenuId(null)
                      }}
                    >
                      Close tab
                    </button>
                  </Show>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
      <button type="button" class="tabrail-add" title="New tab" onClick={onAdd}>
        +
      </button>
    </nav>
  )
}

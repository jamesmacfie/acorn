// Tabs for every `[data-tabs]` strip on the page: each `[role="tab"]` in it shows the panel its
// `aria-controls` names and hides the others. A strip is hidden in the markup and shown here, so a page
// without script shows every panel, one after another. The arrow keys move along the strip. A vertical
// strip takes up and down too, and left and right still work, because it lies flat on a narrow screen.
const ACROSS: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 }
const ANY_WAY: Record<string, number> = { ...ACROSS, ArrowDown: 1, ArrowUp: -1 }

for (const strip of document.querySelectorAll<HTMLElement>('[data-tabs]')) {
  const tabs = [...strip.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
  const panels = tabs.map((tab) => document.getElementById(tab.getAttribute('aria-controls')!)!)
  const steps = strip.getAttribute('aria-orientation') === 'vertical' ? ANY_WAY : ACROSS
  const select = (index: number) =>
    tabs.forEach((tab, at) => {
      tab.setAttribute('aria-selected', String(at === index))
      tab.tabIndex = at === index ? 0 : -1
      panels[at].hidden = at !== index
    })
  tabs.forEach((tab, at) => {
    tab.addEventListener('click', () => select(at))
    tab.addEventListener('keydown', (event) => {
      const step = steps[event.key]
      if (!step) return
      event.preventDefault()
      const next = (at + step + tabs.length) % tabs.length
      select(next)
      tabs[next].focus()
    })
  })
  strip.hidden = false
  select(0)
}

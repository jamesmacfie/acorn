// Tabs for every `[data-tabs]` strip on the page: each `[role="tab"]` in it shows the panel its
// `aria-controls` names and hides the others. A strip is hidden in the markup and shown here, so a page
// without script shows every panel, one after another.
for (const strip of document.querySelectorAll<HTMLElement>('[data-tabs]')) {
  const tabs = [...strip.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
  const panels = tabs.map((tab) => document.getElementById(tab.getAttribute('aria-controls')!)!)
  const select = (index: number) =>
    tabs.forEach((tab, at) => {
      tab.setAttribute('aria-selected', String(at === index))
      tab.tabIndex = at === index ? 0 : -1
      panels[at].hidden = at !== index
    })
  tabs.forEach((tab, at) => {
    tab.addEventListener('click', () => select(at))
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      const next = (at + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length
      select(next)
      tabs[next].focus()
    })
  })
  strip.hidden = false
  select(0)
}

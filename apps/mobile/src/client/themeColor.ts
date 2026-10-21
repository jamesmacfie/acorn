import { onCleanup } from 'solid-js'

/** Keeps `<meta name="theme-color">` at the top bar's color, so the browser's own bar matches the
 *  person's theme. The manifest's color is one fixed value, for the theme a fresh install starts in. */
export function trackThemeColor(): void {
  const meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) return
  const root = document.documentElement
  const update = () => meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg-subtle').trim())
  update()
  const observer = new MutationObserver(update)
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
  onCleanup(() => observer.disconnect())
}

import { anchoredSurfacesWithin } from '../../kit/lib/controls/anchor'

const previous = new Map<HTMLElement, { inert: boolean; hidden: string | null }>()
let modal: HTMLElement | undefined

export function modalInteractionRoot(backdrop: HTMLElement): HTMLElement {
  const panel = backdrop.matches('.integrations-panel-backdrop') ? backdrop.nextElementSibling : null
  return backdrop.querySelector<HTMLElement>('[aria-modal="true"], [role="dialog"], [role="alertdialog"]')
    ?? (panel instanceof HTMLElement && panel.matches('.integrations-panel') ? panel : backdrop)
}

/** Keep background DOM out of keyboard and accessibility navigation, including body-level portals. */
export function isolateModal(backdrops: readonly HTMLElement[]): void {
  modal = backdrops.at(-1)
  const dialog = modal ? modalInteractionRoot(modal) : undefined
  const allowed = dialog ? [dialog, ...anchoredSurfacesWithin(dialog)] : []
  for (const branch of [...document.body.children]) {
    if (!(branch instanceof HTMLElement)) continue
    const block = !!modal && !allowed.some((surface) => branch.contains(surface))
    if (block) {
      if (!previous.has(branch)) previous.set(branch, { inert: branch.inert, hidden: branch.getAttribute('aria-hidden') })
      branch.inert = true
      if (branch.getAttribute('aria-hidden') !== 'true') branch.setAttribute('aria-hidden', 'true')
    } else restore(branch)
  }
  for (const branch of previous.keys()) if (!branch.isConnected) previous.delete(branch)
}
function restore(branch: HTMLElement) {
  const value = previous.get(branch)
  if (!value) return
  branch.inert = value.inert
  if (value.hidden === null) branch.removeAttribute('aria-hidden')
  else branch.setAttribute('aria-hidden', value.hidden)
  previous.delete(branch)
}
export function releaseModalIsolation(): void {
  for (const branch of previous.keys()) restore(branch)
  modal = undefined
}

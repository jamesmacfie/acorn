// Moves the visitor's platform ahead of the rest: in each `[data-platform-order]` list, the children
// whose `data-platforms` names it go first, in their own order. Only browsers with
// `navigator.userAgentData` say which platform they run on. Elsewhere, and without script, the page
// keeps its order.
const { userAgentData } = navigator as Navigator & { userAgentData?: { platform: string } }
const platform = userAgentData?.platform.toLowerCase()

if (platform) {
  for (const list of document.querySelectorAll('[data-platform-order]')) {
    const own = [...list.children].filter((child) =>
      (child as HTMLElement).dataset.platforms?.split(' ').includes(platform),
    )
    list.prepend(...own)
  }
}

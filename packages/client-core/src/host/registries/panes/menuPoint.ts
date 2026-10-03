/** A keyboard context-menu event often reports (0, 0). Anchor it to the focused icon. */
export function menuPoint(event: MouseEvent): { x: number; y: number } {
  if (event.detail !== 0 || event.clientX || event.clientY) return { x: event.clientX, y: event.clientY }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return { x: rect.right, y: rect.top }
}

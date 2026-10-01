import { createSignal } from 'solid-js'
import type { PluginRailItem } from '@acorn/protocol/api.ts'
import { closeOverlay, openOverlay } from './state'

export type PromotionRequest = { pluginId: string; item: PluginRailItem; projectId: string | null }

const [request, setRequest] = createSignal<PromotionRequest | null>(null)
export const promotionRequest = request

export function openPromotion(next: PromotionRequest): void {
  setRequest(next)
  openOverlay('promotion')
}

export function closePromotion(): void {
  closeOverlay('promotion')
  setRequest(null)
}

/** The fixture builds more than one shell in one process. */
export function resetPromotion(): void { setRequest(null) }

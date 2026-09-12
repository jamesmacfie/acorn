import { capabilityId } from '@acorn/protocol/plugin/ids.ts'

export type CaptureMetadata = {
  id: string
  taskId: string
  mime: string
  bytes: number
  createdAt: number
}

/** Ordered metadata only. Capture bytes remain behind the authenticated browser route. */
export type BrowserCapturesCapability = {
  list(taskId: string): Promise<CaptureMetadata[]>
}

export const BROWSER_CAPTURES = capabilityId<BrowserCapturesCapability>('browser.captures')

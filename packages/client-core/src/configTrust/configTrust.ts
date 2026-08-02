import { createSignal } from 'solid-js'

export type ConfigTrustRequest = { taskId: string; retry?: () => Promise<unknown> }

const [configTrustRequest, setConfigTrustRequest] = createSignal<ConfigTrustRequest | null>(null)
export { configTrustRequest }

export function openRepoConfigTrust(taskId: string, retry?: () => Promise<unknown>): void {
  setConfigTrustRequest({ taskId, retry })
}

export function closeRepoConfigTrust(): void {
  setConfigTrustRequest(null)
}

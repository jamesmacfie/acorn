import { bundleLabel } from './bundleLabel'
import { sandboxDomain } from './sandboxDomain'

// Where a plugin bundle runs on the phone, and where the phone app gets its bytes. A tree's Worker
// (./isolatedWorker.ts) and a frame (../frames/PluginFrame.tsx) share both, because both run on the bundle's own
// name under the sandbox domain (docs/mobile/plugin-sandbox.md).

const DESKTOP_RENDERERS = ['app://acorn', 'http://app.localhost', 'https://app.localhost']

/** Where the phone gets a bundle's bytes. The phone's plugin custody sets it. */
export type BundleSource = (hash: string) => Promise<ArrayBuffer>
let source: BundleSource | null = null
export const setBundleSource = (next: BundleSource | null): void => {
  source = next
}
export const bundleSource = (): BundleSource | null => source

/** The bundle's origin on the sandbox domain when the renderer is the phone app, otherwise null. */
export const phoneSandboxOrigin = (hash: string, rendererOrigin: string | undefined): string | null => {
  const domain = sandboxDomain()
  if (!domain || !rendererOrigin || DESKTOP_RENDERERS.includes(rendererOrigin)) return null
  // Only a name on this machine may be plain http. A browser treats it as a secure context.
  const secure = !/^([^:]+\.)?localhost(:\d+)?$/.test(domain)
  return `http${secure ? 's' : ''}://${bundleLabel(hash)}.${domain}`
}

/** The origin a frame for this bundle runs on: the desktop's plugin scheme, or the phone's sandbox domain. */
export const pluginFrameOrigin = (hash: string, rendererOrigin = globalThis.location?.origin): string =>
  phoneSandboxOrigin(hash, rendererOrigin) ?? `app-plugin://${hash}`

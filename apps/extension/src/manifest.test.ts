import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CHROME_EXTENSION_ID, CHROME_EXTENSION_KEY, FIREFOX_EXTENSION_ID } from '@acorn/protocol/extensionBridge.ts'
import { extensionManifest } from './manifest'

describe('extension manifests', () => {
  it('pins the Chrome ID the native host allows', () => {
    // Chrome's ID is the first 32 hex digits of the key's SHA-256, spelled with the letters a to p.
    const digest = createHash('sha256').update(Buffer.from(CHROME_EXTENSION_KEY, 'base64')).digest('hex')
    const id = Array.from(digest.slice(0, 32), (digit) => String.fromCharCode(97 + parseInt(digit, 16))).join('')
    expect(id).toBe(CHROME_EXTENSION_ID)
    expect(extensionManifest('chrome', '1.0.0')).toMatchObject({ key: CHROME_EXTENSION_KEY })
  })

  it('gives Chrome a module service worker and a side panel', () => {
    expect(extensionManifest('chrome', '1.0.0')).toMatchObject({
      manifest_version: 3,
      permissions: ['nativeMessaging', 'storage', 'sidePanel', 'activeTab', 'scripting'],
      background: { service_worker: 'background.js', type: 'module' },
      side_panel: { default_path: 'sidebar.html' },
      incognito: 'not_allowed',
    })
  })

  it('gives Firefox a background script, a sidebar, and its pinned ID', () => {
    const manifest = extensionManifest('firefox', '1.0.0')
    expect(manifest).toMatchObject({
      permissions: ['nativeMessaging', 'storage', 'activeTab', 'scripting'],
      background: { scripts: ['background.js'], type: 'module' },
      sidebar_action: { default_panel: 'sidebar.html' },
      browser_specific_settings: { gecko: { id: FIREFOX_EXTENSION_ID } },
      incognito: 'not_allowed',
    })
    expect(manifest).not.toHaveProperty('key')
  })

  it('holds no host access or notifications at install, only what the person may grant, and sets no page policy', () => {
    for (const browser of ['chrome', 'firefox'] as const) {
      const manifest = extensionManifest(browser, '1.0.0')
      expect(manifest).not.toHaveProperty('host_permissions')
      expect(manifest.optional_host_permissions).toEqual(['https://*/*', 'http://*/*'])
      // Notifications are opt-in too, never granted at install.
      expect(manifest.optional_permissions).toEqual(['notifications'])
      expect(manifest.permissions).not.toContain('notifications')
      expect(manifest).not.toHaveProperty('content_security_policy')
      expect(manifest).not.toHaveProperty('content_scripts')
    }
  })
})

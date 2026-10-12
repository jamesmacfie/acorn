import { CHROME_EXTENSION_KEY, FIREFOX_EXTENSION_ID, type BridgeBrowser } from '@acorn/protocol/extensionBridge.ts'

// One manifest per browser, from one description. The differences are the API each browser offers
// for the same idea: Chrome's service worker and side panel, Firefox's background script and
// sidebar. Both carry the pinned development identity the native host allowlists.
export function extensionManifest(browser: BridgeBrowser, version: string) {
  const shared = {
    manifest_version: 3,
    name: 'Acorn',
    version,
    description: 'Work with Acorn agents beside the page you are reading.',
    action: { default_title: 'Open Acorn' },
    // Private windows stay out of reach in this release.
    incognito: 'not_allowed',
  }
  if (browser === 'chrome')
    return {
      ...shared,
      key: CHROME_EXTENSION_KEY,
      minimum_chrome_version: '116',
      permissions: ['nativeMessaging', 'storage', 'sidePanel'],
      background: { service_worker: 'background.js', type: 'module' },
      side_panel: { default_path: 'sidebar.html' },
    }
  return {
    ...shared,
    permissions: ['nativeMessaging', 'storage'],
    background: { scripts: ['background.js'], type: 'module' },
    sidebar_action: { default_title: 'Acorn', default_panel: 'sidebar.html', open_at_install: false },
    browser_specific_settings: {
      gecko: {
        id: FIREFOX_EXTENSION_ID,
        strict_min_version: '128.0',
        data_collection_permissions: { required: ['none'] },
      },
    },
  }
}

import { render } from 'solid-js/web'
import { connect } from '@acorn/plugin-api/ui/sdk'
import styles from './http.css?inline'
import { HttpFrameApp } from './app'
import { mountFrameTips } from '@acorn/plugin-api/ui'

// This direct Solid dependency is intentional: a plugin frame is a separate origin/document/bundle,
// so it cannot create the duplicate-reactive-graph failure the shell guards against in one realm.
//
// The stylesheet is INLINED rather than emitted beside the bundle, because an app-plugin:// origin serves
// exactly one file — `/client.js`, plus the host's own `/ui.css` (apps/desktop main/pluginScheme.ts). A
// frame with a separate asset has a broken frame.
const style = document.createElement('style')
style.textContent = styles
document.head.append(style)

const root = document.createElement('div')
root.id = 'root'
document.body.append(root)

// A frame has its own document, so the shell's delegated tooltip singleton cannot see it — every
// `data-tip` in here was inert. Same protocol, same bubble, this document.
mountFrameTips()

void connect()
  .then((bridge) => render(() => <HttpFrameApp bridge={bridge} />, root))
  .catch((error: unknown) => {
    // Pre-render failure: no Solid yet, so this sets the Alert primitive's class directly.
    root.className = 'ui-alert'
    root.dataset.variant = 'banner'
    root.dataset.tone = 'danger'
    root.textContent = error instanceof Error ? error.message : String(error)
  })

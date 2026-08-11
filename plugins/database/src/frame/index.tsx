import { render } from 'solid-js/web'
import { connect } from '@acorn/plugin-api/ui/sdk'
import styles from './database.css?inline'
import { DatabaseFrameApp } from './app'

// This direct Solid dependency is intentional: a plugin frame is a separate origin/document/bundle, so
// it cannot create the duplicate-reactive-graph failure the shell guards against in one realm.
//
// The stylesheet is INLINED rather than emitted beside the bundle, because an app-plugin:// origin serves
// exactly one file — `/client.js`, plus the host's own `/ui.css` (apps/desktop main/pluginScheme.ts). A
// frame with a separate asset has a broken frame. That one-file rule is also, exactly, why the editor
// above this frame is the host's: Monaco's four language-service workers are four more files, and there
// is nowhere to serve them from.
const style = document.createElement('style')
style.textContent = styles
document.head.append(style)

const root = document.createElement('div')
root.id = 'root'
document.body.append(root)

void connect()
  .then((bridge) => render(() => <DatabaseFrameApp bridge={bridge} />, root))
  .catch((error: unknown) => {
    root.className = 'db-error'
    root.textContent = error instanceof Error ? error.message : String(error)
  })

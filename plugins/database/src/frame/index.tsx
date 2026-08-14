import { render } from 'solid-js/web'
import { mountFrame } from '@acorn/plugin-api/ui/sdk'
import styles from './database.css?inline'
import { DatabaseFrameApp } from './app'

// This direct Solid dependency is intentional: a plugin frame is a separate origin/document/bundle, so
// it cannot create the duplicate-reactive-graph failure the shell guards against in one realm.
// Everything around it — stylesheet, root element, tooltips, the bridge, the failure banner — is
// mechanism `mountFrame` owns.
//
// The one-file rule that makes `mountFrame` inject the stylesheet rather than link it (an app-plugin://
// origin serves exactly `/client.js` plus the host's `/ui.css`) is also, exactly, why the editor above
// this frame is the host's: Monaco's four language-service workers are four more files, and there is
// nowhere to serve them from.
mountFrame({ styles }, (bridge, root) => render(() => <DatabaseFrameApp bridge={bridge} />, root))

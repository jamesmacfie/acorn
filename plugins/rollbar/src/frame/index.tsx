import { render } from 'solid-js/web'
import { mountFrame } from '@acorn/plugin-api/ui/sdk'
import styles from './rollbar-frame.css?inline'
import { RollbarFrameApp } from './app'

// This direct Solid dependency is intentional: a plugin frame is a separate origin/document/bundle,
// so it cannot create the duplicate-reactive-graph failure the shell guards against in one realm.
// Everything around it — stylesheet, root element, tooltips, the bridge, the failure banner — is
// mechanism `mountFrame` owns.
mountFrame({ styles }, (bridge, root) => render(() => <RollbarFrameApp bridge={bridge} />, root))

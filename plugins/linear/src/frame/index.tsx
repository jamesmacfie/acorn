import { render } from 'solid-js/web'
import { mountFrame } from '@acorn/plugin-api/ui/sdk'
import styles from './linear-frame.css?inline'
import { LinearFrameApp } from './app'

// This direct Solid dependency is intentional: a plugin frame is a separate origin/document/bundle,
// so it cannot create the duplicate-reactive-graph failure the shell guards against in one realm.
// Everything around it — stylesheet, root element, tooltips, the bridge, the failure banner — is
// mechanism `mountFrame` owns. `linear-frame.css` is this plugin's own layout on top of the tokens the
// host pushes down the port; acorn's UI-kit CSS is never bundled here.
mountFrame({ styles }, (bridge, root) => render(() => <LinearFrameApp bridge={bridge} />, root))

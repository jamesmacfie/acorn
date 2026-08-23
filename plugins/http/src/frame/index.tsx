import { render } from 'solid-js/web'
import { mountFrame } from '@acorn/plugin-api/ui/sdk'
import styles from './http.css?inline'
import { HttpFrameApp } from './app'

// The direct Solid dependency is deliberate. A plugin frame is a separate origin, document, and
// bundle, so it cannot create the duplicate-reactive-graph failure the shell guards against in one
// realm. `mountFrame` owns everything around it: stylesheet, root element, tooltips, bridge, and the
// failure banner.
mountFrame({ styles }, (bridge, root) => render(() => <HttpFrameApp bridge={bridge} />, root))

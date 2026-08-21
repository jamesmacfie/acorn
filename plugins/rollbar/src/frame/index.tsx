import { render } from 'solid-js/web'
import { mountFrame } from '@acorn/plugin-api/ui/sdk'
import styles from './rollbar-frame.css?inline'
import { RollbarFrameApp } from './app'

// A direct Solid dependency here is fine: docs/plugins.md § Frame authoring and the UI kit covers
// why a frame's separate origin and document make this a separate reactive realm, not the
// duplicate-Solid-in-one-realm hazard the shell guards against.
// Everything else, the stylesheet, root element, tooltips, the bridge, the failure banner, is
// mechanism `mountFrame` owns.
mountFrame({ styles }, (bridge, root) => render(() => <RollbarFrameApp bridge={bridge} />, root))

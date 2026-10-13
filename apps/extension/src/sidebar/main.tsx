import { render } from 'solid-js/web'
import { BROWSER_BRIDGE_HOST } from '@acorn/protocol/extensionBridge.ts'
import { browserApi } from '../browser'
import { App } from './App'
import { followAppearance } from './appearance'
// The app's own token sheets, as they are. A pack's fonts load only when its rules use them.
import '@acorn/client-core/infra/styles/fonts.css'
import '@acorn/client-core/infra/styles/tokens-style.css'
import '@acorn/client-core/infra/styles/tokens-theme.css'
import '@acorn/client-core/infra/styles/style-modern.css'
import '@acorn/client-core/infra/styles/style-cozy.css'
import '@acorn/client-core/infra/styles/style-cute.css'
import './sidebar.css'

const api = browserApi()
// The stored theme applies before the first paint, so a chosen dark theme doesn't flash light.
await followAppearance(api, document.documentElement)
// Only a release desktop registers `acorn://`. A build for the development bridge runs beside a
// development desktop, so it copies Acorn links instead of opening them.
const opensLinks = __ACORN_NATIVE_HOST__ === BROWSER_BRIDGE_HOST
render(() => <App api={api} opensLinks={opensLinks} />, document.getElementById('root')!)

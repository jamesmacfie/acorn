import { render } from 'solid-js/web'
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
render(() => <App api={api} />, document.getElementById('root')!)

import { render } from 'solid-js/web'
import { browserApi } from '../browser'
import { App } from './App'
import './sidebar.css'

render(() => <App api={browserApi()} />, document.getElementById('root')!)

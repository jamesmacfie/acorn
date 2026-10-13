import { browserApi } from '../browser'
import { startBackground } from './background'

startBackground(browserApi(), __ACORN_NATIVE_HOST__)

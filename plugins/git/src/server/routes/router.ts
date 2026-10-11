import { Hono } from 'hono'
import { BridgeError, respondError, type AppEnv } from '@acorn/plugin-api/node'

/** Every Git router starts here, so a refusal thrown as a BridgeError reaches the client with its own
 *  status, code, and message. The app's backstop would turn it into a 500 `internal`. */
export const gitRouter = () =>
  new Hono<AppEnv>().onError((error, c) => {
    if (error instanceof BridgeError)
      return respondError(c, error.status, error.code, error.message ? [error.message] : undefined)
    throw error
  })

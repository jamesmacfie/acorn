// Lets a site script import workspace TypeScript in plain Node. Workspace packages import sibling
// modules without an extension, which TypeScript and Vite resolve and Node doesn't, so a missing
// relative module is tried again with `.ts`. Import this module before any workspace source.
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context)
    } catch (error) {
      if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.')) throw error
      return next(`${specifier}.ts`, context)
    }
  },
})

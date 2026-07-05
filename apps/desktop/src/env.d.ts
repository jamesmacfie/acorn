import type { HttpBindings } from '@hono/node-server'
import type { RuntimeBindings } from './main/bindings'

// Hand-written replacement for the deleted wrangler-generated worker-configuration.d.ts.
// Routes read their bindings via c.env (typed as this global Env); the Node/Electron bootstrap
// builds the concrete object in main/bindings.ts. The @hono/node-server adapter also spreads its
// HttpBindings (raw incoming/outgoing) into the env at the app.fetch() seam (main/server.ts), so
// they're part of the type — optional, since tests and non-HTTP callers don't provide them.
declare global {
  interface Env extends RuntimeBindings, Partial<HttpBindings> {}
}

export {}

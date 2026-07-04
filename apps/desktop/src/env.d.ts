import type { RuntimeBindings } from './main/bindings'

// Hand-written replacement for the deleted wrangler-generated worker-configuration.d.ts.
// Routes read their bindings via c.env (typed as this global Env); the Node/Electron bootstrap
// builds the concrete object in main/bindings.ts. One runtime now — no Cloudflare Env to generate.
declare global {
  interface Env extends RuntimeBindings {}
}

export {}

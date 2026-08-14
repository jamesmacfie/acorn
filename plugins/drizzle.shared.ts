// The drizzle-kit config for every plugin that owns tables (docs/data-layer.md § Plugin DBs). Eight
// byte-identical copies before this file existed.
//
// Each plugin's own drizzle.config.ts is `export { default } from '../drizzle.shared'`. The paths below
// are resolved against the CWD, and `scripts/db.mjs` runs drizzle-kit from the package directory — which
// is also why nothing here is parameterised by schema path: all eight put their schema in the same
// place, and a plugin that ever needs a different one writes its own defineConfig instead of teaching
// this file a knob.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/node/schema.ts',
  out: './migrations',
})

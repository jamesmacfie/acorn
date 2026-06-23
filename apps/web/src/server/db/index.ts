import { drizzle } from 'drizzle-orm/d1'
import * as schema from './schema'

// Bind the D1 namespace (env.DB) to a typed Drizzle client. Imported by routes.
export const getDb = (env: Env) => drizzle(env.DB, { schema })

export { schema }

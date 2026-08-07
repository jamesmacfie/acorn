// The http plugin's own tables (docs/data-layer.md § Plugin DBs). Lives in
// <data-root>/plugins/http.sqlite with its own Drizzle chain, migrated at plugin init.
//
// Moved out of @acorn/node-core's schema.ts: saved requests and repo variables are the API panel's
// data, and core has no reason to know their shape. `task_id` is a plain ID into core's `tasks` —
// dereferenced through CoreServices.tasks, never joined.
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// Saved HTTP requests for the API panel (docs/panes.md). Repo-scoped like the database plugin's saved
// queries — a request written against a repo's API outlives any one task worktree. Credentials make
// this identity-scoped even on a single-user machine. Sensitive fields are JWE ciphertext whenever
// `encrypted` is true; the plugin's init migrates pre-encryption rows before the listener opens.
// The `http_` prefix, not `api_`: `api_tokens`/`api_idempotency` belonged to V1's public automation
// API, and so does the settings page id `api`.
export const httpRequests = sqliteTable(
  'http_requests',
  {
    id: text('id').primaryKey(),
    // The default exists only so Drizzle can rebuild populated legacy tables. Init claims legacy rows
    // only when exactly one identity exists (CoreServices.identity.sole); ambiguous rows stay
    // quarantined under the sentinel, which no authenticated identity can query.
    userId: text('user_id').notNull().default('__legacy_unscoped__'),
    repoOwner: text('repo_owner').notNull(),
    repoName: text('repo_name').notNull(),
    folder: text('folder').notNull().default(''),
    // Set = an ad-hoc request living with a task (shown in that task's API pane). Null = saved in
    // the repo tree. "Save this ad-hoc request" clears taskId and sets folder + name. No FK, and now
    // not even the same database file: an orphan row after a hard task delete is inert.
    taskId: text('task_id'), // → core tasks.id
    name: text('name').notNull(),
    method: text('method').notNull(),
    url: text('url').notNull(), // encrypted raw URL; holds the query string too
    headers: text('headers').notNull().default('[]'), // encrypted JSON KeyValue[]
    bodyMode: text('body_mode').notNull().default('none'), // 'none' | 'json' | 'text' | 'form'
    body: text('body').notNull().default(''), // encrypted raw string / JSON KeyValue[]
    auth: text('auth').notNull().default('{"mode":"none"}'), // encrypted JSON AuthConfig
    // Per-request variable overrides: JSON Record<string,string>, plain values only. Secret and
    // command kinds are repo-level (http_variables) because they need the enc key and a shell.
    vars: text('vars').notNull().default('{}'), // encrypted JSON Record<string,string>
    encrypted: integer('encrypted', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('http_requests_user_repo_folder_idx').on(t.userId, t.repoOwner, t.repoName, t.folder),
    index('http_requests_user_task_idx').on(t.userId, t.taskId),
  ],
)

// Repo-level variables for the API panel. `command` values are persisted shell commands whose
// output is resolved at send time and never persisted. Every value kind is JWE ciphertext under
// SESSION_ENC_KEY; secret plaintext is additionally never sent to the renderer.
export const httpVariables = sqliteTable(
  'http_variables',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().default('__legacy_unscoped__'),
    repoOwner: text('repo_owner').notNull(),
    repoName: text('repo_name').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(), // 'value' | 'secret' | 'command'
    value: text('value').notNull(), // JWE ciphertext for plaintext value / secret / shell command
    encrypted: integer('encrypted', { mode: 'boolean' }).notNull().default(false),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('http_variables_user_repo_name_idx').on(t.userId, t.repoOwner, t.repoName, t.name)],
)

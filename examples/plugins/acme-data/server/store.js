// The plugin's own table, `deploys`, created by migrations/0000_init.sql.

/** @typedef {{ id: string, taskId: string, environment: string, status: string, sha: string, at: number }} Deploy */

// #region store
/**
 * `ctx.storage.open()` returns the host's drizzle handle on this plugin's own file. With no build step
 * there's no drizzle to import, so this uses the SQLite driver underneath it, `$client`, with `?`
 * parameters. With a bundler, use drizzle's query builder on the handle instead.
 * @param {import('acorn-plugin-types').PluginDatabase} database
 */
export function createStore(database) {
  const sqlite = /** @type {any} */ (database).$client
  const columns = 'id, task_id AS taskId, environment, status, sha, at'
  return {
    /** @returns {Deploy[]} */
    all: () => sqlite.prepare(`SELECT ${columns} FROM deploys ORDER BY at DESC`).all(),
    /** @param {string} taskId @returns {Deploy[]} */
    forTask: (taskId) => sqlite.prepare(`SELECT ${columns} FROM deploys WHERE task_id = ? ORDER BY at DESC`).all(taskId),
    /** @param {Deploy} deploy */
    add: (deploy) =>
      sqlite
        .prepare('INSERT OR IGNORE INTO deploys (id, task_id, environment, status, sha, at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(deploy.id, deploy.taskId, deploy.environment, deploy.status, deploy.sha, deploy.at),
    /** @param {string} taskId @param {string} from @param {string} to */
    setStatus: (taskId, from, to) =>
      sqlite.prepare('UPDATE deploys SET status = ? WHERE task_id = ? AND status = ?').run(to, taskId, from).changes,
    /** @param {number} before */
    pruneBefore: (before) => sqlite.prepare('DELETE FROM deploys WHERE at < ?').run(before).changes,
  }
}
// #endregion

import { constants, type DatabaseSync } from 'node:sqlite'

// Deliberately enumerated: new SQLite filesystem controls must be reviewed before loaded SQL can
// use them. Queries of schema metadata and the owning file's normal WAL maintenance remain useful.
const allowedPragmas = new Set([
  'application_id', 'auto_vacuum', 'busy_timeout', 'cache_size', 'cache_spill', 'case_sensitive_like',
  'collation_list', 'compile_options', 'database_list', 'defer_foreign_keys', 'encoding', 'foreign_key_check',
  'foreign_key_list', 'foreign_keys', 'freelist_count', 'fullfsync', 'function_list', 'ignore_check_constraints',
  'incremental_vacuum', 'index_info', 'index_list', 'index_xinfo', 'integrity_check', 'journal_mode',
  'journal_size_limit', 'legacy_alter_table', 'locking_mode', 'max_page_count', 'module_list', 'optimize',
  'page_count', 'page_size', 'pragma_list', 'query_only', 'quick_check', 'read_uncommitted', 'recursive_triggers',
  'reverse_unordered_selects', 'schema_version', 'secure_delete', 'shrink_memory', 'stats', 'synchronous',
  'table_info', 'table_list', 'table_xinfo', 'temp_store', 'threads', 'trusted_schema', 'user_version',
  'wal_autocheckpoint', 'wal_checkpoint',
])
const deniedFunctions = new Set(['load_extension', 'readfile', 'writefile', 'edit', 'shell', 'eval', 'fts3_tokenizer'])
const allowedVirtualTables = new Set(['fts3', 'fts4', 'fts5', 'rtree', 'rtree_i32'])

/** Install before any plugin-authored statement or migration. Never expose this native handle. */
export function installPluginStoragePolicy(database: DatabaseSync): void {
  if (typeof database.setAuthorizer !== 'function') {
    throw new Error('Loaded plugin storage requires SQLite authorization support; use the bundled Node 24 runtime.')
  }
  database.setAuthorizer((action, first, second) => {
    if (action === constants.SQLITE_ATTACH || action === constants.SQLITE_DETACH || action === constants.SQLITE_COPY) {
      return constants.SQLITE_DENY
    }
    if (action === constants.SQLITE_PRAGMA) {
      const name = first?.toLowerCase() ?? ''
      if (!allowedPragmas.has(name)) return constants.SQLITE_DENY
      // Keep SQLite's temporary tables and sorter spill files in memory, rather than allowing SQL
      // to choose an ambient filesystem directory outside the exact owning database paths.
      if (name === 'temp_store' && second !== null && !['2', 'memory'].includes(second.toLowerCase())) {
        return constants.SQLITE_DENY
      }
    }
    if (action === constants.SQLITE_FUNCTION) {
      const name = second?.toLowerCase() ?? ''
      if (deniedFunctions.has(name) || (name.startsWith('pragma_') && !allowedPragmas.has(name.slice(7)))) {
        return constants.SQLITE_DENY
      }
    }
    if (action === constants.SQLITE_CREATE_VTABLE && !allowedVirtualTables.has(second?.toLowerCase() ?? '')) {
      return constants.SQLITE_DENY
    }
    return constants.SQLITE_OK
  })
  database.exec('PRAGMA temp_store = MEMORY')
}

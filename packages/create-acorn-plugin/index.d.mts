// Types for index.mjs, which stays plain JavaScript so it runs with no build. A TypeScript caller in
// this repository reads them: the Node writes the tree template when an app turns into a plugin.

export declare const API_VERSION: string
export declare const BASELINE: string
export declare const SCHEMA_URL: string
export declare const SDK_VERSION: string
export declare const SOURCE_REF: RegExp
export declare const KNOWN_SOURCES: readonly { source: string; name: string; title?: string }[]

export type DataSourceStarter = { row: string; inputs: { source: string; optional?: boolean }[] }

export declare function toPluginId(input: unknown): string | null
export declare function toDisplayName(id: string): string
export declare function toInputName(source: string, taken?: Set<string>): string
/** The whole package, as a path → contents map. */
export declare function scaffoldFiles(
  id: string,
  name?: string,
  options?: { rectangle?: boolean; dataSource?: DataSourceStarter; trigger?: boolean },
): Record<string, string>
export declare function triggerFiles(id: string, name: string): Record<string, string>
export declare function dataSourceFiles(id: string, name: string, starter: DataSourceStarter): Record<string, string>

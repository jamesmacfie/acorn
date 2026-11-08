import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { z } from 'zod'
import type { PluginScaffoldRequest, PluginScaffoldResult } from '@acorn/protocol/api.ts'
import { git, gitOrThrow } from '../core/git'

// The plugin starter files for POST /v1/core/plugins/scaffold. The route loads this file on first use,
// so it stays out of the node's startup bundle.

/** The parts of `create-acorn-plugin` used here. `PluginsBridge.scaffoldPackage` loads the package. */
export type ScaffoldPackage = {
  scaffoldFiles(
    id: string,
    name: string,
    options: { trigger?: boolean; dataSource?: { row: string; inputs: { source: string; optional?: boolean }[] } },
  ): Record<string, string>
  toPluginId(input: unknown): string | null
  SOURCE_REF: RegExp
}

export const scaffoldRequest = (scaffold: ScaffoldPackage) => {
  const common = {
    folder: z.string().min(1).max(1024).refine(isAbsolute, 'The folder must be an absolute path.'),
    // Refused rather than normalised, so the manifest carries the ID the caller asked for.
    pluginId: z.string().refine((id) => scaffold.toPluginId(id) === id, 'Not a plugin ID.'),
    name: z.string().trim().min(1).max(120),
    git: z.boolean(),
  }
  return z.discriminatedUnion('kind', [
    z.strictObject({ ...common, kind: z.enum(['pane', 'trigger']) }),
    z.strictObject({
      ...common,
      kind: z.literal('data-source'),
      dataSource: z.strictObject({
        row: z.string().trim().min(1).max(120),
        // The scaffold's own rule for a derived source: at least one input, and the first is required.
        inputs: z
          .array(z.strictObject({ source: z.string().regex(scaffold.SOURCE_REF), optional: z.boolean().optional() }))
          .min(1)
          .max(20)
          .refine((inputs) => !inputs[0]?.optional, 'The first input must be required.'),
      }),
    }),
  ])
}

/** Writes the starter files into `folder`, which must be missing or empty, and commits them when asked. */
export async function writePluginScaffold(
  scaffold: ScaffoldPackage,
  request: PluginScaffoldRequest,
): Promise<PluginScaffoldResult | 'not-empty'> {
  const { folder } = request
  const files = scaffold.scaffoldFiles(
    request.pluginId,
    request.name,
    request.kind === 'data-source' ? { dataSource: request.dataSource } : { trigger: request.kind === 'trigger' },
  )
  // Anything but a missing folder or an empty one is refused, so nothing of the owner's is overwritten.
  const entries = await readdir(folder).catch((error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? [] : null))
  if (!entries || entries.length) return 'not-empty'
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(folder, path)), { recursive: true })
    await writeFile(join(folder, path), text, { flag: 'wx' })
  }
  return { result: 'written', git: request.git ? await commitStarter(folder, request.name) : 'off' }
}

// The files are already written, so a git failure costs only the repository. It's reported, not thrown.
async function commitStarter(cwd: string, name: string): Promise<PluginScaffoldResult['git']> {
  try {
    await gitOrThrow(['init'], { cwd })
    await gitOrThrow(['add', '-A'], { cwd })
    // `git var` fails exactly when a commit would, for want of a name or an email. Only then does Acorn
    // stand in, so a node with its own identity commits as itself.
    const identity = (await git(['var', 'GIT_COMMITTER_IDENT'], { cwd })).code === 0
    const fallback = identity ? [] : ['-c', 'user.name=Acorn', '-c', 'user.email=acorn@localhost']
    await gitOrThrow([...fallback, 'commit', '-m', `Start ${name} from the plugin scaffold`], { cwd })
    return 'committed'
  } catch (error) {
    return { skipped: error instanceof Error ? error.message : String(error) }
  }
}

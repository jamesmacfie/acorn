// The published JSON Schemas, served at /schemas/ from the files their packages commit: the plugin
// manifest and the device config from packages/plugin-types/, and the command line's output under
// /schemas/cli/ from apps/cli/schemas/. The bytes are copied as they are, and each file's `$id` is the
// address it's served at.
import type { APIRoute, GetStaticPaths } from 'astro'

const read = (files: Record<string, string>, prefix: string) =>
  Object.entries(files).map(([path, text]) => [`${prefix}${path.split('/').pop()}`, text] as const)

const schemas = new Map([
  ...read(
    import.meta.glob<string>('../../../../../packages/plugin-types/*.schema.json', {
      eager: true,
      query: '?raw',
      import: 'default',
    }),
    '',
  ),
  ...read(
    import.meta.glob<string>('../../../../cli/schemas/*.schema.json', {
      eager: true,
      query: '?raw',
      import: 'default',
    }),
    'cli/',
  ),
])

export const getStaticPaths = (() => [...schemas.keys()].map((file) => ({ params: { file } }))) satisfies GetStaticPaths

export const GET: APIRoute = ({ params }) =>
  new Response(schemas.get(params.file!), { headers: { 'Content-Type': 'application/schema+json' } })

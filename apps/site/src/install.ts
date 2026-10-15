// The two ways to install acorn that the site offers first (docs/future/marketing/README.md, owner
// decision 7): build from source (docs/local-development.md) and the standalone Node tarball
// (docs/node-distribution.md § Install and start). The landing page's install blocks show them.
export const installMethods = [
  {
    label: 'Build from source',
    commands: [
      'git clone https://github.com/jamesmacfie/acorn',
      'cd acorn && pnpm install --frozen-lockfile',
      'pnpm rebuild:node && pnpm dev',
    ],
  },
  {
    label: 'Standalone Node',
    commands: [
      'tar -xzf acorn-node-*.tgz && cd acorn-node-*',
      'npm ci --omit=dev && npm rebuild',
      'node scripts/prune-runtime.mjs',
      'ACORN_DATA_DIR=/var/lib/acorn-node npm start',
    ],
  },
]

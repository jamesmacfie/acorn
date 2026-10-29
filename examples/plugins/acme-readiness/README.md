# Acme release readiness

An acorn plugin with one derived source: rows built by your own logic from data acorn already reads.
Each row is one task.

```text
acorn-plugin.json      the manifest, with the data source and the inputs it reads
src/source.ts          the source: its inputs, its fields, and the logic that builds each row
src/source.test.ts     a test of that logic against realistic records
src/index.ts           the node entry, which serves the source
scripts/manifest.mjs   rewrites the manifest's source entry from src/source.ts on each build
```

It reads:

- `tasks`: Tasks (`core:tasks`)
- `deploys`: Acme deploys (`acme-data:deploys`), from the acme-data example

## Build and test

```sh
npm install
npm test
npm run build
```

## Install it

**Settings › Plugins › Install… › Local folder**, with this directory. Acorn asks you to approve what
the plugin reads before it reads anything. Then pick it as a source in a panel, and choose an account
for each input.

The full guide is [Add a data source](https://getacorn.dev/docs/build-plugins/node/add-a-data-source/).

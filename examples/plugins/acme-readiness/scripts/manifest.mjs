// The build's last step: rewrite the manifest's data source entry from the built source, so the
// inputs acorn asks the person to approve are the ones the code reads.
import { readFileSync, writeFileSync } from 'node:fs'
import { derivedSourceManifest } from 'acorn-plugin-sdk/data'
import { source } from '../dist/node.js'

const manifest = JSON.parse(readFileSync('acorn-plugin.json', 'utf8'))
manifest.contributions = { ...manifest.contributions, dataSources: [derivedSourceManifest(source)] }
writeFileSync('acorn-plugin.json', JSON.stringify(manifest, null, 2) + '\n')

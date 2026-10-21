// The build's last step: rewrite the manifest's feed entry from the built feed, so the fields and the
// suggested trigger acorn reads are the ones the code declares.
import { readFileSync, writeFileSync } from 'node:fs'
import { alerts } from '../dist/node.js'

const manifest = JSON.parse(readFileSync('acorn-plugin.json', 'utf8'))
manifest.contributions = { ...manifest.contributions, dataSources: [alerts.manifest] }
writeFileSync('acorn-plugin.json', JSON.stringify(manifest, null, 2) + '\n')

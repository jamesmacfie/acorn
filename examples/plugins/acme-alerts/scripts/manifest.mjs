// The build's last step: rewrite the manifest's data source entries from the build, so the fields and
// the suggested triggers acorn reads are the ones the code declares.
import { readFileSync, writeFileSync } from 'node:fs'
import { alerts, hostsSource } from '../dist/node.js'

const manifest = JSON.parse(readFileSync('acorn-plugin.json', 'utf8'))
manifest.contributions = { ...manifest.contributions, dataSources: [alerts.manifest, hostsSource] }
writeFileSync('acorn-plugin.json', JSON.stringify(manifest, null, 2) + '\n')

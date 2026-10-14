#!/usr/bin/env node
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildBundledPlugins } from '../../../scripts/bundled-plugins.mjs'

const output = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/bundled-plugins')
const built = buildBundledPlugins(output)
console.log(`[bundled-plugins] ${built.length} package(s) -> ${output}`)

import { Log } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Log',
  caption: 'Four lines of build output.',
  terminal: { columns: 60, rows: 4 },
  width: 480,
}

export default function LogSpecimen() {
  return (
    <Log
      ariaLabel="Build output"
      lines={['> vite build', 'transforming 412 modules', 'dist/index.js  48.2 kB', 'built in 2.1s']}
    />
  )
}

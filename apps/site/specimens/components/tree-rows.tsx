import { ListColumn, TreeRow } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'TreeRow',
  caption: 'An open folder with two files under it, and a closed folder.',
  terminal: { columns: 40, rows: 4 },
  width: 320,
}

export default function TreeRows() {
  return (
    <ListColumn label="Files">
      <TreeRow depth={0} expandable expanded label="src">
        src
      </TreeRow>
      <TreeRow depth={1} label="login.ts" selected>
        login.ts
      </TreeRow>
      <TreeRow depth={1} label="session.ts">
        session.ts
      </TreeRow>
      <TreeRow depth={0} expandable label="test">
        test
      </TreeRow>
    </ListColumn>
  )
}

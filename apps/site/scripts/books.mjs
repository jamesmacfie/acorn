// The docs collection's generated folders, each built by reference.mjs from a folder of written halves
// (docs/site/references.md). Paths are under apps/site. `components` are the ones the build imports
// into every page of the book, so a written half imports none itself.
export const BOOKS = [
  {
    name: 'plugin reference',
    written: 'src/content/reference',
    docs: 'docs/build-plugins/reference',
    components: ['ApiMajor', 'Badge', 'ReferenceTable', 'Snapshot', 'Specimen'],
  },
  {
    name: 'components',
    written: 'src/content/components',
    docs: 'docs/components',
    components: ['Appearance', 'Badge', 'IconSet', 'ReferenceTable', 'Specimen', 'SpecimenCode', 'ThemeSwatches'],
  },
]

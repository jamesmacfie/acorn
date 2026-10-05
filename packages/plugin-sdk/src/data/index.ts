// Published entry point for `acorn-plugin-sdk/data`: the derived source helper for a plugin's node
// half. Its declaration is ./public.ts, copied to dist/data.d.ts.
export { defineDerivedSource, derivedSourceManifest, field } from './derived.ts'
export type {
  DerivedQueryArgs, DerivedRecord, DerivedSource, DerivedSourceDefinition, FieldChoice, FieldOptions, FieldSpec, FieldSpecs,
  FieldValue, FieldValues, InputHandle, InputHandles, InputQuery, InputRead, InputRecord, InputSpecs,
} from './public.ts'

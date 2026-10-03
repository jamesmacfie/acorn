# Typed data

This page covers the version 1 typed-data contract that data sources, workflows, and dashboards share,
and why a data source never becomes a second store. Read it before you change how a value, schema, or
pointer is parsed. It's part of the [data layer](../data-layer.md).
[Typed data sources](../data-sources.md) owns the source runtime.

## Shared typed values

`packages/protocol/src/data/values/dataValues.ts`, `dataSchemas.ts`, and `dataBindings.ts` own the
contract. The Node and client plugin facades export its parsers and types. `acorn-plugin-types`
publishes matching declarations for installed plugins, and its contract test checks assignability both
ways.

Values keep finite numbers, booleans, null, arrays, and plain objects. Structural schemas accept
`type`, `properties`, `required`, `items`, primitive `enum`, and boolean `additionalProperties`. A
nullable type combines one type with null. An unsupported keyword fails parsing. Allowed additional
keys survive validation. Field labels, display hints, choices, and query capabilities are separate
metadata, and an observed field can't claim choices or query capabilities.

Pointers use escaped JSON Pointer segments over own data properties. Prototype names, malformed escapes,
and accessors are rejected. An array field can be addressed whole, and metadata doesn't infer element
indices from samples. Missing is an internal symbol, distinct from null. Canonical projection encoding
includes sorted field addresses and explicit missing markers. Object keys sort by code unit, and array
order and primitive types stay significant.

`DATA_LIMITS` owns the bounds, including 12 nested levels, 256 fields, 2,048-character descriptions and
pointers, four predicate group levels, and 50 comparisons. Comparisons don't coerce values. Ordered
comparisons need matching strings or numbers, and presence tests handle missing explicitly.

## Projections, never second stores

A data source owns no core table because dashboards or workflows read it. It projects the owner's
store or provider API through the bounded Node runtime. GitHub, Linear, and Rollbar keep their own
mirrors and credentials, core tasks read core tables, and managed sessions read the agents ledger.
Record identity, freshness, connection scope, and completeness stay explicit in the source contract.
The client has no fetch authority or record cache of its own.

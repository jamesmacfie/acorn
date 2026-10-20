# Serve a query

A compiled plugin serves its source's queries with the helpers `@acorn/plugin-api/node` exports. This
page is part of [typed data sources](../data-sources.md), which has the paging and budget rules the
helpers follow. `createDataSourceHandler` is the source's route. It checks the principal, answers `describe`, and adds
the revision and read time to each page.

The host stops at the first page that isn't `more`. So a read the budget cut answers `more` on every
page, and `incomplete` only on its last page. A covered range rides on every page. Both pagers below
work this way. Choose one by what a read costs:

- **A cheap local read, run again for every page.** Turn the query's time window and `eq` comparisons
  into SQL with `sqlDataFilters`. Read newest first with `.limit(DATA_READ_LIMIT)`, keep the budget with
  `withinDataBudget`, and page with `pageDataRecords`. It filters, sorts, and takes in memory, so SQL
  only narrows. The offset is the cursor. Give it `timePointer` so a cut read reports where its
  coverage starts.
- **A costly read, made once for a run.** Make one `createDataSelectionPager` at module scope. Its read
  callback returns the whole selection from `selectDataRecords`, with its own completeness and covered
  range. The pager keeps that read for 60 seconds, so the run's later pages share it. It holds 16 reads
  at once and refuses a seventeenth with `incomplete`.

`selectDataRecords` answers literal comparisons in `all` and `any` groups, and numeric sorts. Ties,
and a query with no sort, fall back to record ID order. Pass `readOrder` to keep the order you read
the records in instead.

# Formatting

This page covers the code formatter: what it formats, how to run it, how to make `git blame` skip
formatting commits, and how to carry a branch across one. Read it before you upgrade the formatter or
rebase a branch cut before October 12, 2026.

## What it formats

[oxfmt](https://oxc.rs/docs/guide/usage/formatter) sets the layout of every TypeScript file:
120 columns, two-space indents, single quotes, no semicolons, and trailing commas. `.oxfmtrc.json`
holds the settings and the files it skips. Other files, generated files, and anything `.gitignore`
lists keep their own layout.

- `pnpm format <file>` formats one file. `pnpm format` formats the whole tree in under a second.
- `pnpm lint` runs `oxfmt --check` and fails on any file the formatter would change.
- The oxc editor extension formats on save with the same config.

A long line can take two passes to settle. If `pnpm lint` still lists a file after `pnpm format`,
run `pnpm format` again.

The root `package.json` pins oxfmt to an exact version, because a new release can change the layout
and fail the check on an untouched tree. Upgrade it in a commit of its own that also runs
`pnpm format`, and list that commit in `.git-blame-ignore-revs`.

## Make git blame skip formatting commits

The October 12, 2026 commit that first applied the formatter rewrapped most of the tree. To make
`git blame` skip it, and any later commit listed in `.git-blame-ignore-revs`, run this once in your
checkout:

```sh
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

## Carry a branch across a formatting commit

To bring a branch from before a formatting commit across it, let the formatter settle the layout
instead of resolving layout conflicts by hand. Replace `FMT` with that commit's SHA. The October 12
commit is the first one listed in `.git-blame-ignore-revs`.

```sh
git rebase FMT^                 # resolve any real conflicts here
git rebase -X theirs FMT        # a conflict with FMT is layout, so keep your side
git rebase main
pnpm install --frozen-lockfile
pnpm format
git commit -am 'Format'
```

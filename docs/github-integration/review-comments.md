# GitHub review comments source

This page covers the `github/review-comments` data source: what a record is, what it carries, and how
far a read goes. The pull request source it follows is in [GitHub integration](../github-integration.md).

## Records

`github/review-comments` has one record per review comment, scoped like the pull-request source. A
record is an inline comment on the diff, a reply in an inline thread, a review summary, or a
conversation comment on the pull request. Conversation comments count because a lot of review
feedback goes there, and a panel can filter them out by kind. A review summary is a submitted
review with text or a verdict. GitHub's empty wrapper for a batch of inline comments and a pending
review aren't records. Each record carries the pull request's number, title, repository, and URL, a
title of `<repository>#<number>: <title>`, the comment author, whether they wrote the pull request,
`kind` (`inline`, `reply`, `summary`, or `conversation`), the review state (`approved`,
`changes_requested`, `commented`, or `dismissed`), whether the thread is resolved, the created time,
and the comment URL. An inline comment takes the state of the review it belongs to. A record has no
comment text and no diff. Pressing a row opens the pull request, in Acorn when the repository is
tracked.

## Reads and limits

A lower bound on the created time becomes an `updated:>=` search, because a comment made after a
time is on a pull request updated after it. Every other filter runs after the read. The source
reads the 100 most recently updated matching pull requests, 20 a page, with up to 100 conversation
comments, 100 reviews, and 100 threads of 50 comments each. Past any of those caps, or the 16 MiB
budget, it keeps what it read, pages through it, and says it's incomplete on the last page. Its
starters chart review comments per pull request, who reviews most, and review comments per week.

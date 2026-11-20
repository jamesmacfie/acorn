# C-4. Cloud deployment can use a different Acorn revision from CI

Found November 20, 2026, in `acorn-cloud` at `19fa594`. Severity is medium. The independent
source selection is confirmed from the deployment workflow. Status is open.

## Evidence and impact

The test and deploy jobs independently check out the Acorn repository's default branch. The
deploy job passes its checkout's commit to the account Docker build and uses that checkout to
build the relay. A merge between the two jobs can make both deployed components use a different
revision from the one used for the account service's checks.

This weakens the release gate for components in the Node's trust boundary. The hosted phone app
can use paired Node credentials, as R-1 in [the November 20 review](../../security/review-2026-11-20.md) describes.
The issue concerns which commit a single workflow run checks and deploys. The service can keep
selecting Acorn's default branch for each run.

[Cloud workflow](https://github.com/jamesmacfie/acorn-cloud/blob/19fa594/.github/workflows/deploy.yml)
· [Phone app build](https://github.com/jamesmacfie/acorn-cloud/blob/19fa594/Dockerfile)

## Fix and verification

Resolve the Acorn commit once and pass it as a job output. Use that commit for the protocol,
phone app, and relay. Run the relevant phone and relay checks against the deployment candidate
and record both repository commits in the deployment.

Check that the resolved, tested, and deployed Acorn commits match even when the default branch
advances during the workflow. Check the commit recorded for the phone app and relay.

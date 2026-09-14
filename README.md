# Deploy Metabase on Render

This repo can be used to deploy [Metabase](https://metabase.com) on Render.

## Deployment

See the guide at https://render.com/docs/deploy-metabase.

If you need help, chat with us at https://render.com/chat.

## Automated version bumps (DATA-91)

`.github/workflows/bump-metabase.yml` runs weekly and, on demand, via
`workflow_dispatch`. It checks GitHub's releases for `metabase/metabase`, waits
at least 7 days after a release is published before considering it (a release
that gets hot-fixed or yanked shortly after publishing is skipped), and opens
a PR bumping the `Dockerfile`'s pinned tag — it never auto-merges and never
crosses the `0.x` (OSS) / `1.x` (Enterprise) boundary. It also posts to Slack
via a dedicated, channel-scoped Incoming Webhook (`SLACK_METABASE_WEBHOOK_URL`
repo secret) once a PR is open.

The version-parsing, cool-off and major/minor classification rules (Metabase's
scheme inverts semver — see comments in `scripts/metabase-release.mjs`) are
unit tested: `npm test` or `node --test scripts/*.test.mjs`.

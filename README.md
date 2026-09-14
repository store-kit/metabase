# Deploy Metabase on Render

This repo can be used to deploy [Metabase](https://metabase.com) on Render.

## Deployment

See the guide at https://render.com/docs/deploy-metabase.

If you need help, chat with us at https://render.com/chat.

## Automated version bumps (DATA-91)

`.github/workflows/bump-metabase.yml` runs weekly and, on demand, via
`workflow_dispatch`. It checks GitHub's releases for `metabase/metabase`, waits
at least 7 days after a release is published before considering it (a release
that gets hot-fixed or yanked shortly after publishing is skipped), and bumps
the `Dockerfile`'s pinned tag:

Both are fully automatic — there is no manual review step:

- **Major** (a new Metabase feature line — can ship an irreversible app-DB
  migration): opens a PR and merges it immediately, leaving a reviewable
  diff/audit trail behind even though nothing blocks on it.
- **Minor** (same feature line, bug/security fixes only): commits directly to
  `master`. No PR, since there's no need for even that trail.

Neither path ever crosses the `0.x` (OSS) / `1.x` (Enterprise) boundary
automatically. See `usesPullRequestFlow()` in `scripts/metabase-release.mjs`
for the single source of truth on which path a bump takes. It also posts to
Slack via a dedicated, channel-scoped Incoming Webhook
(`SLACK_METABASE_WEBHOOK_URL` repo secret) once either path completes — as
plain inline links in the message text, not Block Kit buttons, since a
button is an interactive element and Slack forwards its click to whichever
app's Interactivity Request URL is configured for the app this webhook
belongs to (misrouting into unrelated logic if that app is shared with
something else, as happened here once). The Slack message includes the
official release notes for the exact version bumped (converted from GitHub-
flavored markdown to Slack mrkdwn — see `toSlackMrkdwn()`) plus a link to
that release's GitHub page and a secondary link to metabase.com's general
changelog (not version-specific — metabase.com only breaks releases down by
major line, e.g. "Metabase 63").

The version-parsing, cool-off and major/minor classification rules (Metabase's
scheme inverts semver — see comments in `scripts/metabase-release.mjs`) are
unit tested: `npm test` or `node --test scripts/*.test.mjs`.

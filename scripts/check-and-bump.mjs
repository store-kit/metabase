#!/usr/bin/env node
// CLI entry point for the scheduled bump workflow. All version-comparison
// logic lives in metabase-release.mjs (unit tested); this file only does I/O:
// read the pinned tag, call the GitHub Releases API, and — if an eligible
// newer release exists — rewrite the Dockerfile and print the workflow
// outputs consumed by .github/workflows/bump-metabase.yml.
//
// Never opens a PR or posts to Slack itself; the workflow does both of those
// as separate steps so each stays easy to see in the Actions log.

import { readFile, writeFile, appendFile } from 'node:fs/promises';

import { pickNextRelease, usesPullRequestFlow, toSlackMrkdwn } from './metabase-release.mjs';

const COOL_OFF_DAYS = 7; // matches corona-admin/renovate.json's minimumReleaseAge convention
const RELEASES_URL = 'https://api.github.com/repos/metabase/metabase/releases?per_page=100';
const DOCKERFILE_PATH = new URL('../Dockerfile', import.meta.url);
const CHANGELOG_SUMMARY_MAX_CHARS = 600;

function currentTagFrom(dockerfileContents) {
    const match = /^FROM metabase\/metabase:(v[\d.]+)\s*$/m.exec(dockerfileContents);

    if (!match) {
        throw new Error('Could not find a "FROM metabase/metabase:vX.Y.Z" line in the Dockerfile');
    }

    return match[1];
}

async function fetchReleases() {
    const headers = { Accept: 'application/vnd.github+json' };

    if (process.env.GITHUB_TOKEN) {
        headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const response = await fetch(RELEASES_URL, { headers });

    if (!response.ok) {
        throw new Error(`GitHub Releases API returned ${response.status}: ${await response.text()}`);
    }

    return response.json();
}

function summarize(body) {
    if (!body) {
        return '(no release notes provided)';
    }

    const trimmed = body.trim();

    return trimmed.length > CHANGELOG_SUMMARY_MAX_CHARS
        ? `${trimmed.slice(0, CHANGELOG_SUMMARY_MAX_CHARS)}…`
        : trimmed;
}

async function writeOutputs(outputs) {
    const githubOutput = process.env.GITHUB_OUTPUT;

    for (const [key, value] of Object.entries(outputs)) {
        // Multiline values need the heredoc form so embedded newlines
        // (release notes) don't break GITHUB_OUTPUT's KEY=VALUE parsing.
        const line = value.includes('\n')
            ? `${key}<<__EOF__\n${value}\n__EOF__\n`
            : `${key}=${value}\n`;

        if (githubOutput) {
            await appendFile(githubOutput, line);
        } else {
            process.stdout.write(line);
        }
    }
}

async function main() {
    const dockerfile = await readFile(DOCKERFILE_PATH, 'utf8');
    const currentTag = currentTagFrom(dockerfile);
    const releases = await fetchReleases();
    const decision = pickNextRelease(currentTag, releases, new Date(), COOL_OFF_DAYS);

    if (!decision) {
        await writeOutputs({ should_bump: 'false' });
        console.log(`No eligible release newer than ${currentTag} (cool-off: ${COOL_OFF_DAYS} days).`);
        return;
    }

    const releaseObject = releases.find((release) => release.tag_name === decision.to);
    const updated = dockerfile.replace(
        /^FROM metabase\/metabase:v[\d.]+\s*$/m,
        `FROM metabase/metabase:${decision.to}`
    );

    await writeFile(DOCKERFILE_PATH, updated);

    // The GitHub release page for this exact tag is the only official source
    // that's actually version-specific — metabase.com's own /releases and
    // /changelog pages only go down to the major-version line (e.g.
    // "Metabase 63"), not individual patch releases like this one.
    const changelogUrl = releaseObject?.html_url ?? `https://github.com/metabase/metabase/releases/tag/${decision.to}`;
    const changelogSummary = summarize(releaseObject?.body);

    await writeOutputs({
        should_bump: 'true',
        from: decision.from,
        to: decision.to,
        kind: decision.kind,
        opens_pr: String(usesPullRequestFlow(decision.kind)),
        changelog_url: changelogUrl,
        changelog_summary: changelogSummary,
        // Separate from changelog_summary because the two render into
        // different markdown dialects: the PR body is real GitHub-flavored
        // markdown, the Slack message needs Slack mrkdwn.
        changelog_summary_slack: toSlackMrkdwn(changelogSummary)
    });

    console.log(`Bumping ${decision.from} -> ${decision.to} (${decision.kind}).`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

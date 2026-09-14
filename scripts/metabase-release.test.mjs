// Pure-logic tests for the version-check/cool-off/classification rules behind
// the scheduled Metabase bump workflow (DATA-91). No network access — release
// data is passed in as plain objects shaped like the GitHub Releases API
// response, so these run instantly in CI and locally.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseVersion, classifyBump, isEligible, pickNextRelease } from './metabase-release.mjs';

test('parseVersion accepts a 3-part release tag', () => {
    assert.deepEqual(parseVersion('v0.61.2'), { epoch: 0, major: 61, patch: 2, raw: 'v0.61.2' });
    assert.deepEqual(parseVersion('v0.61.21'), { epoch: 0, major: 61, patch: 21, raw: 'v0.61.21' });
    assert.deepEqual(parseVersion('v1.0.0'), { epoch: 1, major: 0, patch: 0, raw: 'v1.0.0' });
});

test('parseVersion rejects rolling and nightly tags', () => {
    // Docker Hub carries these alongside real releases; "highest tag wins"
    // would pick one of these instead of a real release.
    assert.equal(parseVersion('latest'), null);
    assert.equal(parseVersion('v0.63.x'), null);
    assert.equal(parseVersion('v0.58-lts'), null);
    assert.equal(parseVersion('v0.63.16.9'), null); // 4-part nightly build
});

test('classifyBump: same major line, patch differs -> minor (bug/security fixes)', () => {
    // Reads like a semver *patch* bump but Metabase calls this line a "minor".
    assert.equal(
        classifyBump(parseVersion('v0.61.2'), parseVersion('v0.61.21')),
        'minor'
    );
});

test('classifyBump: major number differs, same epoch -> major (feature release, irreversible migration)', () => {
    // Reads like a semver *minor* bump but this is Metabase's "major" line —
    // an irreversible app-DB migration with no downgrade path.
    assert.equal(
        classifyBump(parseVersion('v0.61.2'), parseVersion('v0.63.0')),
        'major'
    );
});

test('classifyBump: epoch differs -> epoch-change, never auto-applied', () => {
    // 0.x is OSS, 1.x is Enterprise. Crossing that boundary is never something
    // an automated bump should do.
    assert.equal(
        classifyBump(parseVersion('v0.61.21'), parseVersion('v1.0.0')),
        'epoch-change'
    );
});

test('isEligible: rejects a release younger than the cool-off period', () => {
    const now = new Date('2026-09-11T00:00:00Z');
    const release = {
        tag_name: 'v0.61.22',
        published_at: '2026-09-08T00:00:00Z', // 3 days old
        draft: false,
        prerelease: false
    };

    assert.equal(isEligible(release, now, 7), false);
});

test('isEligible: accepts a release at or past the cool-off period', () => {
    const now = new Date('2026-09-11T00:00:00Z');
    const release = {
        tag_name: 'v0.61.22',
        published_at: '2026-09-01T00:00:00Z', // 10 days old
        draft: false,
        prerelease: false
    };

    assert.equal(isEligible(release, now, 7), true);
});

test('isEligible: rejects drafts and prereleases regardless of age', () => {
    const now = new Date('2026-09-11T00:00:00Z');
    const old = '2026-01-01T00:00:00Z';

    assert.equal(isEligible({ tag_name: 'v0.63.0', published_at: old, draft: true, prerelease: false }, now, 7), false);
    assert.equal(isEligible({ tag_name: 'v0.63.0', published_at: old, draft: false, prerelease: true }, now, 7), false);
});

test('pickNextRelease: skips too-recent, rolling/nightly, and epoch-jump releases; picks the highest eligible same-epoch release above current', () => {
    const now = new Date('2026-09-11T00:00:00Z');
    const currentTag = 'v0.61.2';
    const releases = [
        { tag_name: 'v0.61.22', published_at: '2026-09-09T00:00:00Z', draft: false, prerelease: false }, // 2 days old, too new
        { tag_name: 'v0.61.21', published_at: '2026-08-20T00:00:00Z', draft: false, prerelease: false }, // eligible, highest same-line
        { tag_name: 'v0.61.10', published_at: '2026-07-01T00:00:00Z', draft: false, prerelease: false }, // eligible but lower than .21
        { tag_name: 'v0.63.16.9', published_at: '2026-08-01T00:00:00Z', draft: false, prerelease: false }, // nightly, rejected by parseVersion
        { tag_name: 'v1.0.0', published_at: '2026-01-01T00:00:00Z', draft: false, prerelease: false } // epoch jump, never auto-picked
    ];

    const result = pickNextRelease(currentTag, releases, now, 7);

    assert.deepEqual(result, {
        from: 'v0.61.2',
        to: 'v0.61.21',
        kind: 'minor'
    });
});

test('pickNextRelease: returns null when nothing eligible is newer than current', () => {
    const now = new Date('2026-09-11T00:00:00Z');
    const releases = [
        { tag_name: 'v0.61.2', published_at: '2026-05-19T00:00:00Z', draft: false, prerelease: false }, // == current
        { tag_name: 'v0.61.22', published_at: '2026-09-09T00:00:00Z', draft: false, prerelease: false } // too new
    ];

    assert.equal(pickNextRelease('v0.61.2', releases, now, 7), null);
});

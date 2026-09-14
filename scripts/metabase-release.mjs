// Version-check, cool-off and classification rules for the scheduled Metabase
// bump (DATA-91). Deliberately dependency-free and separated from any network
// I/O so it can be unit tested in isolation — see metabase-release.test.mjs.
//
// Metabase's tag scheme inverts semver: for a tag like `v0.61.2`, the middle
// number (61) is Metabase's own "major" line (a feature release that can ship
// an irreversible app-DB migration — no downgrade without restoring a backup),
// and the last number (2) is Metabase's "minor" (a bug/security fix, safe to
// take). The leading number (0 vs 1) is the *edition* — 0.x is OSS, 1.x is
// Enterprise — and must never change via an automated bump.
//
// Docker Hub also carries rolling tags (`latest`, `v0.63.x`, `v0.58-lts`) and
// nightly 4-part build tags (`v0.63.16.9`) alongside real 3-part releases, so
// "highest tag wins" would pick the wrong thing. `parseVersion` rejects
// anything that isn't a plain 3-part `vEPOCH.MAJOR.PATCH` tag.

const VERSION_RE = /^v(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(tag) {
    const match = VERSION_RE.exec(tag);

    if (!match) {
        return null;
    }

    const [, epoch, major, patch] = match;

    return {
        epoch: Number(epoch),
        major: Number(major),
        patch: Number(patch),
        raw: tag
    };
}

// 'major' | 'minor' | 'same' | 'epoch-change'
export function classifyBump(from, to) {
    if (from.epoch !== to.epoch) {
        return 'epoch-change';
    }

    if (from.major !== to.major) {
        return 'major';
    }

    if (from.patch !== to.patch) {
        return 'minor';
    }

    return 'same';
}

// Whether a human must review this bump before it takes effect. Only a
// "major" bump (a new feature line that can ship an irreversible app-DB
// migration) needs a PR; a "minor" bump (same feature line, bug/security
// fixes only) is safe to apply directly. Single source of truth for the
// workflow's branching, so the policy lives in one tested place instead of
// being duplicated across multiple `if:` conditions in the YAML.
export function requiresReview(kind) {
    return kind === 'major';
}

export function isEligible(release, now, coolOffDays) {
    if (release.draft || release.prerelease) {
        return false;
    }

    const publishedAt = new Date(release.published_at);
    const ageMs = now.getTime() - publishedAt.getTime();
    const coolOffMs = coolOffDays * 24 * 60 * 60 * 1000;

    return ageMs >= coolOffMs;
}

function compareVersions(a, b) {
    if (a.epoch !== b.epoch) {
        return a.epoch - b.epoch;
    }

    if (a.major !== b.major) {
        return a.major - b.major;
    }

    return a.patch - b.patch;
}

// Picks the highest eligible, same-epoch release newer than `currentTag`.
// Returns null when nothing qualifies. Never crosses an epoch boundary
// (OSS <-> Enterprise) — that is a human decision, not an automated one.
export function pickNextRelease(currentTag, releases, now, coolOffDays) {
    const current = parseVersion(currentTag);

    if (!current) {
        throw new Error(`Current pinned tag "${currentTag}" is not a parseable release tag`);
    }

    let best = null;

    for (const release of releases) {
        const version = parseVersion(release.tag_name);

        if (!version) {
            continue; // rolling/nightly tag, not a real release
        }

        if (version.epoch !== current.epoch) {
            continue; // never auto-cross OSS <-> Enterprise
        }

        if (compareVersions(version, current) <= 0) {
            continue; // not newer than what's pinned today
        }

        if (!isEligible(release, now, coolOffDays)) {
            continue; // inside the cool-off window
        }

        if (!best || compareVersions(version, best) > 0) {
            best = version;
        }
    }

    if (!best) {
        return null;
    }

    return {
        from: current.raw,
        to: best.raw,
        kind: classifyBump(current, best)
    };
}

# Impeccable identity, release versions, and marketplace source

The vanilla repack retains plugin name `impeccable` and display name **Impeccable**, preserves upstream authorship, and identifies `nisavid/impeccable` as its repack source. Repack releases adopt Real Skills' upstream-derived version allocation, so packaging corrections are distinguishable without changing upstream skill bytes or their embedded version. Reviewed packaging source lives on `main`; consumers follow a separate generated `marketplace` branch, so routine distribution updates do not require source changes on protected `main`.

## Version notation and allocation

The package version uses the fork's numeric version, with upstream provenance appended only when the versions differ:

| Relationship | Upstream baseline | Fork package version |
| --- | --- | --- |
| Fork version equals upstream | `4.8.0` | `4.8.0` |
| Fork version differs | `4.8.0` | `4.8.1+from.4.8.0` |

The equal-version case is part of the general Real Skills scheme. Its current archive exporter implements the narrower advanced-patch path; that restriction does not make `+from` mandatory for every fork release. Exact upstream tags, commits, and consumed asset identities remain in provenance in both cases.

Version selection still requires the complete exposure inventory, including public releases and private/account deliveries. Withdrawn versions remain exposed. A changed package must have a greater numeric version than previously exposed packages in its release sequence; a metadata-only change cannot establish upgrade precedence. Matching upstream is allowed only when those exposure and changed-content checks permit it. An uncertain inventory or upstream baseline prevents allocation.

When a fork-only advanced patch is needed for upstream baseline `M.m.U`, allocate `M.m.P+from.M.m.U`, where:

```text
P = max(highest previously exposed fork patch in that M.m line, U) + 1
```

For that advanced-patch case on a new higher major/minor line with no fork exposure, `P = U + 1`. For example, after exposing `4.8.1+from.4.8.0`, a packaging correction uses `4.8.2+from.4.8.0`; a subsequent update to upstream `4.8.1` uses `4.8.3+from.4.8.1`. There is no counter reset on upstream patch updates. These examples allocate nothing and do not require an initial faithful repack to advance beyond an otherwise eligible upstream version.

One allocated full version applies to every package format and supported surface; a consumer-specific spelling requires demonstrated incompatibility. The numeric core supplies version precedence, while `+from` records a differing upstream baseline. This stable-release scheme does not define prerelease allocation or an independent downstream major/minor compatibility policy.

The maintained advanced-patch allocation and provenance procedure is [Real Skills' release policy at `0c1ebe0`](https://github.com/nisavid/real-skills/blob/0c1ebe0a778a861dbfee9bb2f84dec7c9ad1cf6a/docs/agents/release-archives.md#L9-L13). Release preparation reads that pinned procedure together with this decision's equal-version case before allocating a version, and records the exposure inventory and exact upstream tag, commit, and asset identities. Real Skills' particular source-manifest synchronization commands and old distribution-ref name are not Impeccable requirements.

## Source and consumer identity

The generated marketplace contains `.agents/plugins/marketplace.json` and the qualified package under `plugins/impeccable/`. Each repack has an immutable `repack-v<full-package-version>` tag; the moving `marketplace` branch advances only after the selected checks pass. Upstream `skill-v*` release identities remain separate. Package manifests agree on the allocated repack version while the copied upstream skill retains its own version.

The selected identity does not establish collision-free replacement, account migration, update detection, or propagation. Qualification retains the working installation until the replacement's required behavior is observed. Publication recovery and consumer rollback behavior remain to be settled in the [qualification and promotion decision](https://github.com/nisavid/impeccable/issues/6). Failed qualification preserves the last qualified publication.

The [identity decision](https://github.com/nisavid/impeccable/issues/4) records the selected naming, versioning, and ref layout. The examples above remain illustrative until a release allocation verifies the upstream baseline and exposure inventory.

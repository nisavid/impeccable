# Impeccable identity, release versions, and marketplace source

The vanilla repack retains plugin name `impeccable` and display name **Impeccable**, preserves upstream authorship, and identifies `nisavid/impeccable` as its repack source. Repack releases adopt Real Skills' upstream-derived version allocation, so packaging corrections are distinguishable without changing upstream skill bytes or their embedded version. Reviewed packaging source lives on `main`; consumers follow a separate generated `marketplace` branch, so routine distribution updates do not require source changes on protected `main`.

## Version allocation

The full package version is `M.m.P+from.M.m.U`, where `M.m.U` is the actual released upstream baseline. For the selected major/minor line:

```text
P = max(highest previously exposed fork patch in that line, U) + 1
```

For a new higher major/minor line with no prior fork exposure, `P = U + 1`. The exposure inventory covers public releases and private/account deliveries; withdrawn versions remain exposed. An uncertain inventory or upstream baseline prevents allocation. One allocated version applies to every package format and supported surface; a consumer-specific spelling requires demonstrated incompatibility with that uniform version.

These examples assume no higher prior exposure and allocate no release:

| Change | Upstream baseline | Repack version |
| --- | --- | --- |
| First repack | `4.8.0` | `4.8.1+from.4.8.0` |
| Packaging correction | `4.8.0` | `4.8.2+from.4.8.0` |
| Upstream patch update | `4.8.1` | `4.8.3+from.4.8.1` |
| New upstream minor | `4.9.0` | `4.9.1+from.4.9.0` |

An upstream jump to `4.8.9` requires at least `4.8.10+from.4.8.9`. There is no counter reset for a new upstream patch. The numeric core supplies version precedence; `+from` records provenance and cannot alone signal an upgrade. This stable-release scheme does not define prerelease allocation or an independent downstream major/minor compatibility policy.

The maintained allocation and provenance procedure is [Real Skills' release policy at `0c1ebe0`](https://github.com/nisavid/real-skills/blob/0c1ebe0a778a861dbfee9bb2f84dec7c9ad1cf6a/docs/agents/release-archives.md#L9-L13). Release preparation reads that pinned rule and this decision before allocating a version, and records the exposure inventory and exact upstream tag, commit, and asset identities. Real Skills' particular source-manifest synchronization commands and old distribution-ref name are not Impeccable requirements.

## Source and consumer identity

The generated marketplace contains `.agents/plugins/marketplace.json` and the qualified package under `plugins/impeccable/`. Each repack has an immutable `repack-v<full-package-version>` tag; the moving `marketplace` branch advances only after the selected checks pass. Upstream `skill-v*` release identities remain separate. Package manifests agree on the allocated repack version while the copied upstream skill retains its own version.

The selected identity does not establish collision-free replacement, account migration, update detection, or propagation. Qualification retains the working installation until the replacement's required behavior is observed. Publication recovery and consumer rollback behavior remain to be settled in the [qualification and promotion decision](https://github.com/nisavid/impeccable/issues/6). Failed qualification preserves the last qualified publication.

The [identity decision](https://github.com/nisavid/impeccable/issues/4) records the selected naming, versioning, and ref layout. The examples above remain illustrative until a release allocation verifies the upstream baseline and exposure inventory.

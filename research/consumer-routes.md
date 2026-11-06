# Impeccable portable payload and consumer routes

The smallest candidate preserves upstream's existing OpenAI plugin assembly and adds an Agent Plugins 1.0 root manifest, license, notices, and repack provenance. It retains the Codex-transformed skill, its support files, and both upstream hooks. Package acceptance and runtime behavior still need separate qualification in ChatGPT, local Codex, and Codex Cloud.

Inspected on **2026-11-06** for [the consumer-routes decision](https://github.com/nisavid/impeccable/issues/3). “Observed” below means file, source, API, or documentation inspection unless a stronger observation is explicitly named. No plugin was built, installed, uploaded, enabled, or invoked; no engine binary was downloaded or executed.

## Pinned input and observed contents

| Input | Recorded identity |
| --- | --- |
| Upstream release | [`skill-v4.8.0`](https://github.com/pbakaus/impeccable/releases/tag/skill-v4.8.0), release ID `424884908`, published `2026-10-26T23:41:42Z` |
| Annotated tag object | `09aef2fd2e3a2c7138f3e1a6cbbbdcb3f4087c2d` |
| Peeled source commit | [`414603bf14c7a344edb466bb1f85690c77ce8b7d`](https://github.com/pbakaus/impeccable/tree/414603bf14c7a344edb466bb1f85690c77ce8b7d) |
| `universal.zip` | Asset ID `679840857`; 18,116,588 bytes; SHA-256 `82e6f6ff3a2b18f46f0f2fc388c1ab7abf3ccc52bbfc522456396d13011d6706` |
| `universal.zip.sig.json` | Asset ID `679840856`; 348 bytes; SHA-256 `b4e1ac4ed9d3050fcedae38fa3d57e1e685cfd628a47b3d5c2f2ee9b3303ee02` |

I downloaded the [archive][archive] and [signature asset][signature], recomputed both digests, and matched GitHub's release-asset metadata. The Ed25519 signature verified using key `release-2026-09` from the pinned [`scripts/bundle-signing-keys.json`][keys]. That verifies the signed content against this source-supplied key; it is not an independently authenticated trust root. A repack needs its own digest and provenance: the upstream signature authenticates the original archive, not the changed archive. Tags and release assets remain replaceable references, so retain the commit, asset IDs, sizes, and digests together.

The archive has 1,408 entries and 46,425,709 uncompressed bytes. It contains multiple provider distributions, not one plugin root. It has no root `plugin.json`, `LICENSE`, or `NOTICE.md`. The selected `.codex/skills/impeccable/` subtree contains **63 regular files totaling 2,239,999 bytes**: one `SKILL.md`, 45 reference files, 12 script/data files, and five agent files. The launcher has executable mode; no engine binary is bundled. Its `SKILL.md` SHA-256 is `ece1ea72d815b9d42c732937925616400a9b1bf5c8d950e7a30b1f3d6372cae8`; frontmatter identifies skill `impeccable`, version `4.8.0`. These are archive observations, not successful loading observations. [Inspected release asset][archive]

## Reuse the existing OpenAI assembly

Upstream already defines `stageOpenAIPlugin`: it copies the Codex projection into `skills/impeccable`, adds an icon, writes `.codex-plugin/plugin.json`, and generates `hooks/hooks.json`. The build produces `dist/openai-plugin.zip`, but this release attaches only the universal archive and its signature. The tracked `plugin/` subtree is a Claude distribution; the OpenAI stager deliberately uses a different provider projection. [OpenAI stager][stager], [build entry point][build], [release assets](https://github.com/pbakaus/impeccable/releases/tag/skill-v4.8.0)

The proposed package preserves that assembly:

```text
plugin.json                    # new portable identity and metadata
.codex-plugin/plugin.json      # upstream OpenAI compatibility shape
assets/icon.png                 # upstream icon
hooks/hooks.json               # both upstream OpenAI hook events
skills/impeccable/              # all 63 Codex projection files, unchanged
LICENSE                        # pinned upstream license
NOTICE.md                      # pinned upstream notices
UPSTREAM.json                  # proposed repack provenance record
```

`UPSTREAM.json` is a proposed packaging record, not a consumer requirement. It should identify the input commit, archive/signature digests, selected subtree, packaging revision, and output inventory. Keep wrapper changes separate from upstream skill bytes. Do not regenerate the skill with a newer transformer or normalize archive line endings during repacking; that would introduce a different input. The `.codex` projection is present in the signed archive but is not tracked at this source commit, so the archive is its byte authority. [Archive][archive], [provider transformer][providers]

For the remote marketplace, the smallest proposed repository layout is `.agents/plugins/marketplace.json` plus this package under `plugins/impeccable/`. The catalog entry can use `source: {"source":"local","path":"./plugins/impeccable"}`; that path is relative to the marketplace root. The moving ref would identify the repository snapshot containing both. This is a proposed layout, not a published catalog. [Marketplace layout contract][packaging]

Agent Plugins 1.0 uses root `plugin.json`, the canonical `$schema`, and a valid `name`; portable skills live at `skills/<name>/SKILL.md`. Its schema does not use a top-level custom `skills` path. Version is optional in the format, but this release workflow should always supply one. The format does not define a universal distribution or update service. [Agent Plugins specification][spec]

OpenAI documents `.codex-plugin/plugin.json` as a fallback when `extensions.com.openai` is absent; root identity remains canonical. Keeping that fallback avoids translating upstream's overlay unnecessarily. If an inline extension is chosen later, it must carry all required settings because it replaces, rather than merges with, the fallback. Codex discovers `hooks/hooks.json` by default. [OpenAI package and overlay contract][packaging]

The upstream hook generator supplies **PostToolUse** for `Edit|Write|apply_patch` and **Stop**, invoking the bundled launcher with `hook` through `${PLUGIN_ROOT}`; it includes the Windows command variant. Retain both events and their upstream commands. Selecting the hook-free `.agents` provider or omitting the plugin hook would change this behavior. [Hook generator][hooks], [provider configuration][providers]

This gives a documented way to retain the provider payload and hook declarations without semantic edits to them. It does **not** prove that every consumer runs those hooks. OpenAI documents manual Codex desktop hook support and separate trust review; hooks also make a package ineligible for its public directory. Directory submission is outside this effort, so that restriction supplies no reason to remove them. [OpenAI hook contract][packaging]

No new human decision is needed to preserve these upstream components. The existing identity/layout decision still needs to settle fork package and marketplace names, publisher attribution, and the repack version scheme. Whether a consumer can load and execute the retained hook is a qualification observation. Only an observed limitation that forces dropping behavior, changing upstream content, or accepting a reduced consumer capability needs a new scope decision.

## Consumer matrix

| Consumer and route | Documented support | What remains unobserved |
| --- | --- | --- |
| ChatGPT account/workspace ZIP | ZIP upload and updating an uploaded plugin are available on eligible accounts and workspaces; access depends on plan, role, region, and surface. [ChatGPT help][chatgpt] | Actual eligibility, archive validation, stable plugin identity, discovered skill/support files, and usable script/engine capabilities. File acceptance alone would not qualify Impeccable's workflow. |
| ChatGPT workspace GitHub marketplace | Workspace admins can import a GitHub marketplace, select a branch/tag/commit, and sync it. The integration accepts Agent Plugins entries. [Workspace integration][workspace] | Whether this workspace has the integration, the selected catalog/ref is accepted, the plugin is visible to intended members, and source updates reach their active clients. |
| Local Codex desktop and CLI | Plugin use is documented for desktop and CLI; CLI users start a new session after installation. IDE extensions do not currently support plugins. [Plugin surfaces][surfaces] A Git marketplace can be added with a selected ref and explicitly upgraded. [Marketplace commands][packaging] | First install, discovery, relocated paths, engine resolution, command execution, hook trust and delivery on each claimed client/platform, and updating an existing install. |
| Codex Cloud plugin route | The general Agent Plugins compatibility list names Codex, but does not establish this particular Cloud route. [Compatible clients][clients] | **Unknown:** whether an account-uploaded or remote-marketplace plugin is delivered into the intended Cloud task, and how its identity, version, hooks, and updates propagate. |
| Codex Cloud repository skill route | Current Cloud VM docs say repository skills are available and personal local skills are not synchronized. They list computer/browser use as unsupported. [Cloud VM environments][cloud] | Whether a repository-mounted skill is an acceptable alternative to the requested plugin route, and which Impeccable operations work in that environment. Do not silently substitute it for plugin delivery or claim browser-dependent features. |

The current Cloud VM documentation and the separate [legacy Cloud environment documentation](https://learn.chatgpt.com/docs/environments/cloud-environment) describe different environments. I have not applied the legacy container's networking defaults to the current VM route. Record the actual Cloud product surface and task configuration during qualification. [Current Cloud VM environments][cloud]

Workspace GitHub sync is documented as **daily**, with manual “Sync now.” Initial synchronization can take longer than later syncs; a completed sync may still contain per-plugin errors. Invalid updates retain the previous working plugin. Therefore hourly publication does not promise hourly workspace delivery. A pinned commit intentionally does not follow future publications. This cadence applies to the workspace GitHub integration, not every local or account installation. [Workspace synchronization][workspace]

## Runtime and provenance that must survive repacking

The skill's setup invokes its launcher with `context` from the installed skill base directory. Its reference files, command metadata, live-mode scripts, agent instructions, and engine checksums are support files, not expendable documentation. The skill also describes a reduced reference-reading path when the launcher cannot run; that is not evidence that its engine-backed operations work. [Selected skill bytes][archive], [source skill][skill]

The pinned engine version is **0.1.18**. The launcher can use an override, a sibling binary, an existing home or PATH binary accepted by its engine handshake, or a versioned cached/downloaded binary. The handshake for existing candidates does not require equality with the pinned version. Consequently the declared pin does not alone establish which engine executes. Cold acquisition requires a supported platform, shell, download/hash tools, writable cache, and access to GitHub release assets. Preserve the launcher and bundled checksum file; record the actual engine path, version, and digest in later qualification. [Launcher][launcher], [engine pin][enginepin]

The checksum file matches these asset digests in the [engine release metadata][engine]. I checked metadata, not downloaded executable bytes:

| Engine asset platform | Bytes | SHA-256 |
| --- | ---: | --- |
| darwin-arm64 | 17,721,856 | `543ee2f72036ad185dc9991ac3ba86b74d91f988f3d497776a088b8b65c8a9e1` |
| darwin-x64 | 19,960,488 | `1f1eee78c142f7e40e16f481aeeeb1fad1d8515d8a1ef033d7c6d133e52232b3` |
| linux-arm64 | 18,366,856 | `317cb18d64b0f7715681dd6e574ad64b2adb5a6caf8e7a1b3b57965f805404be` |
| linux-x64 | 21,984,304 | `736ed785e74ae2344d3036127f614ddde5ab520a527d8bc82a891612ef71f648` |
| windows-x64 | 20,435,344 | `8f61e96b0c97001546a824d79b44f46b423b560f3eb1a0cc44a8695a1b395d9f` |

Include the pinned Apache-2.0 `LICENSE` and `NOTICE.md`, retaining existing attribution in the payload. The notice includes MIT-derived platform guidance attribution. Their observed SHA-256 values are respectively `02bb8c3b4e70190e3986c0404ad2fd8d639b4f534252d82379cc1b502b6d1812` and `c60a093c2845fd9fb82f9c6f742ece31f379f8190b535309d32d66c45ccffdcb`. The upstream stager does not itself copy these root files. Preserve upstream authorship while identifying the fork's packaging publisher accurately; its upstream listing metadata is not proof of the fork publisher's identity. [License][license], [notice][notice], [stager][stager], [upstream manifest builder][manifest]

## Identity, version, and update rules

Keep these identities distinct: upstream `skill-v4.8.0` and source digest; skill name `impeccable`; fork plugin name and package version; marketplace name and plugin entry; Git ref/commit; and a hosted account's plugin ID. Packaging-only revisions need their own distinguishable, increasing release versions without rewriting the upstream skill's embedded version. Exact naming and version mapping remain the existing identity decision. [Portable identity/version contract][spec], [upstream manifest builder][manifest]

For local Codex, I inspected source at [`814347ecd21b49d25479f5499f168b9f7b7e1803`](https://github.com/openai/codex/tree/814347ecd21b49d25479f5499f168b9f7b7e1803). Ordinary non-curated refresh compares the source manifest version and may skip replacement when unchanged; marketplace upgrades can force reinstall after activating changed source. Thus neither “the branch moved, so every client updated” nor “same version can never refresh” is supported. Use new versions for changed packages and qualify the actual update command/session behavior. This source revision is not proof of the installed client's exact implementation. [Loader][loader], [manager][manager], [marketplace upgrade][upgrade]

Read-only CLI inspection returned `codex-cli 0.166.0` and exposed `plugin marketplace add`, `list`, `upgrade`, and `remove`; none of those operations was run. The help inspection does not qualify a remote source or update.

For hosted uploads, update the existing plugin rather than creating a second identity. The discovered Plugin Creator `update_plugin` contract requires the existing plugin ID and current release ID; omitted files persist unless explicitly deleted. It also describes automatic patch increment when the submitted semantic version is unchanged, including a build-metadata-only change. These are observed API declarations, not an executed update, so do not assume that `+repack` alone controls hosted versions.[^creator] The public help separately distinguishes manually updated uploads from source-managed plugins. [Uploaded plugin updates][chatgpt]

Workspace migration from an upload to GitHub management can use `pluginId` with a matching name in the same workspace and preserve identity; subsequent updates come from GitHub, not archive upload. Select that route explicitly before testing both writers on one plugin. [Workspace source management][workspace]

## Bounded checks and later qualification

These observations are the next evidence needed, not checks already passed:

1. **Package construction:** reproduce the pinned upstream OpenAI assembly; compare all 63 copied skill files byte-for-byte with the signed archive, preserve launcher modes, compare both generated hook events with the pinned generator, and include the pinned icon/license/notices. Validate the portable manifest and the compatibility overlay together. Reject duplicate archive paths, traversal, escaping links, missing references, multiple plugin roots, and unexpected executables. Record a deterministic inventory and repack digest.
2. **Local installation:** in an explicitly authorized isolated client profile, install the remote marketplace candidate and record source commit, plugin identity, selected version, skill discovery, and actual installed root. Invoke setup from a project with a different path so accidental source-tree dependencies are visible. Record launcher/engine selection, one reference-backed operation, and one engine-backed operation. Observe PostToolUse and Stop separately after the required hook trust action. Do not count a guard's successful no-op as hook execution.
3. **ChatGPT upload:** upload the exact candidate bytes through the intended account/workspace route; read back its assigned identity/version and detected components. In a fresh task, establish which support files and execution capabilities are available, then exercise representative skill and engine operations. Record unsupported/degraded operations explicitly rather than treating ingestion as functional acceptance.
4. **Codex Cloud:** first establish the intended plugin transport and observe its files and identity in a fresh task. If no supported transport can be established, retain the plugin route as unresolved and bring back the concrete choice of repository-skill delivery or a narrower capability claim. If delivered, observe setup and an engine-backed operation with the actual network and execution policy. Browser/live behavior needs its own supported surface; the current VM docs do not supply one.
5. **Updates and retention:** qualify initial install N, upstream refresh N+1, and a packaging-only revision using the same installed identity. Observe the relevant local upgrade, hosted upload, or workspace sync, then a fresh task's loaded bytes/version. Exercise failure retention and return to a previously qualified package without deleting or replacing unrelated installations. Measure publication, synchronization, and fresh-session availability separately; daily workspace sync cannot substantiate an hourly end-to-end guarantee.

The research establishes a concrete package candidate and the documented routes. It leaves client acceptance, actual execution, update propagation, and Cloud plugin delivery for those bounded observations. No install or runtime claim is made by this report.

[^creator]: Primary evidence: the available Plugin Creator `update_plugin` tool's input/output contract, inspected on 2026-11-06 through read-only tool discovery. No account state was queried and the operation was not called. This contract has no public permalink in the discovered surface; its behavior must be rechecked before implementation.

[archive]: https://github.com/pbakaus/impeccable/releases/download/skill-v4.8.0/universal.zip
[signature]: https://github.com/pbakaus/impeccable/releases/download/skill-v4.8.0/universal.zip.sig.json
[keys]: https://github.com/pbakaus/impeccable/blob/414603bf14c7a344edb466bb1f85690c77ce8b7d/scripts/bundle-signing-keys.json
[stager]: https://github.com/pbakaus/impeccable/blob/414603bf14c7a344edb466bb1f85690c77ce8b7d/scripts/lib/openai-plugin.js
[build]: https://github.com/pbakaus/impeccable/blob/414603bf14c7a344edb466bb1f85690c77ce8b7d/scripts/build.js
[providers]: https://github.com/pbakaus/impeccable/blob/414603bf14c7a344edb466bb1f85690c77ce8b7d/scripts/lib/transformers/providers.js
[hooks]: https://github.com/pbakaus/impeccable/blob/414603bf14c7a344edb466bb1f85690c77ce8b7d/scripts/lib/transformers/hooks.js
[manifest]: https://github.com/pbakaus/impeccable/blob/414603bf14c7a344edb466bb1f85690c77ce8b7d/scripts/lib/codex-plugin.js
[skill]: https://github.com/pbakaus/impeccable/blob/414603bf14c7a344edb466bb1f85690c77ce8b7d/skill/SKILL.src.md
[launcher]: https://github.com/pbakaus/impeccable/blob/414603bf14c7a344edb466bb1f85690c77ce8b7d/skill/scripts/impeccable
[enginepin]: https://github.com/pbakaus/impeccable/blob/414603bf14c7a344edb466bb1f85690c77ce8b7d/ENGINE_VERSION
[engine]: https://github.com/pbakaus/impeccable/releases/tag/engine-v0.1.18
[license]: https://github.com/pbakaus/impeccable/blob/414603bf14c7a344edb466bb1f85690c77ce8b7d/LICENSE
[notice]: https://github.com/pbakaus/impeccable/blob/414603bf14c7a344edb466bb1f85690c77ce8b7d/NOTICE.md
[spec]: https://agent-plugins.org/specification
[clients]: https://agent-plugins.org/compatible-clients
[packaging]: https://developers.openai.com/plugins/build/plugins
[chatgpt]: https://help.openai.com/en/articles/20001256-plugins-in-chatgpt
[workspace]: https://learn.chatgpt.com/docs/enterprise/plugin-management
[surfaces]: https://learn.chatgpt.com/docs/plugins
[cloud]: https://learn.chatgpt.com/docs/environments/cloud-environments
[loader]: https://github.com/openai/codex/blob/814347ecd21b49d25479f5499f168b9f7b7e1803/codex-rs/core-plugins/src/loader.rs
[manager]: https://github.com/openai/codex/blob/814347ecd21b49d25479f5499f168b9f7b7e1803/codex-rs/core-plugins/src/manager.rs
[upgrade]: https://github.com/openai/codex/blob/814347ecd21b49d25479f5499f168b9f7b7e1803/codex-rs/core-plugins/src/marketplace_upgrade.rs

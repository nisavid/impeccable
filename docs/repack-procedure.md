# Build an Impeccable repack candidate

`scripts/repack.mjs` reserves a version, builds a portable plugin archive and matching marketplace tree, and validates the retained bytes. It performs no network requests, release uploads, tag writes, or marketplace promotion. Use it from the independently reviewed procedure revision under the [acceptance plan](repack-acceptance-plan.md). A candidate remains unqualified until that plan's runtime and consumer observations pass.

## Collect immutable inputs

Enumerate every upstream release page, retaining the response identities and pagination evidence. Pass `select` a JSON object with `complete: true` and the complete `releases` array. The selector chooses the numerically highest published stable `skill-vMAJOR.MINOR.PATCH`, excluding drafts, prereleases, and other components. `complete` is an explicit assertion by the collecting procedure; the offline selector cannot establish it.

```sh
node scripts/repack.mjs select releases.json
```

Reconcile the selected release ID, tag object, and peeled commit before and after downloading inputs. Pin both published assets, `universal.zip` and `universal.zip.sig.json`, by asset ID, size, and SHA-256. Fetch these supplemental files from the selected source commit and compare their bytes and modes directly with that commit's Git blobs:

- `.claude-plugin/plugin.json`
- `LICENSE` and the complete enrolled notice inventory
- `scripts/lib/assets/plugin-icon.png`

The archive's Ed25519 signature authenticates its version, artifact name, size, and digest. It does not cover the supplemental source files or authenticate their publisher independently. Preserve source-fetch and tag reconciliation evidence separately. An unsigned tag and a commit-pinned hash identify source inputs; they do not supply another signing trust root.

`pin.json` carries this shape; hexadecimal strings represent full lowercase hashes:

```json
{
  "schema": 1,
  "repository": "pbakaus/impeccable",
  "version": "4.8.0",
  "releaseId": 101,
  "tag": "skill-v4.8.0",
  "tagObject": "<40 hex>",
  "commit": "<40 hex>",
  "assets": [
    {"id": 1, "name": "universal.zip", "size": 123, "sha256": "<64 hex>"},
    {"id": 2, "name": "universal.zip.sig.json", "size": 348, "sha256": "<64 hex>"}
  ],
  "sourceFiles": [
    {"name": ".claude-plugin/plugin.json", "sourcePath": ".claude-plugin/plugin.json", "mode": 420, "sha256": "<64 hex>"},
    {"name": "LICENSE", "sourcePath": "LICENSE", "mode": 420, "sha256": "<64 hex>"},
    {"name": "NOTICE.md", "sourcePath": "NOTICE.md", "mode": 420, "sha256": "<64 hex>"},
    {"name": "scripts/lib/assets/plugin-icon.png", "sourcePath": "scripts/lib/assets/plugin-icon.png", "mode": 420, "sha256": "<64 hex>"}
  ]
}
```

The IDs and sizes above illustrate the shape, not release inputs. Unix mode `420` is decimal `0644`.

## Enroll the supported upstream surface

The reviewed `policy.json` supplies `schema: 1`, `repository: "pbakaus/impeccable"`, the accepted Ed25519 `keyId` and 64-character public key in `publicKey`, and the accepted `license` identifier. Its remaining fields are:

| Field | Enrolled value |
| --- | --- |
| `skillPrefix` | `.codex/skills/impeccable/` |
| `projectSkillPath` | `.codex/skills/impeccable` |
| `projectHooksPath` | `.codex/hooks.json` |
| `hooks` | Complete expected native plugin hook object after the path substitutions below |
| `licenseFiles` | Every copied license and notice, each with `name` and `sha256` |
| `requiredSkillFiles` | Required relative support paths, including `SKILL.md`, launcher, Windows launcher, and engine `VERSION` |
| `executableFiles` | Complete sorted list of relative files with any Unix executable bit |
| `runtimeFiles` | Complete relative inventory under `scripts/` and `agents/`, plus files elsewhere with supported executable extensions |
| `runtimeOrigins` | Complete sorted literal HTTP(S) origins found in those runtime files |

Enrollment requires review; deriving a fresh policy from every downloaded payload would bypass the capability-change gate. Runtime-file discovery also recognizes `.js`, `.mjs`, `.cjs`, `.sh`, `.cmd`, `.bat`, `.ps1`, `.py`, `.rb`, `.pl`, `.wasm`, `.exe`, `.dll`, `.so`, and `.dylib`. The origin scanner recognizes literal strings only. It cannot establish that a program has no dynamic endpoints or other new behavior. Investigate suspected expansion under the trust decision even if this scanner passes.

The builder copies the complete signed Codex skill subtree byte for byte, preserving `0644` and `0755` modes. It preserves both upstream hook events and every handler field, replacing `.codex/skills/impeccable` with `${PLUGIN_ROOT}/skills/impeccable` and the corresponding Windows path with `${PLUGIN_ROOT}\skills\impeccable`. Guards, matchers, timeouts, and status messages retain their upstream semantics. The resulting object must match `policy.hooks` exactly.

The portable root uses the [Agent Plugins 1.0.0 schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json). Its complete `extensions.com.openai` overlay equals `.codex-plugin/plugin.json`, following the [OpenAI overlay contract](https://developers.openai.com/plugins/build/plugins#add-an-openai-and-codex-overlay). Both manifests retain selected upstream authorship, description, and homepage, identify the fork repository, and carry one allocated version. Wrapper metadata supplies display name Impeccable, icon paths, `skills: "./skills/"`, and explicit `hooks: "./hooks/hooks.json"`. The [marketplace catalog](https://developers.openai.com/plugins/build/plugins#marketplace-metadata) uses the local source object pointing to `./plugins/impeccable`, category Creativity, and the standard AVAILABLE/ON_INSTALL policy. Upstream skill metadata is unchanged. `RELEASE.json` records each transformation and every copied path, hash, and mode.

## Reserve one version

Collect the complete exposure inventory, including candidate tags, public releases, private/account deliveries, and withdrawn or failed candidates. Retain the collecting evidence. Pass `{complete: true, records: [{version, ...}]}` as `inventory`; uncertainty prevents setting `complete: true`.

All release paths use this allocator. The equal-version and advanced-patch branches implement [ADR 0001](adr/0001-repack-identity-and-versioning.md), together with the pinned [Real Skills allocation procedure](https://github.com/nisavid/real-skills/blob/0c1ebe0a778a861dbfee9bb2f84dec7c9ad1cf6a/docs/agents/release-archives.md). `advance: true` selects an advanced patch even when matching upstream would otherwise be eligible. An older upstream major/minor line requires a decision rather than silently creating a version below prior exposure.

Create a reservation request with `upstream`, `inventory`, optional `advance`, `directory`, and `binding`. `binding.procedureRevision` is the reviewed full Git SHA. `binding.inputsSha256` hashes the UTF-8 bytes of `JSON.stringify({pin, policy}, null, 2) + "\n"`. The caller must verify that the executing procedure matches that reviewed revision. `directory` is resolved from the command's working directory.

```sh
node scripts/repack.mjs reserve reservation-request.json
```

The command acquires `.allocation-lock`, incorporates every existing `repack-v*.json` record in that directory, and writes a create-only `repack-v<version>.json` reservation. It retains the full exposure snapshot and its hash. Keep that record private when its evidence includes account details. Public `RELEASE.json` retains the exposed version list and the inventory and reservation hashes, leaving account records out. A lock left by interruption requires reconciliation; automatic stale-lock takeover is unsupported. `allocate` takes `{upstream, inventory, advance?}` and produces only a preview, never a reservation.

The local lock serializes users of the same directory. Hosted release attempts must additionally serialize their entire reconcile/reserve/publish sequence and establish the create-only immutable remote candidate tag before any consumer exposure. Synchronize all durable reservation records into the local directory before allocation. A local reservation alone establishes neither remote uniqueness nor exposure-inventory completeness. Retain failed reservations permanently.

## Build twice and validate

Create `build-request.json` containing paths `universal`, `signature`, `pin`, `policy`, `reservation`, and `sourceRoot`. Paths resolve relative to that request file. `sourceRoot` contains only the selected supplemental source files at their original paths. The reservation must bind the same inputs, procedure, upstream baseline, and allocated version.

```sh
node scripts/repack.mjs build build-request.json first
node scripts/repack.mjs build build-request.json second
node scripts/repack.mjs validate build-request.json first
```

Each build requires a new output directory and writes:

- `impeccable-<full-version>.zip`, containing one plugin at the archive root
- `candidate.json`, with input identities, hashes, modes, structural checks, and explicit qualification limits
- `marketplace/.agents/plugins/marketplace.json`
- `marketplace/plugins/impeccable/`, byte- and mode-identical to the portable package

Compare both archives and both `candidate.json` files byte for byte across the independent processes. Retain the inputs, enrolled policy, reservation, source comparison, procedure revision, output hashes, and both results. `validate` reconstructs the expected result and checks all retained output paths, bytes, and modes, including the archive, manifests, provenance, catalog, and marketplace tree. It rejects extra files and links. Validation does not overwrite output or consult a moving qualified ref.

The ZIP reader validates central/local path agreement, CRCs, bounds, entry ownership, unique relative paths, regular Unix file types, and size limits. It rejects links, special or privileged modes, traversal, case collisions, file/directory collisions, Windows device names, split archives, encryption, and ZIP64. Stored output entries use sorted paths and fixed timestamps, avoiding compression-version differences. Input archives are limited to 256 MiB compressed and expanded, with at most 20,000 entries. An upstream shape outside these bounds requires investigation.

Support checks cover required paths and inline Markdown relative links outside triple-backtick fences. They do not prove all text references, dynamic paths, external links, or client discovery. Run deterministic launcher, actual-engine, and hook fixtures separately, recording the actual engine path, version, and digest. Then complete each consumer route's observations before qualification. The publisher records the generated distribution commit separately, avoiding a self-referential commit field inside its own payload.

Commands return one JSON result: `selected`, `allocated-preview`, `reserved`, `candidate`, or `validated`. Successful completion exits `0`; rejected inputs and validation errors produce `outcome: "failed"` on stderr and exit `1`; command-line usage errors exit `2`. File-write failures can leave an incomplete new output directory; preserve it as failure evidence and use a new directory after reconciliation. Existing output directories are never reused by `build`.

Run `node --test tests/repack.test.mjs tests/repack-archive.test.mjs tests/repack-package.test.mjs` after changing the allocator, builder, ZIP reader, or this procedure. The archive-negative fixtures use Python 3's independent ZIP encoder. These tests establish offline behavior; they do not supply release, consumer, synchronization, or scheduled-run evidence.

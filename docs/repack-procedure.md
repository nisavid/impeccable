# Build an Impeccable repack candidate

`scripts/repack.mjs` reserves a version, builds a portable plugin archive and matching marketplace tree, and validates the retained bytes. It performs no network requests, release uploads, tag writes, or marketplace promotion. Use it from the independently reviewed procedure revision under the [acceptance plan](repack-acceptance-plan.md). A candidate remains unqualified until that plan's runtime and consumer observations pass.

## Collect immutable inputs

Enumerate every upstream release page, retaining the response identities and pagination evidence. Pass `select` a JSON object with `complete: true` and the complete `releases` array. The selector chooses the numerically highest published stable `skill-vMAJOR.MINOR.PATCH` with canonical decimal components. It excludes drafts, prereleases, other components, and noncanonical tags. A row without a nonempty tag name stops selection unless it is explicitly a draft or prerelease. A canonical skill tag with unknown draft or prerelease eligibility also stops selection. A stable skill tag outside the safe integer range also stops selection. `complete` is an explicit assertion by the collecting procedure; the offline selector cannot establish it.

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

The IDs and sizes illustrate the shape. Unix mode `420` is the decimal value of octal `0644`. For regular supplemental files, the loader maps the owner execute bit to the Git mode, so a checkout umask can change read and write permissions without changing the comparison.

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

The portable root uses the [Agent Plugins 1.0.0 schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json). Its complete `extensions.com.openai` overlay equals `.codex-plugin/plugin.json`, following the [OpenAI overlay contract](https://developers.openai.com/plugins/build/plugins#add-an-openai-and-codex-overlay). Both manifests retain selected upstream authorship, description, and homepage, identify the fork repository, and carry one allocated version. If the upstream manifest supplies `license`, it must match the enrolled identifier. If it supplies `keywords`, the field must be an array of strings. Wrapper metadata supplies display name Impeccable, icon paths, `skills: "./skills/"`, and explicit `hooks: "./hooks/hooks.json"`. The [marketplace catalog](https://developers.openai.com/plugins/build/plugins#marketplace-metadata) uses the local source object pointing to `./plugins/impeccable`, category Creativity, and the standard AVAILABLE/ON_INSTALL policy. Upstream skill metadata is unchanged. `RELEASE.json` records each transformation and every copied path, hash, and mode.

## Reserve one version

Collect the complete exposure inventory, including candidate tags, public releases, private/account deliveries, and withdrawn or failed candidates. Retain the collecting evidence. Pass `{complete: true, records: [{version, ...}]}` as `inventory`. Supply `records: []` for a verified empty inventory. Uncertainty prevents setting `complete: true`.

All release paths use this allocator. The equal-version and advanced-patch branches implement [ADR 0001](adr/0001-repack-identity-and-versioning.md), together with the pinned [Real Skills allocation procedure](https://github.com/nisavid/real-skills/blob/0c1ebe0a778a861dbfee9bb2f84dec7c9ad1cf6a/docs/agents/release-archives.md). `advance: true` selects an advanced patch even when matching upstream would otherwise be eligible. An older upstream major/minor line requires a decision rather than silently creating a version below prior exposure.

Create a reservation request with `upstream`, `inventory`, optional `advance`, `directory`, and `binding`. `binding.procedureRevision` is the reviewed full Git SHA. `binding.inputsSha256` hashes the UTF-8 bytes of `JSON.stringify({pin, policy}, null, 2) + "\n"`. Verify the executing procedure against that reviewed revision before reserving. Retain the execution revision and the evidence tying the invoked files to it. Resolve `directory` from the command's working directory.

```sh
node scripts/repack.mjs reserve reservation-request.json
```

The command acquires `.allocation-lock`, incorporates every existing `repack-v*.json` record in that directory, and writes a create-only `repack-v<version>.json` reservation. It retains the full exposure snapshot and its hash. Preserve the exact bytes emitted by `reserve`, including the final newline. Reconciliation, build, and validation require that serialization. A retained reservation needs schema `1` and a valid procedure revision and input digest. If either is unresolved, reconcile the retained record before allocating again. Keep that record private when its evidence includes account details. Public `RELEASE.json` retains the exposed version list and the inventory and reservation hashes, leaving account records out. A lock left by interruption requires reconciliation. On cleanup failure, the command reports the primary error and `lockCleanup`, which includes the reservation path if the write completed. Confirm the lock owner has stopped, inspect and retain the reservation file if present, and verify its version and binding against the intended request. Resume with the reconciled reservation after resolving the lock. `allocate` takes `{upstream, inventory, advance?}` and produces only a preview, never a reservation.

The local lock serializes users of the same directory. Hosted release attempts must additionally serialize their entire reconcile/reserve/publish sequence and establish the create-only immutable remote candidate tag before any consumer exposure. Synchronize all durable reservation records into the local directory before allocation. A local reservation alone establishes neither remote uniqueness nor exposure-inventory completeness. Retain failed reservations permanently.

## Build twice and validate

Create `build-request.json` with `procedureRevision` and paths `universal`, `signature`, `pin`, `policy`, `reservation`, and `sourceRoot`. Paths resolve relative to the request file. Stage the selected supplemental files at their original paths under `sourceRoot`. The loader reads the pin-listed paths and requires a directory root and regular files without symbolic links beneath it.

Set `procedureRevision` from the verified execution revision, using the retained checkout and file evidence. Check it again before building or resuming. The CLI compares this supplied revision with the reservation and verifies the bound inputs, upstream baseline, and allocation. The release path owns verification of the files it actually invokes.

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

Compare both archives and both `candidate.json` files byte for byte across the independent processes. Retain the inputs, enrolled policy, reservation, source comparison, procedure revision and its verification evidence, output hashes, and both results. On resumption, reconcile the retained bytes with the same reservation before continuing. A procedure mismatch or retained-byte disagreement stops the attempt. `validate` reconstructs the expected result and checks all retained output paths, bytes, and modes, including the archive, manifests, provenance, catalog, and marketplace tree. It checks the directories implied by the expected file paths and rejects extra entries and links. It compares regular-file permissions and special mode bits. Validation does not overwrite output or consult a moving qualified ref.

The ZIP reader validates central/local path agreement, CRCs, bounds, entry ownership, unique relative paths, regular Unix file types, and size limits. It rejects links, special or privileged modes, traversal, case collisions, file/directory collisions, Windows device names, split archives, encryption, and ZIP64. Stored output entries use sorted paths and fixed timestamps, avoiding compression-version differences. Input archives are limited to 256 MiB compressed and expanded, with at most 20,000 entries. An upstream shape outside these bounds requires investigation.

The support check requires the enrolled paths and checks relative destinations in inline Markdown links. The supported form is `[label](destination "optional title")`. The label can contain balanced nested brackets, code spans, and inline images. A recognized inner link makes its enclosing link label ineligible. Within a paragraph, spaces, tabs, and line breaks can surround the destination and separate it from the title.

- A bare destination has balanced parentheses and no unescaped whitespace or angle brackets. An angle-bracket destination is delimited by `<` and `>` on one line.
- An optional title follows whitespace and uses matching single or double quotes. A backslash escapes ASCII punctuation in labels, destinations, and titles.
- Matching backtick runs within one inline block delimit code spans, including spans across line breaks. Blank lines, ATX headings, Setext underlines, thematic breaks, and fences separate inline blocks. The check skips code spans and line-leading backtick or tilde fences with up to three spaces of indentation. A closing fence allows only ASCII spaces and tabs after the marker.

The builder resolves recognized relative targets against the referring file, after removing fragments and decoding percent escapes. A normalized path to the skill root is valid. Missing paths and paths outside that root fail the check. The check covers this inline grammar and the enrolled paths. Dynamic references, external URLs, and client discovery require separate evidence.

Run deterministic launcher, actual-engine, and hook fixtures separately, recording the actual engine path, version, and digest. Then complete each consumer route's observations before qualification. The publisher records the generated distribution commit separately, avoiding a self-referential commit field inside its own payload.

Commands return one JSON result: `selected`, `allocated-preview`, `reserved`, `candidate`, or `validated`. Successful completion exits `0`; rejected inputs and validation errors produce `outcome: "failed"` on stderr and exit `1`; command-line usage errors exit `2`. File-write failures can leave an incomplete new output directory; preserve it as failure evidence and use a new directory after reconciliation. Existing output directories are never reused by `build`.

Run `node --test tests/repack.test.mjs tests/repack-archive.test.mjs tests/repack-package.test.mjs` after changing the allocator, builder, ZIP reader, or this procedure. The ZIP fixtures use fixed stored and deflated payloads and construct archive records independently of the repacker. These tests establish offline behavior; they do not supply release, consumer, synchronization, or scheduled-run evidence.

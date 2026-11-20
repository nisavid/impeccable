# Build an Impeccable repack candidate

`scripts/repack.mjs` checks pinned inputs against the enrolled policy, reserves a version, builds a portable plugin archive and matching marketplace tree, optionally builds a Claude Code plugin tree and Claude marketplace catalog beside them, validates the retained bytes, and can commit the Claude marketplace tree to a local Git store. It performs no network requests, release uploads, remote ref or tag writes, or marketplace promotion. Use it from the independently reviewed procedure revision under the [acceptance plan](repack-acceptance-plan.md). A candidate remains unqualified until that plan's runtime and consumer observations pass.

## Invoke the offline CLI

Pass a request filename to `select`, `allocate`, `check`, `reserve`, or `commit`. Pass a build request filename and output directory to `build` or `validate`. Relative command-line paths and the `directory` field in a reservation request resolve from the process working directory. Relative paths inside a check, build, or commit request resolve from that file's directory.

- Exit `0` writes one JSON line to stdout. Require the expected `outcome` before continuing:

  | Command | Outcome |
  | --- | --- |
  | `select` | `{outcome: "selected", release}` |
  | `allocate` | `{outcome: "allocated-preview", version}` |
  | `check` | `{outcome: "checked", check}` |
  | `reserve` | `{outcome: "reserved", reservation}` |
  | `build` | `{outcome: "candidate", candidate}` |
  | `validate` | `{outcome: "validated", candidate}` |
  | `commit` | `{outcome: "committed", commit}` |

- Exit `1` writes one JSON line to stderr with `outcome: "failed"`, an `error` message, and `lockCleanup` when reservation lock cleanup fails. The CLI supplies no general machine-readable error category.
- Exit `2` writes a plain-text `Usage:` line to stderr before reading a request.

## Collect immutable inputs

Enumerate every upstream release page, retaining the response identities and pagination evidence. Pass `select` a JSON object with `complete: true` and the complete `releases` array. The selector chooses the numerically highest published stable `skill-vMAJOR.MINOR.PATCH` with canonical decimal components. It excludes drafts, prereleases, other components, and noncanonical tags. A row without a nonempty tag name stops selection unless it is explicitly a draft or prerelease. A canonical skill tag with unknown draft or prerelease eligibility also stops selection. A stable skill tag outside the safe integer range also stops selection. `complete` is an explicit assertion by the collecting procedure; the offline selector cannot establish it.

```sh
node scripts/repack.mjs select releases.json
```

Reconcile the selected release ID, tag object, and peeled commit before and after downloading inputs. Pin both published assets, `universal.zip` and `universal.zip.sig.json`, by asset ID, size, and SHA-256. Fetch these supplemental files from the selected source commit and compare their bytes and modes directly with that commit's Git blobs:

- `.claude-plugin/plugin.json`
- `LICENSE` and the complete enrolled notice inventory
- `scripts/lib/assets/plugin-icon.png`
- every Claude source enrolled in `policy.claude.sourceFiles` (see below)

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
    {"path": ".claude-plugin/plugin.json", "mode": 420, "sha256": "<64 hex>"},
    {"path": "LICENSE", "mode": 420, "sha256": "<64 hex>"},
    {"path": "NOTICE.md", "mode": 420, "sha256": "<64 hex>"},
    {"path": "scripts/lib/assets/plugin-icon.png", "mode": 420, "sha256": "<64 hex>"}
  ]
}
```

The IDs and sizes illustrate the shape. Every source-commit file, here and in the Claude enrollment, uses the same `{path, mode, sha256}` record, where `path` is the file's Git path and `mode` is `420` (octal `0644`) or `493` (octal `0755`); the portable supplemental files must be `420`. Unix mode `420` is the decimal value of octal `0644`. For regular supplemental files, the loader maps the owner execute bit to the Git mode, so a checkout umask can change read and write permissions without changing the comparison.

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
| `runtimeOrigins` | Complete sorted literal HTTP(S) origins found in those runtime files and in every executable file |
| `runtimeBaseline` | Reviewed capability descriptions, the content hash of every runtime file and every executable file, and the accepted engine identity |

Enrollment requires review; deriving a fresh policy from every downloaded payload would bypass the capability-change gate. Runtime-file discovery also recognizes `.js`, `.mjs`, `.cjs`, `.sh`, `.cmd`, `.bat`, `.ps1`, `.py`, `.rb`, `.pl`, `.wasm`, `.exe`, `.dll`, `.so`, and `.dylib`. The origin scanner recognizes literal strings only. It cannot establish that a program has no dynamic endpoints or other new behavior. Investigate suspected expansion under the trust decision even if this scanner passes.

`runtimeBaseline.capabilities` contains nonempty review descriptions for `hookExecution`, `executableSelection`, `engineAcquisition`, `cacheMutation`, `networkDestinations`, `browserLoopback`, and `processAndFilesystemAuthority`. Describe the automatic hooks, executable selection and overrides, acquisition and verification, cache writes, configurable destinations, browser and loopback behavior, and authority inherited from the caller. These descriptions set the review boundary.

`runtimeBaseline.files` is an array of `{path, sha256}` records covering every `runtimeFiles` and `executableFiles` entry exactly once, so an executable outside `scripts/` and `agents/` with no listed extension is bound by content as well as by name. `runtimeBaseline.engine` supplies `version`, `checksumManifestSha256`, and `checksums`, an object mapping each platform asset name to its SHA-256. The verifier compares these with `scripts/VERSION` and `scripts/engine-checksums.txt`. Every checksum record must name the accepted version. Both engine files also retain their exact content hashes in the runtime baseline.

`verifyInputs` checks this baseline after verifying the archive signature and supplemental inputs. Missing or incomplete baseline data fails verification, including for an older retained policy. A changed runtime byte or engine identity stops construction for focused investigation, including a benign runtime change. Update the reviewed policy only after the change is shown to remain within the described boundary or the required renewed qualification is complete. A new download supplies evidence to compare with the existing policy.

The baseline must describe the copied launcher's actual choices. An explicit executable override, sibling binary, versioned cache, unversioned home binary, and `PATH` binary can have different verification rules. Record the actual engine path, version, and digest during qualification and identify the selection path exercised. Qualification of an unpinned selection path supplies evidence for that path. Qualification of the pinned configuration requires a binary matching its enrolled engine digest. The runtime baseline hash and enrolled engine identity are retained in candidate provenance.

The builder copies the complete signed Codex skill subtree byte for byte, preserving `0644` and `0755` modes. It preserves both upstream hook events and every handler field, replacing `.codex/skills/impeccable` with `${PLUGIN_ROOT}/skills/impeccable` and the corresponding Windows path with `${PLUGIN_ROOT}\skills\impeccable`. Guards, matchers, timeouts, and status messages retain their upstream semantics. The resulting object must match `policy.hooks` exactly.

The portable root uses the [Agent Plugins 1.0.0 schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json). Its complete `extensions.com.openai` overlay equals `.codex-plugin/plugin.json`, following the [OpenAI overlay contract](https://developers.openai.com/plugins/build/plugins#add-an-openai-and-codex-overlay). Both manifests retain selected upstream authorship, description, and homepage, identify the fork repository, and carry one allocated version. If the upstream manifest supplies `license`, it must match the enrolled identifier. If it supplies `keywords`, the field must be an array of strings. Wrapper metadata supplies display name Impeccable, icon paths, `skills: "./skills/"`, and explicit `hooks: "./hooks/hooks.json"`. The [marketplace catalog](https://developers.openai.com/plugins/build/plugins#marketplace-metadata) uses the local source object pointing to `./plugins/impeccable`, category Creativity, and the standard AVAILABLE/ON_INSTALL policy. Upstream skill metadata is unchanged. `RELEASE.json` records each transformation and every copied path, hash, and mode.

## Enroll the Claude surface

Add a `claude` object to the reviewed policy only for a Claude delivery. Without it, the build emits no Claude output. [ADR 0003](adr/0003-claude-desktop-local-route.md) records the route and why each source is used.

| Field | Enrolled value |
| --- | --- |
| `skillPrefix` | `.claude/skills/impeccable/` |
| `agentsPrefix` | `.claude/agents/` |
| `projectHooksPath` | `.claude/settings.json` |
| `hooks` | Complete expected Claude plugin hook object, equal to upstream `plugin/hooks/hooks.json` |
| `sourceFiles` | Upstream's complete plugin skill, agents, and hooks at the selected commit, each with `path`, `mode`, and `sha256` |
| `excludedSourcePaths` | Sorted paths of every other file in the selected commit's `plugin/` subtree, such as `plugin/.claude-plugin/plugin.json`, reviewed as outside the Claude package |

`sourceFiles` lists every file under `plugin/skills/impeccable/` and `plugin/agents/`, plus `plugin/hooks/hooks.json`, at the selected commit. Agents and hooks must be `0644`. Stage the commit's complete `plugin/` subtree under `sourceRoot/plugin/`, for example with `git archive <commit> plugin | tar -x -C <sourceRoot>`. List the staged tree with `(cd <sourceRoot> && find plugin -type f | LC_ALL=C sort)` and the commit with `git ls-tree -r --name-only <commit> -- plugin | LC_ALL=C sort`, confirm they are identical (`export-ignore` attributes can drop files from an archive), and retain both outputs as enrollment evidence. Completeness rests on that staged listing: the tool compares the enrollment with the files it finds under `sourceRoot/plugin/` and does not authenticate that tree against the commit. Compare each pinned file with the selected commit's Git blob, as for the other supplemental files. `check` and `build` list every regular file staged under `sourceRoot/plugin/` and fail on a staged file that is neither pinned nor excluded, on a pinned or excluded path that is not staged, on a link or special file, and on an exclusion under `plugin/skills/impeccable/`, `plugin/agents/`, or `plugin/hooks/`. A `plugin/hooks/` file other than `hooks.json` can be neither pinned nor excluded, so it fails closed. A passing listing therefore equals the pinned paths plus the exclusions, which the reservation binds through the policy; the plugin's `RELEASE.json`, the candidate record, and `check` output carry its `pluginTree` digest, file count, and exclusions. An exclusion beyond upstream's manifests is a content decision for review. The enrollment has exactly these six fields.

The built plugin's skill, agents, and hooks equal that inventory exactly. The pinned skill and agent paths must equal the signed archive's `skillPrefix` and `agentsPrefix` paths, and a path in one and not the other fails the build. Each file comes from the signed archive when the archive's bytes and mode match the pin, and from the staged source-commit file otherwise; `RELEASE.json` records which. The skill's runtime files and executables must equal the enrolled `runtimeFiles` and `executableFiles`, and every enrolled `requiredSkillFiles` entry must be present, apart from the Codex skill's own `agents/` folder, and every runtime or executable file must equal its Codex counterpart byte for byte and mode for mode. The hooks must equal `policy.claude.hooks`, keep upstream's Claude event set from `projectHooksPath`, and root every command at `${CLAUDE_PLUGIN_ROOT}`. As a second guard, no packaged markdown may name `.claude/skills/impeccable/scripts`. The Claude manifest keeps upstream authorship, description, and homepage, names the fork repository and the allocated version, carries the enrolled license and keywords only when upstream supplies them, and points `skills` at `./skills/`. The catalog `nisavid-impeccable` lists the plugin at `./plugins/impeccable` with the same version. The plugin's `RELEASE.json` records each transformation and every copied path, origin, hash, and mode.

## Check the enrollment before reserving

A reservation binds the pin, the policy, and the procedure revision, so an enrollment error found after reserving cannot be fixed under it. Run every check that `build` runs on the real inputs first, and reserve only after it passes:

```sh
node scripts/repack.mjs check check-request.json
```

A check request is a build request without `reservation`: `procedureRevision` and paths `universal`, `signature`, `pin`, `policy`, and `sourceRoot`. `check` loads the inputs as `build` does and runs the same verification and assembly code, using the upstream version as a placeholder for the allocated one. It verifies the asset pins and signature, the supplemental and Claude source pins, the runtime baseline and engine identity, the support links, the portable hooks and manifest, and, with Claude enrolled, the enrollment's agreement with the staged `plugin/` subtree, the pinned plugin inventory and its path equality with the signed Claude copy, the Claude runtime inventories, and the Claude hooks. It makes no reservation, writes no file, and discards the assembled outputs. Its `check.inputsSha256` is the value the reservation's `binding.inputsSha256` must carry. A failure stops the freeze before allocation; return it for a decision rather than reserving.

## Reserve one version

Collect the complete exposure inventory, including candidate tags, public releases, private/account deliveries, and withdrawn or failed candidates. Retain the collecting evidence. Pass `{complete: true, records: [{version, ...}]}` as `inventory`. Supply `records: []` for a verified empty inventory. Uncertainty prevents setting `complete: true`.

All release paths use this allocator. The equal-version and advanced-patch branches implement [ADR 0001](adr/0001-repack-identity-and-versioning.md), together with the pinned [Real Skills allocation procedure](https://github.com/nisavid/real-skills/blob/0c1ebe0a778a861dbfee9bb2f84dec7c9ad1cf6a/docs/agents/release-archives.md). `advance: true` selects an advanced patch even when matching upstream would otherwise be eligible. An older upstream major/minor line requires a decision rather than silently creating a version below prior exposure.

Create a reservation request with `upstream`, `inventory`, optional `advance`, `directory`, and `binding`. `binding.procedureRevision` is the reviewed full Git SHA. `binding.inputsSha256` hashes the UTF-8 bytes of `JSON.stringify({pin, policy}, null, 2) + "\n"`. Verify the executing procedure against that reviewed revision before reserving. Retain the execution revision and the evidence tying the invoked files to it.

```sh
node scripts/repack.mjs reserve reservation-request.json
```

The command acquires `.allocation-lock` and reads every directory entry whose name starts with `repack-v`. Each must parse as a reservation with a matching `repack-v<version>.json` filename, schema `1`, and a valid procedure revision and input digest. Keep temporary files and backups outside that prefix. The command includes the retained reservations in the allocation inventory and writes a create-only `repack-v<version>.json` file containing the full exposure snapshot and its hash.

Use the stdout `reservation.version` to locate the file. Pass its path as `reservation` in the build request. Keep the file's exact bytes, including field order and the final newline. The compact stdout response serves as a receipt. Keep the file private when its evidence includes account details. Public `RELEASE.json` retains the exposed version list and the inventory and reservation hashes.

`reserve` always attempts a new allocation. Repeating a successful request can allocate a higher version even with the same binding. For a preview, pass `{upstream, inventory, advance?}` to `allocate`.

An interrupted or failed `reserve` can leave a reservation, a lock, or both. The lock directory records no owner, and a second allocator may acquire the lock after the original process exits. Before inspecting the directory for recovery, establish that all allocators using it have stopped and keep new ones out until the inspection and any stale lock removal are complete. If you cannot establish exclusive access, leave the lock in place and stop the attempt.

Inspect the reservation directory, checking `lockCleanup.reservation` when available. A missing path in the error does not establish that no file was written. If a file came from the interrupted attempt, verify its version and filename, upstream, and binding against the attempt's evidence. Compare the file's exact bytes to any recorded digest and reuse the verified file for build after reconciling any stale lock. If the retained state is incomplete, conflicting, or ambiguous, stop and reconcile it before allocating again.

The local lock serializes users of the same directory. Hosted release attempts must additionally serialize their entire reconcile/reserve/publish sequence and establish the create-only immutable remote candidate tag before any consumer exposure. Before allocation, copy the exact bytes written by `reserve` for every durable reservation record into the local directory. Reformatting or reordering JSON can change the file's SHA-256 even when the parsed values are identical. A local reservation alone establishes neither remote uniqueness nor exposure-inventory completeness. Retain failed reservations permanently.

A local Claude Desktop delivery has no hosted tag. Its exposure starts at the first resolve of the snapshot by any client configuration, including an isolated one. Before that resolve, reserve the version, retain the candidate record, commit the marketplace snapshot locally with `commit` and give consumers its full SHA, and enter the delivery in the exposure inventory as a private delivery. A hosted tag stays required before any hosted exposure.

## Build twice and validate

Create `build-request.json` with `procedureRevision` and paths `universal`, `signature`, `pin`, `policy`, `reservation`, and `sourceRoot`. Stage the selected supplemental files at their original paths under `sourceRoot`. The loader reads the pin-listed paths and requires a directory root and regular files without symbolic links beneath it.

Set `procedureRevision` from the verified execution revision, using the retained checkout and file evidence. Check it again before building or resuming. The CLI compares this supplied revision with the reservation and verifies the bound inputs, upstream baseline, and allocation. The release path owns verification of the files it actually invokes.

```sh
node scripts/repack.mjs build build-request.json first
node scripts/repack.mjs build build-request.json second
node scripts/repack.mjs validate build-request.json first
```

Each build requires a new output directory under an existing parent. It writes the following files.

- `impeccable-<full-version>.zip`, containing one plugin at the archive root
- `candidate.json`, with input identities, hashes, modes, structural checks, and explicit qualification limits
- `marketplace/.agents/plugins/marketplace.json`
- `marketplace/plugins/impeccable/`, byte- and mode-identical to the portable package
- with Claude enrolled, `claude-marketplace/.claude-plugin/marketplace.json` and the Claude plugin under `claude-marketplace/plugins/impeccable/`; `candidate.json` gains a `claude` record with the catalog name, plugin name, version, digests, and the full tree inventory

Compare both archives and both `candidate.json` files byte for byte across the independent processes. Retain the inputs, enrolled policy, reservation, source comparison, procedure revision and its verification evidence, output hashes, and both results. On resumption, reconcile the retained bytes with the same reservation before continuing. A procedure mismatch or retained-byte disagreement stops the attempt. `validate` reconstructs the expected result and checks all retained output paths, bytes, and modes, including the archive, manifests, provenance, catalog, and marketplace tree. It checks the directories implied by the expected file paths and rejects extra entries and links. It compares regular-file permissions and special mode bits. Validation does not overwrite output or consult a moving qualified ref.

The ZIP reader validates central/local path agreement, CRCs, bounds, entry ownership, unique relative paths, regular Unix file types, and size limits. It rejects links, special or privileged modes, traversal, case collisions, file/directory collisions, Windows device names, split archives, encryption, and ZIP64. Stored output entries use sorted paths and fixed timestamps, avoiding compression-version differences. Input archives are limited to 256 MiB compressed and expanded, with at most 20,000 entries. An upstream shape outside these bounds requires investigation.

The support check requires the enrolled paths and checks relative destinations in inline Markdown links. The supported form is `[label](destination "optional title")`. The label can contain balanced nested brackets, code spans, and inline images. A recognized inner link makes its enclosing link label ineligible. Within a paragraph, spaces, tabs, and line breaks can surround the destination and separate it from the title.

- A bare destination has balanced parentheses and no unescaped whitespace or angle brackets. An angle-bracket destination is delimited by `<` and `>` on one line.
- An optional title follows whitespace and uses matching single or double quotes. A backslash escapes ASCII punctuation in labels, destinations, and titles.
- Matching backtick runs within one inline block delimit code spans, including spans across line breaks. Blank lines, ATX headings, Setext underlines, thematic breaks, and fences separate inline blocks. The check skips code spans and line-leading backtick or tilde fences with up to three spaces of indentation. A closing fence allows only ASCII spaces and tabs after the marker.

The builder resolves recognized relative targets against the referring file, after removing fragments and decoding percent escapes. A normalized path to the skill root is valid. Missing paths and paths outside that root fail the check. The check covers this inline grammar and the enrolled paths. Dynamic references, external URLs, and client discovery require separate evidence.

Run the generated-package runtime fixture with:

```sh
node --test --test-name-pattern='generated POSIX launcher' tests/repack-package.test.mjs
```

The fixture runs the POSIX launcher and both relocated hook commands from a separate project with a synthetic engine. It checks argument and event-payload forwarding and the hook guards when the plugin root is absent. The Claude hook fixture does the same for each Claude hook command, with `CLAUDE_PLUGIN_ROOT` set to the generated plugin and to a missing directory:

```sh
node --test --test-name-pattern='Claude hook command' tests/repack-claude.test.mjs
```

If the test runner finds a local engine through `IMPECCABLE_BIN` or the standard test binary paths, a separate probe through the generated launcher reports its path, version, and SHA-256. Otherwise the probe reports a skip. Qualification still requires runtime observations on the selected candidate and on each consumer route. The publisher records the generated distribution commit separately, avoiding a self-referential commit field inside its own payload.

File-write failures can leave an incomplete new output directory; preserve it as failure evidence and use a new directory after reconciliation. Existing output directories are never reused by `build`.

## Commit the Claude marketplace snapshot

`commit` validates a retained candidate, then writes its `claude-marketplace/` tree as one root commit on a new branch. Create `commit-request.json`:

```json
{
  "buildRequest": "build-request.json",
  "output": "first",
  "git": "/usr/bin/git",
  "repository": "/absolute/path/to/store.git",
  "createRepository": true,
  "objectFormat": "sha1",
  "branch": "refs/heads/claude-marketplace/v<full-version>",
  "hooksDirectory": "/absolute/path/to/empty-directory",
  "author": {"name": "<name>", "email": "<email>", "date": "<unix-seconds> <+hhmm>"},
  "committer": {"name": "<name>", "email": "<email>", "date": "<unix-seconds> <+hhmm>"},
  "message": "<message ending in a newline>\n"
}
```

`buildRequest` and `output` resolve from the request file's directory; `git`, `repository`, and `hooksDirectory` must be normalized absolute paths. Every Git command runs with only `PATH=/usr/bin:/bin`, `LC_ALL=C`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, and `GIT_TERMINAL_PROMPT=0` in its environment, plus the explicit identity for the commit and ref commands. It names the repository with `--git-dir`, runs from `/`, and carries `-c core.hooksPath=<hooksDirectory>` and `-c hook.reference-transaction.enabled=false`. The step:

1. Checks that the hooks directory is empty and the branch name is valid. With `createRepository`, it requires an absent path under an existing parent, runs `init --bare --template= --object-format=<format>`, and asserts minimal configuration and an absent or empty hooks directory.
2. Before writing any object, rejects repository configuration in any scope except the command line, including included files, that defines `core.hooksPath`, any `hook.*` key (a configuration-defined hook runs even under an empty hooks path), `filter.*`, `user.signingKey`, `gpg.*`, `commit.gpgSign`, or `i18n.commitEncoding` (a non-UTF-8 value adds an `encoding` header the computed commit does not carry); a different object format; `objects/info/alternates` or `http-alternates`; a branch checked out in any worktree; and an existing branch.
3. Writes blobs with `hash-object -w --no-filters --stdin`, trees with `mktree -z`, the commit with `commit-tree --no-gpg-sign`, and the branch with `update-ref --no-deref <branch> <commit> <zero-id>`. Each object ID must match the one computed from the validated bytes beforehand.
4. Reads the branch, the commit object, the recursive tree listing, and every blob back, and compares them with the validated tree.

Retain the commit request and the stdout receipt with the candidate evidence; together they record the identity, dates, message, and resulting commit and tree IDs. The same request against a fresh store reproduces the commit ID. A failure before `update-ref` leaves only unreferenced objects; a failure after it leaves the branch, which a retry must reconcile rather than overwrite. The step writes no remote ref or tag and never touches an existing store's index, working tree, or `HEAD`; a store it creates gets only the `HEAD` that `init --bare` writes.

Run `node --test tests/repack.test.mjs tests/repack-archive.test.mjs tests/repack-package.test.mjs tests/repack-claude.test.mjs tests/repack-git-commit.test.mjs tests/repack-check.test.mjs` after changing the allocator, builder, ZIP reader, commit step, or this procedure. The commit tests create stores only in temporary directories outside any repository and remove them. The ZIP fixtures use fixed stored and deflated payloads and construct archive records independently of the repacker. These tests establish offline behavior; they do not supply release, consumer, synchronization, or scheduled-run evidence.

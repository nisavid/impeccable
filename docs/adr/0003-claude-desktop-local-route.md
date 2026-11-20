# Deliver the repack to Claude Desktop through a local marketplace commit

The repack also builds a Claude Code plugin package, delivered to Claude Desktop through a local marketplace snapshot that consumers pin by full commit SHA. The [acceptance plan](../repack-acceptance-plan.md) covers the ChatGPT, Codex Cloud, and local Codex routes and requires its own scope decision for any other route. This record is that decision for one route: a local Claude Desktop delivery, needed to move the Ergoflux website workspace to Claude Desktop. It does not change the other routes, replace the official installation, or authorize any hosted tag, release, marketplace branch, or workflow.

## Package

The Claude package is a sibling output of the same build. It comes from the same verified upstream release, uses the one allocated version from [ADR 0001](0001-repack-identity-and-versioning.md), and is built only when the reviewed policy enrolls the Claude surface. The portable archive keeps its bytes; with the Claude surface enrolled, its `RELEASE.json` differs only in the policy and reservation digests that bind the larger enrollment.

Upstream ships its Claude plugin as the `plugin/` subtree of the selected source commit, not inside the signed archive. The archive carries the Claude provider copy under `.claude/`, whose markdown names project-relative script paths that upstream rewrites for its plugin. The enrollment therefore pins upstream's complete plugin inventory, and the builder reproduces it exactly while keeping every signed byte it can:

- The policy pins every file of upstream's plugin skill, agents, and hooks at the selected commit by path, mode, and SHA-256. The built plugin's skill, agents, and hooks equal that inventory, so any difference fails the build.
- The pinned skill and agent paths must equal the signed `.claude/skills/impeccable/` and `.claude/agents/` paths. Each file comes from the signed archive when its bytes and mode hash to the pin, and from the source commit only where they differ.
- The skill's runtime files, executables, and required support files equal the enrolled inventories, apart from the Codex skill's own `agents/` folder, and each runtime or executable file equals its Codex counterpart, so the runtime baseline covers them.
- The hooks are upstream's `plugin/hooks/hooks.json`, already rooted at `${CLAUDE_PLUGIN_ROOT}`. They must equal the enrolled hooks exactly, keep every handler field, and carry the same event set as the archive's `.claude/settings.json`. Relocating the project hooks instead would drop the plugin form's `sh` guard, `windows` command, and `env` field.
- As a second guard, no packaged markdown may name the project-relative scripts path.

Source-commit hashes identify inputs; they do not authenticate a publisher. The plugin's `RELEASE.json` records each transformation and every copied path, origin, hash, and mode.

The catalog is named `nisavid-impeccable` so it can sit beside upstream's `impeccable` marketplace in one client configuration. The plugin keeps the name `impeccable`. The manifest carries no `hooks` or `agents` key, matching upstream's plugin manifest, because Claude Code discovers both by location.

## Exposure boundary

Exposure starts at the first resolve of the snapshot by any client configuration, including an isolated one. Before that resolve:

1. The version is reserved and the candidate record exists.
2. The marketplace snapshot is a local commit, and consumers pin it by full SHA.
3. The delivery is entered in the exposure inventory as a private delivery.

A local reservation and a local commit establish neither remote uniqueness nor qualification. A hosted tag stays required before any hosted exposure, as the [procedure](../repack-procedure.md#reserve-one-version) requires for hosted release attempts.

## Commit step

`node scripts/repack.mjs commit` validates the retained candidate and writes its Claude marketplace tree as one root commit. The step applies the controls adjudicated for local materialization:

- Every Git command runs in a cleared environment with a fixed absolute Git binary, `GIT_CONFIG_NOSYSTEM=1`, and `GIT_CONFIG_GLOBAL=/dev/null`, names the repository with `--git-dir`, and never depends on the current directory or touches an index, a working tree, or `HEAD`.
- Blobs are written with `hash-object --no-filters --stdin`. Trees use `mktree`, and the commit uses `commit-tree --no-gpg-sign`.
- Author, committer, dates, and message are explicit inputs. With global configuration excluded they have no default source, so the commit ID is reproducible and is computed before Git writes anything.
- The branch is created by `update-ref` with an all-zero old value. Every command carries `-c core.hooksPath=<verified empty directory>` and `-c hook.reference-transaction.enabled=false`.
- Before writing, the step asserts the object format, that repository configuration in any scope (including included files) defines no hooks path, configuration-defined hook (`hook.*`), filter, or signing key, that the branch is checked out in no worktree and does not exist, and that the object store has no alternates.
- After writing, it reads the commit, tree listing, and every blob back and compares them with the validated tree, and confirms the branch points at the commit.
- When it creates a new store, it runs `init --bare --template=` with an explicit object format under the same fence, then asserts minimal configuration and an absent or empty hooks directory.

Tests in a scratch store settle the adjudicated questions for Git 2.56.1: `commit-tree` signs only when asked (`-S`), even with `commit.gpgSign=true` in global or repository configuration; hooks planted through global configuration, the repository's hooks directory, or an init template do not run during the step; a hook defined by `hook.*` keys in repository configuration, directly or through `include.path`, is refused before any object is written, although it would fire on an `update-ref` that sets only the empty hooks path; and a required global clean filter does not change any blob ID. The step still turns signing off explicitly rather than relying on that default.

The first candidate, its handoff, and qualification on Claude Desktop are separate work. Software Delivery's review of the route gates the handoff and the qualification run, not this package.

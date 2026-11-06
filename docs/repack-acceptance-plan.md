# Qualify and publish the Impeccable repack

This plan establishes the evidence required to publish the first repack and enable routine verified refreshes. It consumes the [identity and version decision](adr/0001-repack-identity-and-versioning.md), the [upstream-trust decision](adr/0002-release-qualification.md), and the completed [consumer-route](https://github.com/nisavid/impeccable/issues/3#issuecomment-6689422981) and [refresh](https://github.com/nisavid/impeccable/issues/5#issuecomment-6689662217) research. It records checks to execute, not passing results.

## Freeze the implementation and its inputs

1. Independently review the fork-owned repacker, updater, workflow, and policy against their final source revision. Record that procedure revision separately from the upstream source and generated distribution commits. A later procedure change invalidates the affected review and qualification.
2. Select the highest published stable `skill-vMAJOR.MINOR.PATCH` release by numeric version after complete enumeration. Exclude drafts, prereleases, and other component tags. Record the release ID, tag object, peeled commit, asset IDs, sizes, and digests. An incomplete listing cannot establish freshness.
3. Establish the accepted publisher, signing key, license, input layout, runtime origins, and integration surface. Verify the downloaded upstream archive and signature against the enrolled key and pinned input identities. The key found in upstream source is a publisher trust decision, not an independently authenticated external trust root. Subsequent identity or license changes require investigation and review.
4. Allocate the repack version using the pinned Real Skills rule. Establish the complete previously exposed version inventory, including private/account qualification candidates. Reserve each candidate's version before consumer exposure; failed or withdrawn candidates do not free a version. A create-only immutable repack tag and its candidate record provide a durable reservation. Tag existence is not qualification. Every permitted release path must use the same allocator; uncertainty stops allocation.
5. Define one output inventory for the portable archive and generated marketplace snapshot. Preserve the complete selected upstream skill subtree, support files, executable modes, icon, attribution, and both upstream hooks. Record wrapper changes separately. The initial research's file counts describe one input, not a permanent bound for later releases.

## Construct and verify a candidate

Build from pinned inputs into a new isolated output directory. Repeated construction from the same inputs must yield the same archive bytes and inventory. The implementation must provide a documented command for this build and its validation, with expected inputs, outputs, exit statuses, and retained evidence.

The required checks are:

- Every copied upstream file matches the selected input byte for byte; expected executable modes survive. The selected subtree is complete and every referenced support file exists.
- The root portable manifest and OpenAI compatibility manifest agree on plugin identity and the allocated full repack version. Upstream skill metadata retains its own version. The marketplace resolves the intended package root.
- Both upstream hook events and commands are preserved, including their path substitutions. The wrapper does not introduce unrelated skills, hooks, endpoints, or executables.
- Archive paths are unique and relative, with one intended package root. Reject traversal, escaping links, unexpected executable content, missing required entries, and inconsistent manifest or provenance records.
- License and notices match the accepted upstream inputs. Record input signature verification, output hashes, procedure revision, distribution commit, and the inventory in the candidate evidence.
- Deterministic launcher, engine, and hook checks run in an isolated environment using representative fixtures. Record the actual engine path, version, and digest; the declared pin alone is insufficient. Fixture success is not proof of actual client hook delivery.

Negative cases must include a corrupt asset, changed pinned tag or digest, incomplete release enumeration, missing support file, malformed manifest, unsafe archive path, and mismatched package versions. Each must fail before promotion and retain the last qualified release.

## Qualify actual consumer routes

Use isolated profiles or controlled test installations where supported, preserving unrelated plugins and the working official entry. Record the actual product surface, client version, account/workspace scope, plugin ID, source commit, package version, loaded file hashes, and engine identity. Do not transfer a result from Real Skills or one consumer to another.

| Route | Required observation |
| --- | --- |
| ChatGPT account/workspace | Accept the exact archive or marketplace snapshot through the intended route; read back identity, version, and discovered components; start a fresh task and observe the representative skill, support-file, and engine-backed operations actually available there. |
| Codex Cloud | Establish the actual transport from the selected account or marketplace, then observe the plugin files and identity in a fresh Cloud task. Exercise the supported operations and report missing engine, hook, browser, or network capability separately. Repository-mounted skills are a different route and cannot silently replace the requested plugin delivery. |
| Local Codex | Observe installation and skill discovery from a project outside the source checkout, actual engine selection, a reference-backed operation, an engine-backed operation, and both hook events after the required trust action. A hook guard's no-op is not event delivery. |
| Account delivery and automatic synchronization | Observe the selected source delivering updates into the requested clients and a fresh task loading the new bytes. Record the actual automatic trigger and delay. A manual marketplace upgrade is useful mechanism evidence but does not establish automatic synchronization. |

Exercise an upstream-baseline update and a packaging-only revision while retaining the installed plugin identity. Use real released upstream baselines, and record every exposed qualification version in the allocation inventory. Do not invent upstream provenance to manufacture an update case. The final promoted bytes must be the qualified candidate, not a later unverified rebuild.

If a requested transport or capability cannot be established, return the observed limitation and the concrete alternative before reducing the claim or removing the official entry. The initial qualification remains incomplete for that route. Any supported partial release or alternate delivery route requires its own scope decision.

## Promote verified bytes

1. Serialize release attempts so two runs cannot allocate or promote competing candidates. Reconcile existing candidate tags, releases, assets, and records before retrying. A version already bound to different inputs or bytes is a conflict, not an overwrite opportunity.
2. Keep candidate publication separate from the moving qualified marketplace. Use a fixed candidate ref and draft release as needed for qualification. Retain a clear candidate-versus-qualified record; a publicly fetchable tag alone is not a success receipt.
3. Upload the exact qualified archives as ordinary Release assets. Read the uploaded bytes back and verify their hashes and required metadata. Preserve immutable version tags and release identities.
4. Publish a normal, non-prerelease release, then advance `marketplace` to the corresponding qualified catalog and payload only after all required checks and asset readback succeed. Re-read the remote ref and catalog. An uploaded archive, a published release, and a promoted marketplace are separate results.
5. Replace the official installation only after the replacement's required route behavior is observed. Record removal separately from installation, update, and fresh-task evidence.

An interruption after release publication but before marketplace advancement can leave a verified release awaiting promotion. A retry must reconcile that state and complete only the missing action. It must not allocate a duplicate version, change previously exposed bytes, or report the marketplace as current before remote readback.

## Enable routine refresh

Use the selected hourly GitHub Actions schedule, offset from the top of the hour, plus a manual trigger for the same reviewed procedure. Standard hosted Linux execution in this public fork and ordinary Release assets preserve the researched zero-incremental-charge route. Routine checks must not add model/provider calls, paid services, larger runners, or optional paid storage mechanisms.

Before repository Actions enablement, select and inspect the intended workflows and their actual enabled states. The inherited sheriff applies upstream identities, a different triage label, and automatic issue/PR actions; the generated-output workflow pushes directly to `main`; other inherited schedules and release workflows have separate effects and prerequisites. Disable or adapt affected workflows deliberately. Standard public-repository macOS or Windows runner labels alone do not establish a compute charge; external services and storage require separate assessment.

The publishing job uses only the necessary repository token permissions and satisfies the selected rules. It has no authority to bypass protected `main`. Keep verification and publication in the same workflow rather than relying on token-generated events to start another workflow.

Every routine candidate repeats complete selection, immutable-input checks, version allocation, payload fidelity, archive/manifest validation, deterministic compatibility checks, and publication readback. The copied stable upstream payload receives the selected trust exception. Procedure changes, changed signing identities or licenses, unsupported package shape, detected capability expansion, integrity disagreement, or failed checks stop promotion. Investigate those conditions without silently broadening the policy.

## Observe failures and recover

Retain each check's start/completion time, selected input, no-change/published/failed outcome, procedure revision, and last qualified publication. Successful release provenance must remain available with the release; workflow summaries provide operational status. Failed or partial checks never count as successful freshness observations.

- A failed prepromotion check leaves the last qualified release and marketplace ref intact. A later run may retry a transient failure after re-reading the complete state.
- Missing assets or interrupted uploads require inventory and hash reconciliation before any resumption. Differing bytes under an exposed version require a new allocation and review of the cause.
- A fault discovered after promotion pauses further promotion. A recovery must preserve published provenance and immutable tags, and establish the selected clients' behavior when restoring known-good content. Do not assume that moving a ref backward downgrades an installed plugin; use the verified recovery route or return the concrete decision it requires.
- A disabled schedule requires checking both repository Actions and the workflow state, restoring the selected control, completing a manual run, and later observing a real scheduled completion. A successful manual run alone does not establish schedule recovery.

Qualification must exercise no-change, new upstream, packaging correction, failed-check retention, interrupted publication, idempotent resumption, manual recovery, and an actual scheduled completion. Include the platform's inactivity-disablement case in the recovery procedure. Hourly checks are attempts; delayed or dropped jobs and daily workspace synchronization prevent a one-hour end-to-end freshness claim. No independent watchdog or guaranteed staleness bound is selected.

## Execution handoff

Lead owns implementation, review, integration, selected workflow restoration, first qualification, and the resulting publication receipts. The implementation must expose reproducible commands and fixtures for the cases above, carry the accepted upstream-trust exception in discoverable repository policy, and report each source, publication, installation, runtime, synchronization, and recovery result separately.

The handoff is ready when the implementation scope and these acceptance requirements are received. Release readiness requires the actual checks to pass on the final candidate. An unresolved consumer route, changed policy boundary, or failed observation returns to the corresponding decision; tracker closure of this planning decision supplies no runtime evidence.

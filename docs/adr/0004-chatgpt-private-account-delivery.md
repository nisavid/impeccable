# Deliver a candidate to one ChatGPT account without a hosted tag

The [acceptance plan](../repack-acceptance-plan.md) requires an observation on the ChatGPT account or workspace route: the exact archive accepted through the intended route, its identity, version, and components read back, and representative operations observed in a fresh task. [ADR 0001](0001-repack-identity-and-versioning.md) requires an immutable candidate tag before any hosted exposure, the [procedure](../repack-procedure.md#reserve-one-version) requires hosted release attempts to establish that tag before any consumer exposure, and [ADR 0003](0003-claude-desktop-local-route.md) exempts one route, a local Claude Desktop delivery. No document said which rule a private upload to a ChatGPT account follows. This ADR is the scope decision for one route: a private upload of the exact portable archive to one account or workspace the operator controls, through the delivery owner's route, for qualification. It does not change the other routes, replace the official installation, or authorize any hosted tag, release, marketplace branch, or workflow. It is not the account delivery and automatic synchronization that [ADR 0002](0002-release-qualification.md) also requires; that observation stays separate.

## Exposure boundary

The upload is a private account delivery. It is not a hosted release attempt, it is not the hosted exposure before which ADR 0001 requires a tag, and it has no hosted tag. It carries the retained portable archive byte for byte. Exposure starts at the upload. Before the archive is transferred:

1. The version is reserved and the candidate record is retained.
2. The delivery is entered in the exposure inventory as a private account delivery. That entry is the delivery record, and its `version` is the full allocated manifest version.
3. The delivery owner establishes who can receive or use the archive under the selected upload settings. A personal upload within a workspace the operator controls qualifies if access is confined to the operator. A default that makes the plugin available to workspace members makes the upload workspace-wide distribution, which requires the hosted tag before upload. If the audience cannot be established, the delivery stops before transfer. A later reach check can verify the audience but does not replace this step, because exposure has already occurred by then.

A public release, a marketplace listing, workspace-wide distribution, and any import from a repository stay under the hosted rule: each requires the immutable `repack-v<full-package-version>` tag first, as ADR 0001 and the procedure require. Delivery to any other account or workspace is outside this decision.

## Uniqueness and versions

Version uniqueness rests on one allocator and a complete exposure inventory: every release path reserves through the procedure's allocator, and every later reservation's inventory includes this delivery. A local reservation establishes neither remote uniqueness nor qualification. Acceptance of the upload does not establish qualification either; the acceptance plan's observations do.

The delivery record's `version` stays the full allocated manifest version, and the archive keeps its bytes and its version spelling. After the upload, the service's exact version readback is appended to the delivery record. The allocator compares only each inventory entry's `version`, so if the service shows a different numeric version for this package in the same release sequence, the next allocator input includes that value as an additional exposure of the same candidate. A revision identifier that only the service uses stays with the service's upload receipt. If it cannot be established whether the service's value is a distinct version or how it orders against the allocated one, that is reconciled before the next allocation; the first upload need not wait for it. A consumer-specific spelling still requires demonstrated incompatibility, as ADR 0001 says.

This rule concerns exposure and changes no tool. It applies to the unchanged archive of a candidate selected for this delivery that has valid reservation, build, and validation evidence under the procedure revision its reservation binds. That binding is retained, and the delivery record cites both the revision the reservation binds and the reviewed procedure revision the delivery follows. Adopting this rule alone requires no rebuild and no new reservation.

## Alternative

If this rule is not accepted, the alternative is the hosted tag: the candidate's immutable `repack-v<full-package-version>` tag, made before the upload with the reviewed publication commands. Those commands stay held, so under that alternative the delivery waits for them.

# Deliver a candidate to one ChatGPT account without a hosted tag

The [acceptance plan](../repack-acceptance-plan.md) requires an observation on the ChatGPT account or workspace route: the exact archive accepted through the intended route, its identity, version, and components read back, and representative operations observed in a fresh task. [ADR 0001](0001-repack-identity-and-versioning.md) requires an immutable candidate tag before any hosted exposure, the [procedure](../repack-procedure.md#reserve-one-version) requires hosted release attempts to establish that tag before any consumer exposure, and [ADR 0003](0003-claude-desktop-local-route.md) exempts one route, a local Claude Desktop delivery. No record said which rule a private upload to a ChatGPT account follows. This record is the scope decision for one route: a private upload of the exact portable archive to one account or workspace the operator controls, through the delivery owner's route, for qualification. It does not change the other routes, replace the official installation, or authorize any hosted tag, release, marketplace branch, or workflow. It is not the account delivery and automatic synchronization that [ADR 0002](0002-release-qualification.md) also requires; that observation stays separate.

## Exposure boundary

The upload is a private account delivery. It is not a hosted release attempt, it is not the hosted exposure before which ADR 0001 requires a tag, and it has no hosted tag. It carries the retained portable archive byte for byte. Exposure starts at the upload. Before it:

1. The version is reserved and the candidate record is retained.
2. The delivery is entered in the exposure inventory as a private account delivery, with the allocated version.

A public release, a marketplace listing, workspace-wide distribution, and any import from a repository stay under the hosted rule: each requires the immutable `repack-v<full-package-version>` tag first, as ADR 0001 and the procedure require. Delivery to any other account or workspace is outside this decision.

## Uniqueness and versions

Version uniqueness rests on one allocator and a complete exposure inventory: every release path reserves through the procedure's allocator, and every later reservation's inventory includes this delivery. A local reservation establishes neither remote uniqueness nor qualification. Acceptance of the upload does not establish qualification either; the acceptance plan's observations do.

The service may assign a version of its own to the uploaded plugin. When it does, the exposure-inventory entry gains that assigned version beside the allocated one. The archive keeps its one allocated version, and a consumer-specific spelling still requires demonstrated incompatibility, as ADR 0001 says.

This rule concerns exposure and changes no tool. A candidate reserved under an earlier procedure revision may therefore be delivered under it, and the record of the delivery cites both the revision its reservation binds and the procedure revision it is delivered under, which carries this record.

## Alternative

If this rule is not accepted, the alternative is the hosted tag: the candidate's immutable `repack-v<full-package-version>` tag, made before the upload with the reviewed publication commands. Those commands stay held, so under that alternative the delivery waits for them.

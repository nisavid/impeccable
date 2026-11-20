# Qualify the repack procedure and verify each upstream refresh

The fork trusts the selected upstream stable-release stream for the copied skill and runtime content. An unchanged, reviewed repacker may publish a new verified upstream payload after deterministic provenance, fidelity, archive, and compatibility checks, without another downstream agent review of that copied payload. This is a narrow exception to repeated upstream-payload review; fork-owned code and configuration still require independent review.

A changed packaging procedure, signing identity, license, unsupported package shape, or detected expansion of runtime capabilities stops promotion for investigation and renewed qualification. Input-integrity failures and failed checks retain the last qualified publication. The accepted scope is a vanilla repack, not authority to make semantic upstream changes.

The first repack requires actual observations on the requested ChatGPT, Codex Cloud, and local Codex routes, including the requested account delivery and automatic synchronization. Upload acceptance, documentation, and a successful manual upgrade are distinct evidence. An unavailable route or reduced capability returns a concrete decision before the claimed scope is narrowed or the working official installation is removed.

The [acceptance plan](../repack-acceptance-plan.md) defines the initial observations, routine checks, promotion order, and recovery cases. This [qualification decision](https://github.com/nisavid/impeccable/issues/6) defines the requirements; implementation and successful execution remain separate work.

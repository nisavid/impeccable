# Domain docs

Use one domain context for the repack: a root `GLOSSARY.md` and system-wide
decisions under `docs/adr/`.

Before exploring, planning, or editing, read the glossary and any ADRs relevant
to the work. For live-mode work, also read the existing
`docs/adr-live-variant-mode.md`; keep that document in place.

If the glossary or ADR directory is absent, proceed silently.
`domain-modeling` creates them lazily when terminology or decisions are
settled.

Use glossary terms in specifications, issues, tests, code, and documentation.
When a needed term is missing, check whether an existing term already fits;
otherwise leave the gap for `domain-modeling`. Name any conflict with an
existing ADR before proposing a different decision.

# Triage labels

Use the same canonical labels in GitHub and the linked Linear team.

| Role | Label | Meaning |
| --- | --- | --- |
| Needs triage | `needs-triage` | Maintainer evaluation needed |
| Needs information | `needs-info` | More information needed from the reporter |
| Ready for an agent | `ready-for-agent` | Fully specified for an agent to implement |
| Ready for a human | `ready-for-human` | Human implementation required |
| Will not implement | `wontfix` | Will not be actioned |

Reuse these names when a skill refers to a triage role. When the active task
authorizes label setup, create only missing configured labels in GitHub.
Resolve the current team identity and inspect its existing labels. When a
synchronized issue uses a label, verify the matching name on both records.
If it is missing, investigate propagation before creating a duplicate or
alternate label. Verify relevant label definitions separately; issue-label
synchronization does not establish definition propagation. Preserve
unrelated definitions. Setup does not require unused labels to appear in
Linear and does not introduce a new shared label taxonomy.

Wayfinder labels and their use are defined in `issue-tracker.md`.

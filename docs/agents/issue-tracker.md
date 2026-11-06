# Issue tracker: GitHub and Linear

Create issues, specs, and Wayfinder maps in GitHub Issues for
`nisavid/impeccable`. Verify each linked Linear counterpart in workspace
`nisavid`, team `IDV`, then manage the work in Linear where its controls
support the operation. Use the GitHub CLI, APIs, or connectors for targeted
GitHub operations.

## Create and verify

1. Read the relevant records and operator-owned checklists. Confirm the
   repository/team mapping and current tool capabilities; resolve team
   identity before querying team-scoped labels or issues.
2. Create the GitHub issue under the active task's authority. Use the
   integration to create its linked Linear counterpart. Record both links
   after verifying the pair.
3. If the counterpart is missing, investigate the mapping and delivery while
   preserving the GitHub issue. Do not create a second, independent Linear
   issue to bypass missing synchronization.

Use GitHub-to-Linear issue creation with two-way synchronization of updates
and issue labels. Verify relevant label definitions separately; issue-label
synchronization does not establish definition propagation. Verify the
affected records after changes; selecting this mode does not prove that a
particular change propagated. Preserve unverified results as unknown.

## Updates, relations, and privacy

Use Linear for supported ongoing changes. Use targeted GitHub operations for
native parent/sub-issue and blocking relations, or public updates, that the
integration does not carry. Verify both representations and reconcile missing
relations through supported controls before relying on the graph.

Treat titles, descriptions, labels, state, and identified GitHub-synced comment
threads as public. Keep private Linear comments outside those threads, and
check a comment's destination before posting. Never put private context into
synced fields or comments.

Use the existing state mappings and the labels in `triage-labels.md`.
Check actual propagation after a state or label change, including changes to
label definitions. A successful write to one service does not establish the
other service's state.

## Pull requests as a triage surface

**PRs as a request surface: no.**

An explicitly selected PR remains subject to the installed `triage` skill's
verification boundary before checkout, dependency setup, or execution.

## Wayfinding operations

Maps and their decision tickets carry only Wayfinder labels, never triage
labels.

- **Map:** one issue labelled `wayfinder:map`, with Destination, Notes,
  Decisions so far, Not yet specified, and Out of scope sections. Keep its
  children in map order.
- **Children:** link each child as a native sub-issue of the map. Give it one
  Wayfinder type label: `wayfinder:research`, `wayfinder:prototype`,
  `wayfinder:grilling`, or `wayfinder:task`.
- **Blockers:** record dependencies as native blocking relations. Verify the
  corresponding GitHub and Linear relations; a closed blocker does not keep
  a child blocked.
- **Frontier:** read the complete ordered child list, assignments, and blocker
  states. Select the first open, unassigned child with no open blocker.
- **Claim:** assign the driving developer before work, then reread the claim
  and blockers. Assignment is an advisory claim. If another claimant appears,
  treat the child as taken and select again.
- **Resolve:** post the answer as a public resolution comment on the child,
  add its answer-and-link pointer to the map's Decisions so far, and reread to
  verify the pointer before closing the child. Read the current map body before
  editing it, preserve unrelated changes, and recognize an existing child
  pointer when retrying.

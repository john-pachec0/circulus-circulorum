# obsidian-blog Constitution

Principles that bind every change in this repo. The Constitution Check in each
`plan.md` is measured against these; a violation goes in Complexity Tracking
with a justification or the plan changes.

## Core Principles

### I. The vault and the site are one directory

Posts are authored in Obsidian and built by Astro from the same files. No
export step, no sync script, no second copy of content. Any change that would
require the author to run a transform before committing is rejected.

### II. Publishing to LinkedIn is one-way and write-once

The repo is the source of truth; LinkedIn is a snapshot taken at publish time.
Nothing is ever read back from LinkedIn into the repo, and nothing in the repo
holds a credential for it. A post is offered for syndication at most once,
enforced by deduplicating against issues in any state — a closed issue counts,
because closing it is how a post is marked done. Re-offering is a deliberate
manual act.

*Amended 2026-09-02 (spec 001 rev 2): the original wording named a ledger in
the post's own frontmatter, which existed to make an irreversible API call
safe. With no API call, the repo is never written to by machine and the ledger
is unnecessary.*

### III. Fail loudly, publish nothing on doubt

Syndication validates everything before the first network call and aborts the
whole run on any violation. Content is never silently truncated, altered, or
partially published. A half-syndicated post is worse than an unsyndicated one.
Where an unrecoverable state is possible, it stops and asks a human rather
than guessing.

### IV. No secret and no personal data in the repo

Git history is permanent and this repo is public. Credentials live only in
GitHub Actions secrets. Nothing is committed that the author would not publish
deliberately — drafts included, since drafts are committed by design.

### V. Smallest thing that works

Stdlib and platform features before dependencies; a dependency must name what
it buys. No abstraction without a second caller. Deliberate shortcuts carry a
comment naming the ceiling and the upgrade path.

## Quality Gates

- Non-trivial logic ships with one runnable check that fails if the logic
  breaks. Tests over generated or selected sets must also assert the set was
  non-empty.
- Behaviour is verified by exercising it end to end, not by typechecking.
- Every external API claim in a plan cites the current vendor doc, not recall.
  An unverifiable claim that would change the design is recorded as unverified,
  never dropped.

## Governance

Amendments are a commit to this file with a rationale in the message. The
constitution outranks convenience; when a plan and this file disagree, the plan
changes or the file is amended first.

**Version**: 1.1.0 | **Ratified**: 2026-09-02 | **Last Amended**: 2026-09-02

# Feature Specification: Obsidian-authored blog with assisted LinkedIn syndication

**Feature Branch**: `001-blog-linkedin-syndication`

**Created**: 2026-09-02

**Revision**: 2 — scope narrowed 2026-09-02. Automatic LinkedIn API publishing
removed; replaced with a manual-assist workflow. See Revision History.

**Status**: Approved 2026-09-02 (CHALLENGE gate: PROCEED-WITH-CHANGES, blocker
fixed pre-approval). Revision 2 pending re-challenge — see Adversarial Review.

**Input**: User description: "A personal blog written in Obsidian and built by
Astro from the same directory, deployed to Cloudflare Pages, with Giscus
comments backed by GitHub Discussions. On publish, a GitHub Action prepares the
LinkedIn post text and canonical link as a GitHub issue for the author to paste
— reach on LinkedIn without maintaining a LinkedIn integration."

## Revision History

| Rev | Date | Change |
|---|---|---|
| 1 | 2026-09-02 | Original: automatic syndication via the LinkedIn Posts API, with `linkedinUrn` frontmatter as an idempotency ledger |
| 2 | 2026-09-02 | **Scope narrowed.** LinkedIn API integration dropped entirely. The workflow now opens a GitHub issue containing paste-ready text; the author pastes it when convenient |

### Why revision 2

Revision 1's machinery existed because its side effect was irreversible: a
published LinkedIn post cannot be un-published, so every failure mode had to be
engineered against. That produced an OAuth bootstrap, a credential with a
365-day life and a health-check workflow, `little`-format escaping, URN
encoding with a fallback form, a reserve-then-confirm ledger written back to
the repo, a concurrency group, a deploy-race guard, and a 19-row failure table
— plus two external questions that could not be answered from documentation.

Changing the side effect from *a public post* to *an issue in the author's own
repository* makes all of that unnecessary. Worst-case failure becomes a
duplicate issue. The cost is roughly thirty seconds of LinkedIn per published
post instead of zero.

The author accepted that trade explicitly. Requirements FR-014 through FR-034
of revision 1 are withdrawn and replaced by FR-014 through FR-020 below.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Write a post in Obsidian and have it appear on the web (Priority: P1)

The author opens the repo as an Obsidian vault, writes a note in
`src/content/posts/`, pastes in a screenshot, fills the frontmatter, flips
`draft` to `false`, and pushes. A few minutes later the post is live on the
site with the image rendered, listed on the index, and present in the feed.

**Why this priority**: This is the blog. Everything else is optional garnish on
top of it.

**Independent Test**: Write one post with one image, push, load the deployed
URL. Fully testable with no Giscus install and no GitHub Actions configured.

**Acceptance Scenarios**:

1. **Given** a note with `draft: false` in `src/content/posts/`, **When** the
   site builds, **Then** the post is reachable at `/posts/<slug>/`, appears on
   the index, and appears in the RSS feed.
2. **Given** a note with `draft: true`, **When** the site builds for production,
   **Then** no page, index entry, or feed item exists for it anywhere in the
   built output — while the file remains committed and readable in the repo.
3. **Given** a note with `draft: true`, **When** the site is run locally in dev,
   **Then** the post IS rendered, so drafts can be previewed.
4. **Given** an image pasted into a note by Obsidian, **When** the site builds,
   **Then** the image resolves and is emitted as a processed asset.
5. **Given** frontmatter missing a required field or holding a wrong type,
   **When** the site builds, **Then** the build fails naming the file and field.

---

### User Story 2 - Keep the vault usable without polluting the repo (Priority: P2)

The author uses Obsidian normally — searching, opening the graph, using the
quick switcher, moving panes around — and none of it drags build artifacts into
the workspace or produces git noise.

**Why this priority**: Without this the vault is unusable in practice
(`node_modules` swamps every search) and the git history fills with workspace
churn. Cheap, and it protects P1's authoring loop.

**Independent Test**: Open the vault, search, move panes, paste an image, then
run `git status`.

**Acceptance Scenarios**:

1. **Given** the vault is open, **When** the author searches or uses the quick
   switcher, **Then** no result comes from `node_modules/`, `dist/`, or
   `.astro/`.
2. **Given** the author rearranges panes and closes Obsidian, **When** they run
   `git status`, **Then** no tracked file has changed.
3. **Given** the author inserts a link to an image, **When** the note is saved,
   **Then** the emitted markdown is a standard relative link, never a
   `![[wikilink]]`.
4. **Given** a fresh clone opened as a vault, **Then** the author's editor
   settings are already in place.

---

### User Story 3 - Readers can comment without the author running a comment system (Priority: P3)

A reader at the bottom of a post signs in with GitHub and leaves a comment. It
lands in this repo's Discussions, where the author already works.

**Why this priority**: Valuable but strictly additive.

**Independent Test**: Deploy, open a post, leave one comment, confirm the
Discussion appears.

**Acceptance Scenarios**:

1. **Given** a published post, **When** a reader loads it, **Then** a comment
   widget renders below the article.
2. **Given** a reader posts the first comment on a post, **When** it submits,
   **Then** a GitHub Discussion is created keyed to that post's path.
3. **Given** a reader with the OS set to dark mode, **When** they load a post,
   **Then** the comment widget matches.
4. **Given** a visitor who is not signed in, **When** they load a post, **Then**
   existing comments are readable.

---

### User Story 4 - Get a post onto LinkedIn without thinking about it (Priority: P4)

The author writes a standalone plain-text teaser into the post's frontmatter
and publishes. A GitHub issue appears containing exactly two blocks of text:
the post body to paste into LinkedIn's composer, and the follow-up comment
carrying the canonical URL. The author pastes both at some convenient moment
and closes the issue. They never configure a LinkedIn app, never store a
credential, and never think about the post again once it is closed.

**Why this priority**: The distinctive feature, but it depends on P1 for a URL
to point at, and its value is convenience rather than capability — the author
could always have written the teaser by hand.

**Independent Test**: Publish one post with a teaser and confirm the issue
appears with correct, paste-ready content. Requires no LinkedIn account to
test.

**Acceptance Scenarios**:

1. **Given** a post with `draft: false` and a `linkedinText` teaser, **When** it
   is pushed, **Then** exactly one GitHub issue is opened containing the teaser
   verbatim and the canonical URL.
2. **Given** that issue already exists in any state, open or closed, **When**
   the post is pushed again for any reason, **Then** no second issue is
   created.
3. **Given** a post with no `linkedinText`, **When** it is pushed, **Then** no
   issue is created and the run succeeds.
4. **Given** a post with `draft: true` and a `linkedinText`, **When** it is
   pushed, **Then** no issue is created.
5. **Given** a `linkedinText` containing a URL, **When** the site builds,
   **Then** the build fails — the link belongs in the follow-up comment, not
   the body.
6. **Given** a `linkedinText` longer than the configured guard, **When** the
   site builds, **Then** the build fails reporting the actual length, and the
   text is never truncated.
7. **Given** the author pastes the two blocks into LinkedIn, **Then** the text
   appears exactly as authored — no escaping artifacts, no markdown syntax.

---

### Edge Cases

- **Two posts published in one push**: each gets its own issue; a failure on the
  second must not prevent the first.
- **A post edited after its issue was created**: no second issue. The issue
  holds a snapshot of the teaser at publish time; if the author wants a revised
  teaser they reopen or edit the issue by hand.
- **A post renamed after publication**: its comment thread is orphaned and any
  already-pasted LinkedIn link breaks. Published slugs are treated as
  immutable.
- **Issue created but the author never pastes it**: it stays open. That is the
  intended behaviour — the issue list is the to-do list.
- **The workflow fails entirely**: nothing is lost. The teaser is in the repo
  and the issue can be recreated by re-running the workflow.

## Requirements *(mandatory)*

### Functional Requirements

**Authoring and site**

- **FR-001**: Posts MUST be authored as markdown files inside the repository
  and built without any export or transform step.
- **FR-002**: Frontmatter MUST be validated against a typed schema at build
  time: `title`, `description`, `pubDate`, `updated?`, `tags[]`, `draft`
  (default `true`), `linkedinText?`.
- **FR-003**: Posts with `draft: true` MUST be excluded from all production
  output — pages, indexes, feed, and sitemap — while remaining committed.
- **FR-004**: Drafts MUST be visible in local development.
- **FR-005**: The site MUST publish an RSS feed and a sitemap of published
  posts only.
- **FR-006**: Images referenced from posts MUST be processed by the site's
  asset pipeline.
- **FR-007**: Each published post MUST have a stable canonical URL derivable
  from its filename alone.

**Vault**

- **FR-008**: Editor configuration MUST be committed so a fresh clone is a
  working vault, EXCEPT volatile workspace state, which MUST be ignored.
- **FR-009**: The editor MUST be configured to emit standard relative markdown
  image links and never wikilinks.
- **FR-010**: The editor MUST exclude build directories from indexing.

**Comments**

- **FR-011**: Each published post MUST render a comment thread backed by this
  repository's Discussions, keyed to the post's path.
- **FR-012**: The comment widget MUST follow the reader's light/dark preference.
- **FR-013**: Comment threads MUST be creatable only by the comment system, not
  opened directly by arbitrary users.

**Syndication assistance**

- **FR-014**: The presence of a non-empty `linkedinText` MUST be the sole opt-in
  for syndication assistance. There is no separate boolean flag — a teaser
  exists or it does not.
- **FR-015**: On push to the default branch, for each post that is not a draft
  and has a `linkedinText`, the system MUST open a GitHub issue containing the
  teaser verbatim and the canonical URL, each in a form that can be copied
  without editing.
- **FR-016**: Issue creation MUST be idempotent, keyed to the post's slug and
  deduplicated against issues in any state. Re-pushing MUST NOT create a second
  issue.
- **FR-017**: The system MUST NOT write to the repository, hold any credential
  for an external service, or make any request to LinkedIn. Its only privilege
  is opening issues in its own repository.
- **FR-018**: `linkedinText` MUST be validated at **build** time — non-empty
  when present, within a configurable length guard, and containing no URL — so
  a violation fails on the author's own machine before it can reach the
  workflow. It MUST NEVER be truncated or altered.
- **FR-019**: A filename that would not round-trip to the canonical slug MUST
  fail at build time.
- **FR-020**: The teaser MUST be stored and emitted as literal plain text with
  literal line breaks. No escaping, encoding, or markup transformation is
  applied at any point.

### Key Entities

- **Post**: a markdown file. Identity is its filename-derived slug. Carries
  authoring fields, a publication flag, and an optional syndication teaser.
- **Syndication issue**: a GitHub issue keyed to a post's slug, holding the
  paste-ready text. It is the to-do item and the deduplication key. There is no
  other state anywhere in the system.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The author can go from a blank note to a live post using only
  Obsidian and `git push` — zero other tools, zero manual build steps.
- **SC-002**: Getting a post onto LinkedIn requires no decision-making and no
  writing: the text is already written and the author's only actions are copy,
  paste, paste.
- **SC-003**: No post ever produces two syndication issues, across re-push,
  body edit, frontmatter edit, workflow re-run, and two pushes within seconds.
- **SC-004**: 100% of invalid teasers (over-length, containing a URL) are
  rejected at build time, before any workflow runs.
- **SC-005**: Zero production pages, feed items, or sitemap entries exist for
  posts marked as drafts, verified against built output rather than by
  inspection.
- **SC-006**: The repository holds no credential for any external service, and
  no workflow in it has write access to repository contents.
- **SC-007**: Text pasted into LinkedIn is byte-identical to the `linkedinText`
  in the repository.
- **SC-008**: Zero secrets appear anywhere in the repository or its history.

## Assumptions

- The author is willing to open LinkedIn briefly to paste a prepared post. This
  is the trade revision 2 makes; if it ever becomes intolerable, revision 1's
  design is recorded and can be revived.
- The repository is public and remains so; Giscus requires it, and the author
  accepts that drafts and all history are publicly readable.
- Everything committed is content the author is willing to publish. No secrets,
  no personal data, ever — including in fixtures.
- Posts are text-and-image essays.
- LinkedIn is a snapshot at paste time. Nothing is ever read back, and edits to
  a post never propagate.
- One author, low volume.
- Post slugs, once published, are immutable.
- Cloudflare Pages' Git integration provides build-on-push; no adapter or
  server rendering is required.

## Adversarial Review

| Gate | Reviewer | Date | Verdict | Applies to |
|---|---|---|---|---|
| CHALLENGE | `challenge-reviewer` | 2026-09-02 | **PROCEED-WITH-CHANGES** | Revision 1 |
| CHALLENGE | — | — | pending | Revision 2 |

### Revision 1 record — retained deliberately

Revision 2 removes the machinery most of these findings targeted. The record is
kept because it is the reason the design changed, and because a future reader
considering "why not just call the LinkedIn API?" should see what that costs.

**Strongest objection against revision 1**, which was accepted and fixed before
approval:

> A failed ledger push — a failure the plan itself enumerates as expected —
> does not merely degrade; it guarantees a duplicate LinkedIn post. […] At that
> moment the LinkedIn post is live and `linkedinUrn` on `main` is still empty,
> and selection is `!linkedinUrn` read from the checked-out repo — so the next
> push touching `src/content/posts/**`, including the author's own natural
> remedy of pushing a fix, re-selects that post and creates a **second**
> LinkedIn post. The opened issue is a notification, not a lock; nothing in the
> design consults it.

| # | Sev | Revision 1 finding | Status under revision 2 |
|---|---|---|---|
| 1 | blocker | Failed ledger push guarantees a duplicate post | **Moot** — no post is created by machine; a duplicate issue is harmless and deduplication is a search, not a ledger |
| 2 | major | `[skip ci]` must be a commit-message prefix, not a suffix | **Moot** — nothing writes back to the repo, so no ledger commit exists |
| 3 | major | Three link strategies built speculatively | **Moot** — no strategies; the author decides at paste time |
| 4 | major | `article` fallback is a different post format, not a config swap | **Moot** |
| 5 | major | The permission probe had no success guard | **Moot** — no probe, no LinkedIn app, no permission question |
| 6 | major | The 3000-char limit is uncited recall | **Live, downgraded** — retained as a configurable build-time guard; a wrong value now costs a rejected paste, not a failed publish |
| 7 | major | Scheduled workflows disable after 60 days; fallback token has no readable expiry | **Moot** — no credential, no scheduled workflow |
| 8 | major | Kebab-case enforced too late, could wedge a published post | **Live and fixed** — enforced at build time (FR-019) |
| 9 | major | The image test fixture would default to `draft: true` and prove nothing | **Live and fixed** — fixture pinned to `draft: false` |
| 10 | minor | `escapeLittle` is not idempotent; write-back insert branch untested | **Moot** — no escaping and no write-back exist |

Also recorded from that review, and still worth knowing: **the premise that
LinkedIn down-ranks posts containing links is not vendor-documented** and no
authoritative source was found. Under revision 1 this premise justified an
entire subsystem. Under revision 2 it costs one extra paste — and if it turns
out to be false, the fix is to put the URL in the body and stop pasting twice.

### Owner decisions

| Question | Decision | Revision |
|---|---|---|
| Build order — probe before code | Adopted, then **superseded**: no probe exists under revision 2 | 1 → 2 |
| Is an `article` link card acceptable? | Deferred, now **moot** | 1 → 2 |
| `waitForLive` deploy-race guard | Kept in rev 1, **dropped** in rev 2 — the author pastes minutes or hours later, by which time the deploy is long finished | 1 → 2 |
| Kebab-case filenames | **Enforce**, at build time | both |
| Automatic API publishing vs. manual-assist | **Manual-assist.** The automation bought ~30 seconds per post in exchange for the entire maintenance surface of the project | 2 |

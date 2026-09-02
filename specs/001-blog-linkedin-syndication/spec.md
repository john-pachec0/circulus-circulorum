# Feature Specification: Obsidian-authored blog with automated LinkedIn syndication

**Feature Branch**: `001-blog-linkedin-syndication`

**Created**: 2026-09-02

**Status**: Draft — awaiting owner approval

**Input**: User description: "A personal blog written in Obsidian and built by Astro from the same directory, deployed to Cloudflare Pages, with Giscus comments backed by GitHub Discussions, and a GitHub Action that syndicates selected posts to LinkedIn as plain-text posts with the canonical URL in the first comment — so the author can publish to LinkedIn without ever logging in."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Write a post in Obsidian and have it appear on the web (Priority: P1)

The author opens the repo as an Obsidian vault, writes a note in
`src/content/posts/`, pastes in a screenshot, fills the frontmatter, flips
`draft` to `false`, and pushes. A few minutes later the post is live on the
site with the image rendered, listed on the index, and present in the feed.

**Why this priority**: This is the blog. Everything else is optional garnish on
top of it. Without this there is nothing to syndicate and nothing to comment on.

**Independent Test**: Write one post with one image, push, load the deployed
URL. Fully testable with no LinkedIn app, no Giscus install, and no secrets
configured.

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
   **Then** the image resolves and is emitted as a processed asset — not a
   broken link and not an unoptimised copy.
5. **Given** frontmatter missing a required field or holding a wrong type,
   **When** the site builds, **Then** the build fails naming the file and field.

---

### User Story 2 - Keep the vault usable without polluting the repo (Priority: P2)

The author uses Obsidian normally — searching, opening the graph, using the
quick switcher, moving panes around — and none of it drags build artifacts into
the workspace or produces git noise.

**Why this priority**: Without this the vault is unusable in practice
(`node_modules` swamps every search) and the git history fills with workspace
churn. It is cheap and it protects P1's authoring loop.

**Independent Test**: Open the vault, search, move panes, paste an image, then
run `git status`. No config changes needed elsewhere.

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
   settings are already in place — the vault config is reproducible.

---

### User Story 3 - Readers can comment without the author running a comment system (Priority: P3)

A reader at the bottom of a post signs in with GitHub and leaves a comment. It
lands in this repo's Discussions. The author is notified through GitHub, where
they already work.

**Why this priority**: Valuable but strictly additive — the blog is complete
without it, and it depends on P1 existing to have somewhere to mount.

**Independent Test**: Deploy, open a post, leave one comment, confirm the
Discussion appears. Independent of syndication entirely.

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

### User Story 4 - Publish to LinkedIn without logging in to LinkedIn (Priority: P4)

The author sets `linkedin: true` and writes a standalone plain-text
`linkedinText` teaser in the frontmatter. On push, a GitHub Action publishes
that text to LinkedIn as a post with no link in it, then attaches the canonical
URL so readers can find the essay. The author never opens LinkedIn.

**Why this priority**: The distinctive feature, but it depends on P1 for a URL
to point at, and it is the only part gated on an unresolved external question
(see Adversarial Review and `research.md`).

**Independent Test**: Set `linkedin: true` on one real post, dispatch the
workflow, confirm the post and its link appear on LinkedIn and the ledger field
is written back — all without a browser session on LinkedIn.

**Acceptance Scenarios**:

1. **Given** a post with `draft: false`, `linkedin: true`, and an empty ledger
   field, **When** it is pushed, **Then** exactly one LinkedIn post is created
   carrying `linkedinText` and no URL in its body.
2. **Given** that post was created, **When** the run continues, **Then** the
   canonical URL is attached to it and the author's "I don't read LinkedIn"
   line accompanies it.
3. **Given** a syndicated post, **When** the author edits its body or
   frontmatter and pushes again, **Then** no second LinkedIn post is created.
4. **Given** the author deliberately clears the ledger field and pushes,
   **Then** the post is syndicated again.
5. **Given** `linkedin: true` and an empty `linkedinText`, **When** the workflow
   runs, **Then** it fails visibly and creates nothing on LinkedIn.
6. **Given** `linkedinText` longer than the platform limit, **When** the
   workflow runs, **Then** it fails visibly reporting the actual length, and
   the text is never truncated.
7. **Given** the site deploy has not finished, **When** the workflow is ready to
   publish, **Then** it waits for the canonical URL to be live before creating
   the LinkedIn post.
8. **Given** the LinkedIn post was created but the run later fails, **When** the
   workflow is re-run, **Then** it does not create a second post.
9. **Given** the credential is within 30 days of expiry, **When** the scheduled
   health check runs, **Then** a GitHub issue is opened telling the author to
   re-authorise.

---

### Edge Cases

- **Two posts published in one push**: both are syndicated, each with its own
  ledger entry; a failure on the second must not undo or duplicate the first.
- **Two pushes seconds apart**: runs must not interleave and read a stale
  ledger, producing a double post.
- **Reserved characters in `linkedinText`**: parentheses, underscores, `#`,
  backslashes and similar must survive as literal text (see `research.md` §1).
- **A URL typed into `linkedinText`**: rejected — the no-link-in-body rule is
  enforced, not merely documented.
- **Post created but the platform returns no identifier**: unrecoverable
  automatically; must stop and surface it rather than risk a duplicate.
- **Ledger write-back races with another push**: must retry, and if it still
  fails, surface the identifier somewhere durable rather than only in a log.
- **The write-back commit**: must not trigger a site rebuild or re-run the
  workflow.
- **Post renamed after publication**: its comment thread is orphaned; accepted,
  and slugs of published posts are treated as immutable.
- **Credential revoked by the platform mid-life**: the run fails visibly and the
  health check reports it.

## Requirements *(mandatory)*

### Functional Requirements

**Authoring and site**

- **FR-001**: Posts MUST be authored as markdown files inside the repository
  and built without any export or transform step.
- **FR-002**: Frontmatter MUST be validated against a typed schema at build
  time: `title`, `description`, `pubDate`, `updated?`, `tags[]`, `draft`
  (default `true`), `linkedin`, `linkedinText?`, `linkedinUrn?`.
- **FR-003**: Posts with `draft: true` MUST be excluded from all production
  output — pages, indexes, feed, and sitemap — while remaining committed.
- **FR-004**: Drafts MUST be visible in local development.
- **FR-005**: The site MUST publish an RSS feed and a sitemap of published
  posts only.
- **FR-006**: Images referenced from posts MUST be processed by the site's
  asset pipeline.
- **FR-007**: Each published post MUST have a stable canonical URL derivable
  from its filename alone, by both the site and the syndication job.

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

**Syndication**

- **FR-014**: Syndication MUST run on push to the default branch when post
  files change, and MUST be manually dispatchable.
- **FR-015**: A post MUST be selected for syndication only when `draft` is
  false, `linkedin` is true, and `linkedinUrn` is empty.
- **FR-016**: `linkedinUrn` MUST be the sole idempotency ledger. No database,
  no external state.
- **FR-017**: Before any network call, the job MUST validate every selected
  post and abort the entire run on the first violation, publishing nothing.
- **FR-018**: Validation MUST reject: empty `linkedinText`; `linkedinText` over
  the configured length guard; a URL inside `linkedinText`. Length MUST be
  measured in codepoints, and the guard MUST be a configurable value rather
  than an asserted platform constant — the limit is not vendor-documented
  (`research.md` §10).
- **FR-018a**: A filename that would not round-trip to the canonical slug MUST
  fail at **build** time, not first at syndication time — otherwise a post can
  be published to the web for months and only then become unsyndicatable, with
  the only remedy being a rename the Assumptions forbid.
- **FR-019**: `linkedinText` MUST NEVER be truncated, reflowed, or edited to
  fit.
- **FR-020**: `linkedinText` MUST be authored as plain text with literal line
  breaks, and any platform-specific escaping MUST be applied by the job, not by
  the author.
- **FR-021**: The published post body MUST contain no URL.
- **FR-022**: The canonical URL MUST be attached to the published post by a
  configurable link strategy, defaulting to a first comment carrying the URL
  and the author's "I don't read LinkedIn" line.
- **FR-023**: Changing link strategy MUST be a configuration change, not a code
  rewrite — at minimum one non-comment strategy MUST exist and be implemented.
- **FR-024**: The job MUST NOT create the LinkedIn post until the canonical URL
  returns success, or fail if it does not within a bounded wait.
- **FR-025**: The ledger MUST be reserved before publication and confirmed
  after: a claim marker is written to frontmatter and pushed BEFORE the call
  that creates the post, then overwritten with the real identifier once it is
  known. No sequence of failures may leave a published post with an empty
  ledger. *(Revised at the adversarial gate — the original "record it
  immediately after creation" wording admitted a guaranteed duplicate; see
  Adversarial Review finding 1.)*
- **FR-025a**: A post whose ledger holds a claim marker MUST NOT be selected,
  and MUST raise a durable notification naming the post and the run that
  claimed it, for a human to resolve.
- **FR-026**: Write-back MUST alter only the ledger line, leaving all other
  frontmatter bytes untouched.
- **FR-027**: The write-back commit MUST NOT trigger a rebuild or re-run the
  workflow.
- **FR-028**: Concurrent runs MUST be serialised.
- **FR-029**: Every failure MUST exit non-zero with the upstream status and
  body; no failure may be swallowed.
- **FR-030**: If the identifier cannot be persisted, the job MUST surface it in
  a durable place (an issue), not only in run logs.
- **FR-031**: A scheduled job MUST verify the credential and open an issue on
  failure or within 30 days of expiry, deduplicating against open issues. The
  check MUST NOT depend on the schedule alone — a public repository's scheduled
  workflows are disabled after 60 days of inactivity, so the same check MUST
  also run inline on every syndication run.
- **FR-032**: Credentials MUST be supplied only as repository secrets and MUST
  NOT appear in the repository, logs, or commit messages.
- **FR-033**: The design MUST tolerate the platform declining to issue a
  long-lived refresh credential, via a documented fallback that changes
  configuration only (see `research.md` §3).
- **FR-034**: A local dry-run MUST reproduce selection, validation, and the
  exact outbound payloads with no network access, exiting non-zero on any
  validation failure.

### Key Entities

- **Post**: a markdown file. Identity is its filename-derived slug. Carries
  authoring fields, a publication flag, a syndication opt-in, the syndication
  text, and the syndication ledger.
- **Syndication ledger** (`linkedinUrn`): the platform identifier of the
  published post, or empty. Empty means never published. The only state in the
  system, and it lives in the artifact it describes.
- **Link strategy**: a named way of attaching the canonical URL to a published
  post. Selected by configuration.
- **Credential**: the stored authorisation allowing the job to act as the
  author, with a finite lifetime and a health check.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The author can go from a blank note to a live post using only
  Obsidian and `git push` — zero other tools, zero manual build steps.
- **SC-002**: A post reaches LinkedIn with the author making zero LinkedIn
  logins after the one-time authorisation.
- **SC-003**: No post is ever published to LinkedIn twice: across the full test
  matrix — re-push, body edit, frontmatter edit, workflow re-run after a
  mid-run failure, two pushes within seconds, **a rejected ledger push, a
  runner killed between creation and record, and a creation that returns no
  identifier** — the count of created posts equals the count of posts whose
  ledger was empty at the start. The last three were added at the adversarial
  gate; each falsified this criterion under the original design.
- **SC-004**: 100% of invalid syndication inputs (empty text, over-length text,
  URL in body) are rejected before any network call, with zero content
  published on those runs.
- **SC-005**: No LinkedIn post ever carries a link to a URL that does not
  resolve at the moment it is attached.
- **SC-006**: Zero production pages, feed items, or sitemap entries exist for
  posts marked as drafts, verified against built output rather than by
  inspection.
- **SC-007**: Credential expiry is surfaced to the author at least 30 days
  before it can break publishing.
- **SC-008**: Switching link strategy after the unresolved permission question
  is settled requires no source change — configuration only.
- **SC-009**: Zero secrets appear anywhere in the repository or its history.

## Assumptions

- The author has a LinkedIn account and can complete a one-time browser
  authorisation, and can create or administer a LinkedIn Page — the developer
  portal requires an app be associated with one. This is the only unavoidable
  LinkedIn login.
- The repository is public and remains so; Giscus requires it, and the author
  accepts that drafts and all history are publicly readable.
- Everything committed is content the author is willing to publish. No secrets,
  no personal data, ever — including in fixtures.
- Posts are text-and-image essays. Video, documents, polls, carousels, and
  multi-image LinkedIn posts are out of scope.
- Syndication is one-way. LinkedIn engagement is never read back, and comments
  on LinkedIn are explicitly not the author's concern — that is the point of
  the "I don't read LinkedIn" line.
- One author, low volume. Rate limits, sharding, and multi-tenant concerns are
  out of scope.
- Post slugs, once published, are immutable. Renaming orphans both the comment
  thread and the URL already published to LinkedIn.
- Cloudflare Pages' Git integration provides build-on-push; no adapter or
  server rendering is required.

## Adversarial Review

| Gate | Reviewer | Date | Verdict |
|---|---|---|---|
| CHALLENGE | `challenge-reviewer` | 2026-09-02 | **PROCEED-WITH-CHANGES** |

Scope reviewed: `spec.md`, `research.md`, `plan.md`, `quickstart.md`, and
`.specify/memory/constitution.md`. The locked architectural decisions were
declared out of scope for the review and were not relitigated.

### Strongest objection (verbatim, as put to the owner)

> A failed ledger push — a failure the plan itself enumerates as expected —
> does not merely degrade; it guarantees a duplicate LinkedIn post. The plan
> ordered create-post → commit ledger → push, and said that if all three push
> attempts fail the job opens an issue and exits non-zero. At that moment the
> LinkedIn post is live and `linkedinUrn` on `main` is still empty, and
> selection is `draft==false && linkedin==true && !linkedinUrn` read from the
> checked-out repo — so the next push touching `src/content/posts/**`,
> including the author's own natural remedy of pushing a fix, re-selects that
> post and creates a **second** LinkedIn post. The opened issue is a
> notification, not a lock; nothing in the design consults it. The same window
> swallows the missing-`x-restli-id` case and any runner kill between the 201
> and the push, so SC-003 is falsified by three separate paths the plan already
> knew about.

**Accepted.** Fix applied before approval: reserve-then-confirm
(plan.md §7.4) — the ledger is claimed and pushed *before* the creating call
and overwritten with the real identifier after. FR-025 rewritten, FR-025a
added, failure table rebuilt around it. This converts an unrecoverable
duplicate into a recoverable missed record, which is what constitution
Principle III asks for.

### Findings

| # | Sev | Where | Claim attacked | Disposition |
|---|---|---|---|---|
| 1 | blocker | plan §7.4, §10; SC-003 | "No post is published twice"; a failed ledger push is handled by an issue | **Fixed** — reserve-then-confirm ordering; FR-025/FR-025a rewritten |
| 2 | major | research §7; plan §7.4 | `[skip ci]` suppresses the Pages rebuild | **Fixed, and the claim was wrong** — independently re-verified: Cloudflare honours the token only *as a prefix*. Suffix placement would have rebuilt on every ledger commit. Marker moved to the front |
| 3 | major | plan §7.5, §12 | Three link strategies are justified by FR-023/SC-008 | **Owner decision** — reviewer argues the probe needs nothing built, so running it first means exactly one strategy gets written. Raised for sign-off |
| 4 | major | plan §7.5; FR-021 | The `article` fallback is "the same thing via config" | **Owner decision** — a link card is a different post format, not a config swap. Raised for sign-off |
| 5 | major | quickstart §B | The probe settles the permission question | **Fixed** — step 1 had no success guard; a failed create yielded an empty URN and a meaningless 404 that the reading table misread as a pass. `set -euo pipefail` + explicit 201 assertion + a row for "never ran" |
| 6 | major | plan Constraints, §7.3; FR-018 | "LinkedIn commentary limit 3000 characters" | **Fixed** — uncited recall, not vendor-documented. Now a tunable guard; counting by codepoint, not UTF-16 unit; dry-run prints escaped and unescaped counts. Recorded in research §10 |
| 7 | major | plan §7.7; SC-007 | Expiry is surfaced 30 days ahead | **Fixed, and the claim was wrong** — independently re-verified: a public repo's scheduled workflows are disabled after 60 days of inactivity, and the fallback token has no readable expiry. Check now also runs inline on every syndication run; bootstrap records a mint date as a repo variable |
| 8 | major | plan §3; FR-018 | Kebab-case enforced at syndication pre-flight | **Fixed** — moved to build time via an npm `prebuild` lint; the old placement could wedge a long-published post between "cannot syndicate" and "cannot rename" |
| 9 | major | plan §11 Phase 2 | The image test settles research open question 3 | **Fixed** — the fixture would have defaulted to `draft: true`, so a production build emits no image regardless of the answer; the test would have failed for the wrong reason. Fixture pinned to `draft: false` |
| 10 | minor | plan §11 Phase 4 | Two test rows guard what they name | **Fixed** — `escapeLittle` is not idempotent (the backslash is itself reserved), so that row is now a literal expected string; added the write-back **insert** branch, which is the path every first syndication takes and was untested |

Reviewer explicitly confirmed sound: the Phase 1 draft-exclusion test is
non-vacuous, and the concurrency analysis holds — but noted that its safety
rests entirely on `checkout` using `ref: main`, which the plan did not explain.
Now commented in the YAML as load-bearing.

### Claims the reviewer could not verify

Recorded rather than dropped:

- Whether `w_member_social` can create comments — the documentation conflict is
  confirmed real; undecidable from docs. The probe stands.
- Whether the length limit is 3000, and whether it counts escaped or unescaped
  text — no vendor doc states any number (research §10).
- Whether `content.article` requires a thumbnail. If it does, the `article`
  fallback also needs the Images API upload flow, and its "config change only"
  claim is false. Carried as research open question 4, to be settled only if
  the probe returns 403.
- Whether LinkedIn actually down-ranks posts containing links. This is the
  premise the whole distinctive design rests on; it is not vendor-documented
  and no authoritative source was found. **Locked by the owner and not
  relitigated** — named only so that "checked and unverifiable" does not read
  as "never checked".

### Owner decision required before Phase 4

Findings 3 and 4 are not defects; they are questions only the owner can answer.
They are carried into the sign-off questions below rather than resolved here.

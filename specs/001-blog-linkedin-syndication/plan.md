# Implementation Plan: Obsidian-authored blog with automated LinkedIn syndication

**Branch**: `001-blog-linkedin-syndication` | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-blog-linkedin-syndication/spec.md`

## Summary

One directory that is simultaneously an Astro site and an Obsidian vault.
Static build to Cloudflare Pages on push. Comments via Giscus on this repo's
Discussions. A GitHub Action syndicates opted-in posts to LinkedIn as
plain-text posts with no link in the body, attaches the canonical URL by a
configurable strategy, and records the returned identifier in the post's own
frontmatter as the sole idempotency ledger.

Technical approach is settled by `research.md`: Astro 7 content collections
with a `glob` loader, LinkedIn versioned REST at `202608`, `little`-format
escaping applied by the job, and one seam each in front of the two unresolved
external questions (comment permission, refresh-token availability) so either
answer costs configuration rather than a rewrite.

## Technical Context

**Language/Version**: TypeScript for the site; plain ESM JavaScript (Node 24)
for the syndication scripts — no build step for anything the Action runs.

**Primary Dependencies**: `astro` 7.2.x, `@astrojs/rss`, `@astrojs/sitemap`,
`yaml` (dev). `yaml` is the sole added dependency and it buys one thing:
`linkedinText` is a multi-line YAML block scalar, and hand-rolled block-scalar
parsing is the flimsier algorithm. Writing back is done without it (§7.4).

**Storage**: None. The `linkedinUrn` frontmatter field is the only state, and
it lives in the artifact it describes. No database, no cache, no external
ledger.

**Testing**: `node:assert` in `scripts/test-syndicate.mjs` via `npm test`; a
no-network `scripts/dry-run.mjs`; build-output assertions for draft exclusion.
No test framework.

**Target Platform**: Static site on Cloudflare Pages; scripts on
`ubuntu-latest` GitHub Actions runners and on the author's macOS machine.

**Project Type**: Static site plus a small automation script set. Single
project, no frontend/backend split.

**Performance Goals**: Not a driver. One author, a handful of posts a month.
The only timing constraint is FR-024's bounded wait for deploy (5 min cap).

**Constraints**: Public repository — no secrets, ever. LinkedIn commentary
limit **3000 characters — a composer-UI figure, NOT vendor-documented for the
API** (`research.md` §10); treated as a configurable pre-flight guard, never as
a truth. Content is never truncated. LinkedIn API version pinned and sunsetting
annually. Refresh credential expires at 365 days, access token at 60.

**Scale/Scope**: Single author, tens of posts, one syndication target.

## Constitution Check

*GATE: evaluated against `.specify/memory/constitution.md` v1.0.0.*

| Principle | Status | Evidence |
|---|---|---|
| I. Vault and site are one directory | PASS | Posts build from `src/content/posts/` in place; no export step. Attachments live beside notes and go through the asset pipeline. |
| II. One-way and write-once | PASS | Nothing is read back from LinkedIn. `linkedinUrn` gates selection (§7.3); clearing it is the only re-publish path. |
| III. Fail loudly, publish nothing on doubt | PASS | All validation precedes the first network call (§7.3); no truncation; §10 enumerates every failure with its behaviour, including the one unrecoverable case that stops for a human. |
| IV. No secret in the repo | PASS | Secrets only as Actions secrets; `.env` ignored; bootstrap prints `gh secret set` commands rather than writing files (§9). |
| V. Smallest thing that works | PASS | One dependency, justified above. No abstraction without a second caller — the strategy map (§7.5) has three real implementations, not a speculative interface. |

**Re-check after design**: no violations. Complexity Tracking is empty.

One thing worth naming rather than hiding: the `article` and `inline` link
strategies (§7.5) are built before either is known to be needed, which brushes
against Principle V. They are not speculation — FR-023 and SC-008 require the
fallback to be a config change, and `research.md` §2 shows a live probability
the default is unavailable. That requirement is what justifies them.

## Project Structure

### Documentation (this feature)

```text
specs/001-blog-linkedin-syndication/
├── plan.md              # This file
├── spec.md              # WHAT and WHY, + Adversarial Review verdict
├── research.md          # Phase 0 — vendor findings with sources
├── quickstart.md        # OAuth bootstrap + the permission probe
└── tasks.md             # /speckit-tasks output — not yet created
```

`data-model.md` and `contracts/` are deliberately not separate files. The data
model is one frontmatter schema (§3) and the contracts are four HTTP calls
(§7.4, §7.5); splitting them across four documents for a personal blog is
bureaucracy, not clarity.

### Source Code (repository root)

```text
.github/workflows/
├── syndicate.yml              # push:main, paths src/content/posts/**
└── li-token-health.yml        # weekly; opens an issue on expiry/failure

.obsidian/                     # committed EXCEPT workspace.json
├── app.json                   # markdown links, excluded files, attachments
├── appearance.json
└── core-plugins.json

scripts/
├── lib/
│   ├── posts.mjs              # frontmatter read/write, slug, validation
│   └── linkedin.mjs           # token, createPost, link strategies
├── syndicate.mjs              # what the Action runs
├── dry-run.mjs                # same logic, zero network, prints payloads
├── oauth-bootstrap.mjs        # one-shot local OAuth, prints secret commands
└── test-syndicate.mjs         # assert-based self-check, `npm test`

src/
├── content.config.ts
├── content/posts/
│   ├── hello-world.md
│   └── attachments/           # Obsidian pastes images here
├── components/
│   ├── Giscus.astro
│   └── PostCard.astro
├── layouts/
│   ├── BaseLayout.astro
│   └── PostLayout.astro
├── pages/
│   ├── index.astro
│   ├── posts/[...slug].astro
│   ├── tags/[tag].astro
│   ├── rss.xml.js
│   └── 404.astro
└── styles/global.css

public/                        # favicon, robots.txt
astro.config.mjs
site.config.mjs                # SITE_URL — single source, imported by both
package.json
tsconfig.json
.gitignore
```

**Structure Decision**: Single project, Astro's conventional layout, plus a
flat `scripts/` directory for automation. Two deliberate choices:

- **`site.config.mjs`** exists so the canonical URL has exactly one definition.
  `astro.config.mjs` imports it for `site:`; `scripts/lib/posts.mjs` imports it
  to build the URL that goes to LinkedIn. A drifted URL here means a published
  LinkedIn post pointing at a 404, so it is not typed twice.
- **Attachments inside `src/content/posts/`**, not `public/`, so Astro's asset
  pipeline processes them (FR-006) instead of shipping originals.

`.gitignore`: `node_modules/`, `dist/`, `.astro/`, `.obsidian/workspace.json`,
`.env`, `.env.*`, `.DS_Store`.

---

## 3. Content collection (FR-002, FR-003, FR-007)

`src/content.config.ts` — Astro 7 API per `research.md` §6:

```ts
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updated: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(true),
    linkedin: z.boolean().default(false),
    linkedinText: z.string().optional(),
    linkedinUrn: z.string().optional(),
  }),
});

export const collections = { posts };
```

Deliberately **shape-only**. The cross-field rule (`linkedin && !draft` ⇒
`linkedinText` present and within limit) is *not* a `superRefine` here: the
Action cannot import `astro:content`, so a schema-side rule would have to be
restated in a second place and would drift. One rule, one home —
`validatePost()` in `scripts/lib/posts.mjs`, called by the Action, the dry-run,
and the test. The local gate is `npm run dry-run` before pushing.

**Draft exclusion** (FR-003, FR-004), applied in the index, tag pages, RSS,
sitemap, and `getStaticPaths`:

```ts
const published = (await getCollection('posts'))
  .filter(p => import.meta.env.PROD ? !p.data.draft : true);
```

**Slug** = filename minus `.md`, kebab-case — see `research.md` §6 for why this
is a constraint rather than a slugifier reimplementation.

**Enforced at build, not at syndication** (FR-018). Checking it only in the
syndication pre-flight creates a wedge, raised at the adversarial gate: a note
named `My First Post.md` with `linkedin: false` builds and deploys happily for
months; the day the author flips `linkedin: true` the run fails on a filename
whose URL has been live and linked all along — and the documented remedy,
renaming, is exactly what the Assumptions forbid for a published post. So the
check runs on the first build instead, via an npm `prebuild` hook:

```json
"prebuild": "node scripts/lint-posts.mjs"
```

npm runs `prebuild` automatically before `build`, locally and on Cloudflare, so
a bad filename fails the very first `npm run build` — before any URL exists to
be immutable. No Astro integration code; the lint reuses the same
`validatePost()` filename rule the Action uses.

## 4. Astro and Cloudflare config

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { SITE_URL } from './site.config.mjs';

export default defineConfig({
  site: SITE_URL,
  output: 'static',
  integrations: [sitemap()],
  markdown: { shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } } },
});
```

No adapter — a fully static site needs none (`research.md` §7).

Cloudflare Pages project: framework preset Astro, build `npm run build`, output
`dist`, production branch `main`, `NODE_VERSION=24`. Build-on-push via the
Pages Git integration.

## 5. Giscus (FR-011 – FR-013)

Preconditions on this repo: public, [giscus app](https://github.com/apps/giscus)
installed, Discussions enabled, and a category **`Comments`** of type
**Announcement** — so only maintainers can open threads and giscus creates them
(FR-013).

`src/components/Giscus.astro`, rendered in `PostLayout.astro` below the article:

```astro
<script src="https://giscus.app/client.js"
  data-repo="japacheco/obsidian-blog"
  data-repo-id="…"
  data-category="Comments"
  data-category-id="…"
  data-mapping="pathname"
  data-strict="1"
  data-reactions-enabled="1"
  data-emit-metadata="0"
  data-input-position="top"
  data-theme="preferred_color_scheme"
  data-lang="en"
  crossorigin="anonymous"
  async></script>
```

`pathname` + `strict` keys the thread to `/posts/<slug>/`; renaming a published
post orphans its thread, which is why published slugs are immutable
(spec Assumptions).

## 6. Obsidian configuration (FR-008 – FR-010)

`.obsidian/app.json`, committed:

```json
{
  "useMarkdownLinks": true,
  "newLinkFormat": "relative",
  "attachmentFolderPath": "./attachments",
  "userIgnoreFilters": ["node_modules/", "dist/", ".astro/", ".github/", "scripts/"],
  "alwaysUpdateLinks": true
}
```

`useMarkdownLinks` + `newLinkFormat` are the pair that guarantees
`![](attachments/x.png)` and never `![[x.png]]` (FR-009). `userIgnoreFilters`
is the "Excluded files" setting (FR-010). `attachmentFolderPath: "./attachments"`
puts pastes in `src/content/posts/attachments/`. `alwaysUpdateLinks` so a
rename does not break an image path.

`.obsidian/workspace.json` is gitignored — it churns on every pane move
(FR-008). Everything else in `.obsidian/` is committed.

Open verification, cheap: whether Astro resolves a bare `attachments/x.png` or
requires `./attachments/x.png`. Tested in Phase 2 (§11); the fallback is a
four-line remark plugin normalising the prefix (`research.md` open question 3).

## 7. Syndication

### 7.1 Workflow shape (FR-014, FR-028)

```yaml
name: syndicate
on:
  push:
    branches: [main]
    paths: ['src/content/posts/**']
  workflow_dispatch:
concurrency:
  group: syndicate          # serialize; never two runs writing the ledger
  cancel-in-progress: false
permissions:
  contents: write           # commit the ledger back
  issues: write             # surface an unrecoverable identifier
jobs:
  syndicate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        # ref: main is load-bearing, not tidiness. A queued run that wins the
        # concurrency group must see the TIP, so it picks up posts from the
        # push whose run was superseded, and so a re-run of an old run cannot
        # check out a pre-ledger SHA and republish. Do not "simplify" this away.
        with: { ref: main, fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci
      - run: node scripts/syndicate.mjs
        env:
          LI_CLIENT_ID:     ${{ secrets.LI_CLIENT_ID }}
          LI_CLIENT_SECRET: ${{ secrets.LI_CLIENT_SECRET }}
          LI_REFRESH_TOKEN: ${{ secrets.LI_REFRESH_TOKEN }}
          LI_ACCESS_TOKEN:  ${{ secrets.LI_ACCESS_TOKEN }}
          LI_MEMBER_URN:    ${{ secrets.LI_MEMBER_URN }}
          LI_LINK_STRATEGY: ${{ vars.LI_LINK_STRATEGY || 'comment' }}
          GH_TOKEN:         ${{ secrets.GITHUB_TOKEN }}
```

`concurrency` is load-bearing: two pushes seconds apart could otherwise both
read an empty ledger and double-post (SC-003).

### 7.2 Token acquisition — the seam for `research.md` §3 (FR-033)

```js
export async function getAccessToken(env) {
  if (env.LI_REFRESH_TOKEN) return refreshExchange(env);   // preferred
  if (env.LI_ACCESS_TOKEN)  return env.LI_ACCESS_TOKEN;    // 60-day fallback
  throw new Error('No LI_REFRESH_TOKEN or LI_ACCESS_TOKEN set');
}
```

If LinkedIn never issues a refresh token, the author sets `LI_ACCESS_TOKEN`
instead and re-mints every 60 days, nagged by §7.7. No other code moves.

### 7.3 Selection and validation (FR-015 – FR-019)

```
select iff  draft == false  &&  linkedin == true  &&  !linkedinUrn
```

Then, before **any** network call, `validatePost()` over every selected post —
first violation aborts the whole run, publishing nothing:

| Check | Failure message |
|---|---|
| filename `^[a-z0-9-]+\.md$` | `slug must be kebab-case` |
| `linkedinText` present, non-blank | `linkedin: true but linkedinText is empty` |
| length ≤ `LI_MAX_CHARS` (default 3000) | `linkedinText is N chars, limit 3000` |
| no `http://` / `https://` in `linkedinText` | `linkedinText must not contain a URL` |

Never truncate (FR-019). The URL row turns the no-link-in-body decision into a
gate rather than a discipline (FR-021).

**Counting, corrected at the adversarial gate.** Length is
`[...text].length` — codepoints — not `text.length`, which counts UTF-16 units
and would report a teaser with 60 non-BMP emoji as 60 characters over and
reject it pre-flight. The limit itself is unverified (`research.md` §10), so it
is a tunable constant rather than a law, and the API's `FIELD_LENGTH_TOO_LONG`
remains the real backstop. Measured on the **unescaped** text, since backslashes
are markup rather than content; if LinkedIn counts the escaped string a
reserved-char-dense teaser can pass pre-flight and still 400 at the POST. That
is a loud, correct failure — but the author cannot compute a safe length in
advance, so the dry-run prints **both** counts, unescaped and escaped.

### 7.4 Publish sequence — reserve, then confirm (FR-024 – FR-027)

**This ordering is the fix for the blocker raised at the adversarial gate**
(spec.md → Adversarial Review, finding 1). The naive order — create the post,
then record it — has a window in which the post is live and the ledger is
still empty, and any later push re-selects it and publishes a duplicate. The
ledger is therefore *reserved before the irreversible act* and confirmed after.

Per selected post, in this order:

1. **`waitForLive(canonicalUrl)`** — HEAD until 200, 15s apart, 5 min cap; fail
   on timeout. Rationale in `research.md` §9: the deploy and this job race, and
   the LinkedIn post is the half that cannot be cheaply undone. Reserving
   happens *after* this, so a deploy timeout leaves no reservation behind.

2. **Reserve the ledger.** Write `linkedinUrn: "pending:<run_id>"`, commit,
   push — before any call that can create a post.

   ```
   git commit -m "[skip ci] chore: reserve LinkedIn slot for <slug>"
   git push   # on rejection: pull --rebase, retry, 3 attempts
   ```

   If this push fails, the run fails having published **nothing**. That is the
   whole point: the failure mode the plan already expected becomes harmless.

3. **Create the post.**

   ```
   POST https://api.linkedin.com/rest/posts
   Authorization: Bearer <token>
   LinkedIn-Version: 202608
   X-Restli-Protocol-Version: 2.0.0
   Content-Type: application/json

   { "author": "<LI_MEMBER_URN>",
     "commentary": escapeLittle(linkedinText),
     "visibility": "PUBLIC",
     "distribution": { "feedDistribution": "MAIN_FEED",
                       "targetEntities": [],
                       "thirdPartyDistributionChannels": [] },
     "lifecycleState": "PUBLISHED",
     "isReshareDisabledByAuthor": false }
   ```

   Expect `201`; read the URN from the **`x-restli-id`** header. Anything else
   throws with status and body.

4. **Confirm the ledger.** Overwrite `pending:<run_id>` with the real URN,
   commit, push.

   ```
   git commit -m "[skip ci] chore: record LinkedIn URN for <slug>"
   git push   # on rejection: pull --rebase, retry, 3 attempts
   ```

   If *this* push fails, the reservation from step 2 is already on `main`, so
   the post is not re-selected and no duplicate is possible. The run opens an
   issue carrying slug and URN and fails (FR-030) — a recoverable
   record-keeping gap, not a duplicate publication.

   Both write-backs are **targeted line edits** (FR-026): replace the
   `linkedinUrn:` line, or insert one before the closing `---`. A YAML
   round-trip would reformat frontmatter the author hand-writes in Obsidian.

   **The `[skip ci]` marker is a PREFIX, not a suffix.** Cloudflare Pages only
   honours it at the start of the message (`research.md` §7); a trailing marker
   rebuilds the site on every ledger commit. GitHub Actions accepts it
   anywhere, so a prefix satisfies both (FR-027).

5. **Attach the link** via the configured strategy (§7.5).

6. **Link failure after step 3** ⇒ fail with
   `post <urn> is live; link attach failed: <status> <body>`. A re-run will not
   repost, because the ledger is non-empty (FR-016).

**Meaning of `pending:` on selection.** A post whose ledger reads
`pending:<run_id>` is **not** selected — non-empty means claimed. It signals
"a run claimed this and its outcome is unknown", so the run that finds one
opens an issue naming the slug and run, and stops for a human (constitution
Principle III). Resolution is manual and deterministic: look at the LinkedIn
profile once; if the post exists, paste its URN in; if it does not, clear the
field.

`ponytail:` a definite non-creating failure (401/403/429) could auto-clear the
reservation in the same run, since nothing was published. Not built — a 403
means the app is misconfigured and *every* post fails, so the author is
already in the issue tracker. Add the auto-clear branch if a transient 429
ever actually strands a post.

### 7.5 Link strategies — the seam for `research.md` §2 (FR-022, FR-023)

One map in `scripts/lib/linkedin.mjs`; selection by `vars.LI_LINK_STRATEGY`,
default `comment`. Switching is one `gh variable set`, no deploy.

**`comment`** (default, pending the probe):

```
POST https://api.linkedin.com/rest/socialActions/{encodeURIComponent(urn)}/comments
{ "actor": "<LI_MEMBER_URN>",
  "object": "<urn>",
  "message": { "text": "<canonicalUrl>\n\nI don't read LinkedIn — replies and comments live over there." } }
```

- Path URN URL-encoded, colons included, via `encodeURIComponent` — not a
  hand-rolled replace.
- **URN-form fallback**: on `400`/`404`, retry once with both path and `object`
  rewritten to `urn:li:activity:{id}`, reusing the numeric id
  (`research.md` §5).
- `message.text` is **plain**, not `little`-escaped (`research.md` §1). Comments
  cap far below a post; ours is a URL plus one line.
- `429` ⇒ 60s backoff, one retry, then fail.

**`article`** — the zero-extra-permission fallback. One call, no comment: the
post carries `content.article` with `source: canonicalUrl` plus explicit
`title` and `description` from frontmatter (the Posts API does no URL scraping,
so they are set by hand). LinkedIn renders a link card; the body text is
unchanged and still carries no URL, so FR-021 holds.

**`inline`** — appends `\n\n<url>` to the commentary. Violates the
no-URL-in-body rule, so it is not a default; it exists so the ladder has a rung
that cannot fail.

### 7.6 Idempotency (FR-016)

`linkedinUrn` is the entire ledger. Empty means never posted.

- Editing a syndicated post: the push re-triggers the workflow, the post fails
  the `!linkedinUrn` filter, nothing happens. LinkedIn is a snapshot at publish
  time and never catches up.
- Deliberate re-post: clear `linkedinUrn`, push. The only lever, manual, as
  designed.
- The write-back commit triggers neither the workflow nor a Pages build.

### 7.7 Token health (FR-031)

Weekly cron plus `workflow_dispatch`. Simpler than storing an issue date,
because the refresh exchange **returns `refresh_token_expires_in`**
(`research.md` §3):

1. Attempt the refresh exchange.
2. Exchange fails ⇒ open issue `LinkedIn token: refresh failed` with the error.
3. `refresh_token_expires_in < 30 days` ⇒ open issue
   `LinkedIn token: re-auth needed by <date>` with the bootstrap command.
4. Fallback mode (`LI_ACCESS_TOKEN` only): a bare access token carries no
   expiry and LinkedIn publishes no introspection endpoint, so there is nothing
   to read. The bootstrap therefore records the mint date as repository
   **variable** `LI_TOKEN_MINTED` (a date, not a secret) and the check does the
   arithmetic against 60 days. Without this the fallback branch — the one
   `research.md` §3 says is likelier — would have no expiry warning at all.
5. Dedupe by title against `gh issue list --state open` before opening.

**The cron alone is not sufficient.** Verified: *"In a public repository,
scheduled workflows are automatically disabled when no repository activity has
occurred in 60 days."* This repo is public and single-author, so a two-month
writing break disables the nag — in fallback mode, on roughly the day the token
dies. Mitigation, no extra machinery: `syndicate.mjs` runs the same health check
at the end of every syndication run. Publishing is itself repository activity,
so the two failure modes are disjoint — if the cron is disabled you are not
publishing, and the moment you publish again the check runs inline.

## 10. Failure modes (FR-029)

Everything below fails loudly: non-zero exit, upstream status and body in the
log, nothing swallowed. This job is not glue that should fail open.

| # | Failure | Detection | Behaviour |
|---|---|---|---|
| 1 | `linkedinText` empty, `linkedin: true` | pre-flight | job fails, **nothing posted** |
| 2 | `linkedinText` > 3000 | pre-flight | fails with actual count; never truncated |
| 3 | URL inside `linkedinText` | pre-flight | fails |
| 4 | Non-kebab-case filename | pre-flight | fails |
| 5 | Refresh exchange 400 | token step | fails; §7.7 files the issue |
| 6 | Site not deployed yet | `waitForLive` | wait ≤5 min, then fail — before posting |
| 7 | **Reservation push rejected** (§7.4 step 2) | git exit | rebase+retry ×3, then fail — **nothing published**, safe to re-run |
| 8 | `POST /rest/posts` non-201 | status check | fails; ledger left at `pending:` and an issue opened |
| 9 | Post created, `x-restli-id` absent | header check | fails and opens an issue — a post exists whose id cannot be recovered without a restricted scope; the reservation already blocks a duplicate, so this is a record-keeping gap, not a re-publish risk |
| 10 | Confirmation push rejected (§7.4 step 4) | git exit | rebase+retry ×3, then open an issue carrying the URN; reservation still blocks a duplicate |
| 11 | Runner killed between reserve and confirm | — | reservation is on `main`; post is not re-selected; issue filed by the next run that sees `pending:` |
| 12 | Ledger reads `pending:` on a later run | selection | not selected; issue opened naming slug and run id; stops for a human |
| 13 | Comment 403 | strategy | fails, with the `quickstart.md` remedy in the message |
| 14 | Comment 400/404 | strategy | auto-retry with `urn:li:activity:` form |
| 15 | Comment 429 | strategy | 60s backoff, one retry, then fail |
| 16 | Link attach fails after post created | strategy | fails; re-run will **not** repost |
| 17 | LinkedIn version sunset | 426/400 | fails; bump the one constant |
| 18 | Two pushes racing | — | `concurrency` serialises; second run sees the reservation |
| 19 | Scheduled health check silently disabled | 60 days of repo inactivity, public repo | see §7.7 — the syndicate workflow re-checks on every run, so the nag does not depend on cron alone |

Rows 9 and 12 are the residual sharp edges: both stop for a human rather than
guess, and neither can produce a duplicate. That is the trade the reserve-first
ordering buys — an unrecoverable duplicate is converted into a recoverable
missed record.

## 11. Test plan

House rule: verify by exercising behaviour, not by typechecking. One runnable
check per piece of non-trivial logic.

### Phase 1 — site

- `npx astro check && npm run build` clean.
- Fixtures committed: one published, one `draft: true`, one with an image, one
  with reserved characters in `linkedinText` (`(parens)`, `_under_`, `#h`,
  `C:\path`).
- **Draft exclusion, asserted not eyeballed**: grep `dist/` for the draft's
  slug, and **also assert the published fixture IS present** — so the check
  cannot pass vacuously by matching nothing (constitution, Quality Gates).
- `dist/rss.xml` parses, contains the published post, not the draft.
- `[...slug]` and 404 render.

### Phase 2 — Obsidian

- Open the repo as a vault; paste an image. Assert the emitted markdown is
  `![](attachments/…)`, literal, no `[[…]]`.
- Build after that paste; confirm the image is emitted to `dist/_astro/`. **This
  is the test for `research.md` open question 3**; the remark-plugin fallback
  lands here if it fails.
  **The fixture MUST set `draft: false`.** Caught at the adversarial gate: a
  freshly pasted note is a draft by default, so a production build excludes its
  page and emits no image *whatever the answer to the open question is* — the
  test would report failure for the wrong reason and send us to write a remark
  plugin that was never needed. Assert the image lands in `dist/_astro/` from a
  published fixture, so a pass means path resolution actually works.
- Quick switcher shows no `node_modules` path.
- Move panes, close Obsidian, `git status` shows no tracked change.

### Phase 3 — Giscus

- Build, serve `dist/`, open a post: the widget renders (a wrong `data-repo-id`
  fails visibly here, which is the point of doing it on the built output).
- Post one comment; confirm a Discussion appears under `Comments` keyed to the
  pathname. Delete it after.
- Toggle OS dark mode; the widget follows.

### Phase 4 — syndication

`scripts/test-syndicate.mjs`, plain `node:assert`, no framework, `npm test`:

| Assertion | Guards |
|---|---|
| `escapeLittle` escapes all 15 reserved chars | `research.md` §1 |
| `escapeLittle('C:\\path (see note)')` === `'C:\\\\path \\(see note\\)'` — a **literal expected string**, not an idempotence claim | §1 |
| empty `linkedinText` fixture ⇒ throws | FM #1 |
| over-limit fixture ⇒ throws, count in message | FM #2 |
| exactly at the limit ⇒ passes | off-by-one |
| a 3000-codepoint string of non-BMP emoji ⇒ passes | codepoint counting, §7.3 |
| URL in body ⇒ throws | FM #3 |
| fixture with `linkedinUrn` set ⇒ **not selected** | FR-016 |
| fixture with `linkedinUrn: "pending:123"` ⇒ **not selected**, issue path taken | §7.4, FM #12 |
| `draft: true, linkedin: true` ⇒ not selected | FR-015 |
| `encodeUrn('urn:li:share:1')` === `urn%3Ali%3Ashare%3A1` | §7.5 |
| `toActivityUrn('urn:li:share:1')` === `urn:li:activity:1` | FM #14 |
| write-back **insert** branch: `linkedinUrn` absent ⇒ line inserted before closing `---`, every other line byte-identical | FR-026 — the path every first syndication takes |
| write-back **replace** branch: `pending:` overwritten with the real URN, every other line byte-identical | FR-026, §7.4 step 4 |
| commit messages begin with `[skip ci]` | FR-027, prefix requirement |
| the selection fixture set contains ≥1 selected AND ≥1 rejected | **non-vacuity** |

Row 2 was corrected at the adversarial gate: `escapeLittle` is *not* idempotent
by construction, because the backslash is itself in the reserved set — so an
"already-escaped input is safe" assertion would either encode a wrong
implementation or assert nothing. Pinning a literal expected string instead.

`scripts/dry-run.mjs` reads real posts, runs the full pipeline with the network
stubbed, prints the exact JSON bodies and URLs that *would* be sent, and exits
non-zero on any validation failure (FR-034).

**Live verification, in order, one post:**

1. `npm run dry-run` on a real post — inspect the escaped commentary by eye.
2. The `quickstart.md` probe — settles `research.md` §2, sets `LI_LINK_STRATEGY`.
3. `workflow_dispatch` against one real post with `linkedin: true`.
4. Confirm: post visible, URL attached, ledger written back, no Pages rebuild
   from the write-back commit.
5. Push an edit to that post; confirm nothing is published (SC-003).
6. Clear the ledger, push; confirm it republishes — the manual lever proven in
   both directions.

Steps 3–6 need the author's LinkedIn account and are theirs to run.

## 12. Build order and definition of done

| Phase | Scope | Done when |
|---|---|---|
| 1 | Astro site, collection, layouts, RSS, sitemap, fixtures | §11 Phase 1 green, deployed to Pages |
| 2 | Obsidian config, gitignore, image round-trip | §11 Phase 2 green |
| 3 | Giscus | §11 Phase 3 green, one real comment posted and deleted |
| 4 | `syndicate.yml`, `li-token-health.yml`, scripts, tests | **NOT done** until the `quickstart.md` probe has run and `LI_LINK_STRATEGY` is set |

Phase 4 ships with `LI_LINK_STRATEGY` defaulting to `comment` and `article`
implemented but unexercised, per the owner's instruction that Phase 4 stays
open until the permission question is answered.

## Complexity Tracking

No Constitution Check violations. Table intentionally empty.

# Implementation Plan: Obsidian-authored blog with assisted LinkedIn syndication

**Branch**: `001-blog-linkedin-syndication` | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

**Revision**: 2b — LinkedIn API integration removed (rev 2), then two blockers
from the rev 2 adversarial gate fixed (rev 2b). Revision 1's design is preserved
in git history at `3617c1e`. Sections are numbered sequentially as of 2b; rev 2
inherited gaps from rev 1's numbering.

## Summary

One directory that is simultaneously an Astro site and an Obsidian vault.
Static build to Cloudflare Pages on push. Comments via Giscus on this repo's
Discussions. On publish, a GitHub Action builds the site, confirms the post's
page actually exists in the build output, and opens an issue containing
paste-ready LinkedIn text; the author pastes it when convenient.

The design principle for the syndication half: **make the side effect
reversible and every hard problem disappears.** Revision 1 had to engineer
against an un-publishable public post. Revision 2's side effect is an issue in
the author's own repo.

**The correction in 2b**: "the side effect is reversible" is only true up to
the point the author pastes. A spurious issue becomes a spurious *public post*
by the author's own hand, because the routine is deliberately
don't-think-about-it. So the machinery that prevents spurious issues has to be
as careful as revision 1's was — just far simpler, because the failure is
caught before a human acts rather than after a platform does.

## Technical Context

**Language/Version**: TypeScript for the site; plain ESM JavaScript (Node 24)
for the scripts.

**Primary Dependencies**: `astro` 7.2.x, `@astrojs/rss`, `@astrojs/sitemap`,
`yaml` (dev). `yaml` is the sole added dependency: `linkedinText` is a
multi-line YAML block scalar read by scripts that run outside Astro, and
hand-rolled block-scalar parsing is the flimsier algorithm.

**Storage**: None. GitHub issues are the only state.

**Testing**: `node:assert` in `scripts/test-posts.mjs` via `npm test`;
build-output assertions for draft exclusion and slug agreement.

**Target Platform**: Static site on Cloudflare Pages; scripts on
`ubuntu-latest` runners and the author's macOS machine.

**Project Type**: Static site plus four small scripts. Single project.

**Constraints**: Public repository — no secrets, ever. The teaser length guard
defaults to 3000 characters, which is **LinkedIn's composer-UI figure and not
vendor-documented**; a wrong value costs a rejected paste, not a failed
publication.

**Scale/Scope**: Single author, tens of posts.

## Constitution Check

*GATE: evaluated against `.specify/memory/constitution.md` v1.1.0.*

| Principle | Status | Evidence |
|---|---|---|
| I. Vault and site are one directory | PASS | Posts build from `src/content/posts/` in place; attachments beside notes |
| II. One-way and write-once | PASS **as of 2b** | Amended Principle II says "offered for syndication at most once". Rev 2 accepted a concurrent-run race that violated this; 2b adds a `concurrency` group (§5.1). Dedupe no longer depends on a mutable label (§5.3) |
| III. Fail loudly, publish nothing on doubt | PASS **as of 2b** | Amended Principle III requires validation "before the first network call". Rev 2 asserted this while its workflow never ran the lint; 2b runs the full build first and aborts on failure (§5.1, §5.2) |
| IV. No secret in the repo | PASS | No credentials at all. Only `GITHUB_TOKEN`, scoped `issues: write` / `contents: read` |
| V. Smallest thing that works | PASS | One dependency; four scripts; no abstraction with a single caller |

Both II and III were **asserted** passes in revision 2 and were false. They are
measured passes now, and the tests that measure them are named in §7. The
constitution amendment to v1.1.0 is already applied — revision 2's plan owed a
task that had in fact been paid, which is itself the kind of stale record the
constitution warns about.

**Re-check after design**: no violations. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-blog-linkedin-syndication/
├── plan.md              # This file
├── spec.md              # WHAT and WHY, revision history, Adversarial Review
├── research.md          # Phase 0 findings; LinkedIn API sections historical
├── quickstart.md        # Setup, and the paste routine
└── tasks.md             # /speckit-tasks output — not yet created
```

### Source Code (repository root)

```text
.github/workflows/
└── syndicate-issue.yml        # push:main → build, verify, open paste-ready issues

.obsidian/                     # committed EXCEPT workspace.json
├── app.json
├── appearance.json
└── core-plugins.json

scripts/
├── posts.mjs                  # shared: read, validate, slug, canonical URL, render
├── lint-posts.mjs             # CLI, runs as npm `prebuild`
├── syndicate-issue.mjs        # CLI, runs in CI after the build
└── test-posts.mjs             # assert-based self-check, `npm test`

src/
├── content.config.ts
├── content/posts/
│   ├── hello-world.md
│   └── attachments/           # Obsidian pastes images here
├── components/{Giscus,PostCard}.astro
├── layouts/{BaseLayout,PostLayout}.astro
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
package.json, tsconfig.json, .gitignore
```

**Structure Decision**: Single project, Astro's conventional layout, four flat
scripts with no `lib/` directory for four files.

- **`site.config.mjs`** so the canonical URL has exactly one definition, shared
  by `astro.config.mjs` and the issue renderer.
- **Attachments inside `src/content/posts/`** so Astro's asset pipeline
  processes them.

`.gitignore`: `node_modules/`, `dist/`, `.astro/`, `.obsidian/workspace.json`,
`.env`, `.env.*`, `.DS_Store`.

---

## 1. Content collection and validation

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
    linkedinText: z.string().optional(),
  }),
});

export const collections = { posts };
```

Seven fields. `linkedinUrn` went with the ledger; `linkedin: boolean` went
because presence of a teaser is the opt-in (FR-014), which also removes the
"flag set but text empty" failure mode.

### 1.1 The `draft` default is duplicated, deliberately and carefully

**Raised at the 2b gate, and it is the subtlest thing in this plan.** Astro
applies `z.boolean().default(true)` — a post with **no** `draft` key is a
draft. But `scripts/posts.mjs` reads frontmatter with the `yaml` package, where
no zod default exists and `data.draft` is `undefined`.

A naive `!data.draft` selection check therefore treats an omitted `draft` as
**published**, while Astro treats it as a draft and emits no page. Result: an
issue offering a LinkedIn link to a page that does not exist.

So the script states the default explicitly and identically:

```js
const isPublished = (data) => data.draft === false;   // NOT !data.draft
```

Omission means draft, in both systems, by construction. §7 tests the omitted
case specifically, because the obvious test (`draft: true ⇒ not selected`)
passes under both the correct and the buggy check and therefore proves nothing.

### 1.2 Build-time validation

`scripts/lint-posts.mjs`, wired as an npm lifecycle hook:

```json
"prebuild": "node scripts/lint-posts.mjs"
```

| Check | Message |
|---|---|
| filename `^[a-z0-9-]+\.md$` | `slug must be kebab-case` |
| `linkedinText`, if present, is non-blank | `linkedinText is present but empty` |
| length ≤ `LI_MAX_CHARS` (default 3000) | `linkedinText is N chars, limit 3000` |
| no `http://` / `https://` in `linkedinText` | `linkedinText must not contain a URL — it goes in the comment` |

Length is `[...text].length` — codepoints, not UTF-16 units. Never truncate.

Kebab-case is enforced here rather than at syndication time because the rev 1
gate showed the late placement could wedge a published post between "cannot
syndicate" and "cannot rename".

**`prebuild` is necessary but not sufficient** — see §5.1. It fires on
`npm run build` and not on `npm run dev`, and the documented publishing routine
does not include a local build, so CI must run the build itself rather than
trust that the author did.

### 1.3 Draft exclusion

Applied in the index, tag pages, RSS, sitemap, and `getStaticPaths`:

```ts
const published = (await getCollection('posts'))
  .filter(p => import.meta.env.PROD ? !p.data.draft : true);
```

## 2. Astro and Cloudflare config

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

Cloudflare Pages: preset Astro, build `npm run build`, output `dist`,
production branch `main`, `NODE_VERSION=24`.

Note that the Cloudflare build and the syndication workflow are **independent**
— a failed Cloudflare build leaves the previous deployment live and does not
stop the workflow. That decoupling is what made the 2b blocker possible, and it
is why §5.2 verifies the build itself rather than inferring it succeeded.

## 3. Giscus

Preconditions: repo public, [giscus app](https://github.com/apps/giscus)
installed, Discussions enabled, category **`Comments`** of type
**Announcement** so only maintainers can open threads.

```astro
<script src="https://giscus.app/client.js"
  data-repo="<owner>/<repo>"
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

A repository **rename does not orphan comments** — verified at the 2b gate:
GitHub's GraphQL API follows renames, so both the numeric `repo-id` and a stale
`data-repo` string keep resolving. This is why the repo name is a cheap
decision and the domain is not.

## 4. Obsidian configuration

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

`useMarkdownLinks` + `newLinkFormat` guarantee `![](attachments/x.png)` and
never `![[x.png]]`. `userIgnoreFilters` is the "Excluded files" setting.
`.obsidian/workspace.json` is gitignored.

Open verification: whether Astro resolves a bare `attachments/x.png`. Tested in
§7 Phase 2; fallback is a four-line remark plugin normalising the prefix.

## 5. Syndication assistance

### 5.1 Workflow

```yaml
name: syndicate-issue
on:
  push:
    branches: [main]
    paths: ['src/content/posts/**']
  workflow_dispatch:
concurrency:
  group: syndicate-issue      # SC-003 requires this; see 5.4
  cancel-in-progress: false
permissions:
  contents: read              # READ. Nothing writes to the repo.
  issues: write
jobs:
  prepare:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci
      # Fires `prebuild` -> lint-posts.mjs, then builds. A validation failure
      # or a broken build aborts the job before its first network call.
      # Without this step the workflow offers posts that were never validated
      # and whose pages may not exist. That was the 2b blocker.
      - run: npm run build
      - run: node scripts/syndicate-issue.mjs
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The `concurrency` group was absent in revision 2, which openly accepted a race
that contradicted SC-003 and the amended Principle II. It is safe here
precisely because every run reconstructs desired state (§5.2): a superseded
pending run loses nothing, so `cancel-in-progress: false` merely serialises.

### 5.2 What the script does

Rather than diffing the push, it **reconstructs the whole desired state every
run**:

1. Read every post. Keep those where `data.draft === false` (§1.1) and
   `linkedinText` is non-empty.
2. **Verify the page exists**: assert `dist/posts/<slug>/index.html` is present
   in the build output produced by the previous step. A post that Astro did not
   emit is never offered, whatever the frontmatter says.
3. List existing syndication issues (§5.3) and skip slugs already present.
4. Create an issue for each remaining post.

Step 2 is the 2b fix, and it does double duty: it closes the "issue links to a
404" hole, and it is the only thing that ties the script's idea of a slug to
the path Astro actually emitted. The two could otherwise drift silently, which
`research.md` §6 names as the central risk of the whole slug arrangement.

Self-healing: a missed push, a failed run, or a manually deleted issue all
correct on the next run. Re-running on an old commit is harmless.

### 5.3 Deduplication

**Not keyed on a label.** Revision 2 used
`gh issue list --label syndicate --state all`, which the 2b gate showed is
silently fragile — verified directly:

```
$ gh issue list -R cli/cli --label zzz-does-not-exist --state all --json title
[]
exit=0
```

A stripped, renamed, or never-created label yields an empty set with a success
exit code, so every past post looks un-offered and gets re-offered. Under this
design a spurious issue is a spurious public post, because the author's routine
is to paste what the issue says without re-deciding.

Instead: list issues in **any** state and match on the title prefix in JS.

```js
const LIMIT = 500;
const issues = JSON.parse(sh(`gh issue list --state all --limit ${LIMIT} --json title`));
if (issues.length >= LIMIT) throw new Error(`issue list hit the ${LIMIT} ceiling — dedupe unsafe`);
const offered = new Set(
  issues.map(i => i.title.match(/^Syndicate: ([a-z0-9-]+)$/)?.[1]).filter(Boolean),
);
```

No search syntax, no label dependency, no fuzzy matching. The ceiling guard
throws rather than silently truncating: `gh issue list` returns newest-first,
so an overflow would drop the *oldest* issues — precisely the long-since-pasted
posts — and re-offer them. The label `syndicate` is still applied to new issues,
but only as a human filing convenience; nothing depends on it.

`--state all` means a **closed** issue still suppresses recreation, which is the
common case since closing is how the author marks a post done.

### 5.4 Idempotency

The issue is the ledger, keyed on slug rather than title, so retitling a post
does not orphan its issue.

Residual, and named rather than papered over: **nothing enforces that published
slugs are immutable.** Renaming `foo.md` to `bar.md` after publication produces
a second issue under the new slug, and the author pasting it produces a
duplicate LinkedIn post pointing at a URL whose old form is now dead. The
Assumptions forbid the rename; the machine does not. Accepted for a
single-author blog — the cost of enforcement is tracking every slug ever
published, which is a ledger, which is what revision 2 deleted.

### 5.5 Issue content

Title: `Syndicate: <slug>`. Label `syndicate` (cosmetic).

Body carries two blocks in fenced code so GitHub's copy button yields exactly
the bytes in the repo:

> **1 — paste as the post body**
>
> ```
> <linkedinText, verbatim>
> ```
>
> **2 — paste as the first comment, immediately after posting**
>
> ```
> <canonical URL>
>
> I don't read LinkedIn — replies and comments live over there.
> ```
>
> Close this issue once pasted. [View the post](<canonical URL>)

**Fence sizing.** A teaser containing a line of three backticks closes the
fence early, and the copy button then yields a **truncated** teaser which gets
pasted publicly. So the fence is sized to the content:

```js
const fence = '`'.repeat(Math.max(3, longestBacktickRun(text) + 1));
```

Nothing is escaped, encoded, or transformed. Revision 1's `little`-format
escaper does not exist here — the LinkedIn composer takes literal text.

## 6. Failure modes

| # | Failure | Detection | Behaviour |
|---|---|---|---|
| 1 | Teaser empty, over-length, or contains a URL | `prebuild` lint, locally **and in CI** (§5.1) | build fails; job aborts before any network call |
| 2 | Filename not kebab-case | same | same |
| 3 | Post selected but Astro emitted no page | `dist/` check (§5.2 step 2) | job fails naming the slug; no issue created |
| 4 | Issue list hits the 500 ceiling | explicit guard (§5.3) | job fails; dedupe is never run on a truncated set |
| 5 | `gh issue create` fails | exit code | job fails visibly; no side effect; re-run recreates cleanly |
| 6 | `gh issue list` fails | exit code, checked | job fails; **never** treated as "no issues exist" |
| 7 | Two pushes racing | `concurrency` group | serialised; the second run sees the first's issues |
| 8 | Published post renamed | — | **not prevented** (§5.4); produces a second issue |

Eight rows, up from revision 2's three. Revision 2 claimed the table shrank
because the design shrank; the gate showed four of the missing rows were real.
Row 8 is a known, accepted gap rather than a solved one.

## 7. Test plan

Verify by exercising behaviour, not by typechecking.

### Phase 1 — site

- `npx astro check && npm run build` clean.
- Fixtures: one published, one `draft: true`, **one with `draft` omitted
  entirely**, one with an image, one with a teaser containing awkward
  characters — `(parens)`, `_under_`, `#hash`, `C:\path`, an emoji, **and a
  line of three backticks**.
- **Draft exclusion, asserted not eyeballed**: grep `dist/` for the draft's
  slug, and **also assert the published fixture IS present**, so the check
  cannot pass vacuously.
- `dist/rss.xml` parses, contains the published post, not the draft.

### Phase 2 — Obsidian

- Paste an image; assert the emitted markdown is `![](attachments/…)`.
- Build and confirm the image reaches `dist/_astro/`. **The fixture MUST set
  `draft: false`** — a draft emits no image regardless, so the test would fail
  for the wrong reason.
- Quick switcher shows no `node_modules` path; pane moves leave `git status`
  clean.

### Phase 3 — Giscus

- Build, serve `dist/`, open a post: the widget renders (a wrong `repo-id`
  fails visibly here).
- Post one comment; confirm a Discussion keyed to the pathname. Delete it.
- Toggle OS dark mode; the widget follows.

### Phase 4 — syndication assistance

`scripts/test-posts.mjs`, plain `node:assert`, `npm test`:

| Assertion | Guards |
|---|---|
| **`draft` omitted + teaser ⇒ NOT selected** | §1.1 — fails under `!data.draft`, passes under `=== false`; the `draft: true` row cannot distinguish these |
| `draft: true` + teaser ⇒ not selected | FR-015 |
| `draft: false` + teaser ⇒ selected | FR-015 |
| post with no teaser ⇒ not selected, no error | FR-015 |
| **teaser containing ``` ⇒ fence widens; block round-trips whole** | §5.5, FM — the truncated-paste bug |
| teaser with reserved chars and emoji round-trips byte-identical into the body | FR-020 |
| over-limit teaser ⇒ throws with count | FM #1 |
| teaser at exactly the limit ⇒ passes | off-by-one |
| 3000-codepoint emoji string ⇒ passes | codepoint counting |
| teaser containing a URL ⇒ throws | FM #1 |
| blank teaser ⇒ throws | FM #1 |
| non-kebab filename ⇒ throws | FM #2 |
| slug present in the offered set ⇒ not selected | FR-016 |
| slug present with a **closed** issue ⇒ still not selected | FR-016, common case |
| issue list at the ceiling ⇒ throws | FM #4 |
| title that is not `Syndicate: <slug>` ⇒ ignored, not parsed as a slug | §5.3 |
| canonical URL is `SITE_URL` + slug with exactly one `/` between | URL correctness |
| the selection fixture set contains ≥1 selected AND ≥1 rejected | **non-vacuity** |

**Cross-phase, and the one that ties the halves together**: after `npm run
build`, for every post the script would offer, assert
`dist/posts/<slug>/index.html` exists. This is §5.2 step 2 exercised as a test
rather than only as a runtime guard, and it is the only assertion that catches
slug divergence between Astro and the script.

**Live verification, one post**: publish with a teaser; confirm one issue with
correct content; re-push and confirm no second issue; close it, re-push, and
confirm still no second issue.

## 8. Build order and definition of done

| Phase | Scope | Done when |
|---|---|---|
| 1 | Astro site, collection, layouts, RSS, sitemap, `lint-posts.mjs`, fixtures | §7 Phase 1 green, deployed to Pages |
| 2 | Obsidian config, gitignore, image round-trip | §7 Phase 2 green |
| 3 | Giscus | §7 Phase 3 green, one real comment posted and deleted |
| 4 | `syndicate-issue.yml`, `posts.mjs`, `syndicate-issue.mjs`, tests | §7 Phase 4 green and one real issue produced end to end |

**Blocked on the author**: the site name, which fixes the domain (`SITE_URL`)
and the repository name (`data-repo`). Everything can be built against a
placeholder `SITE_URL` and switched with one line in `site.config.mjs`.

Removed entirely: the LinkedIn app, the Company Page, the OAuth bootstrap, the
permission probe. `scripts/oauth-bootstrap.mjs` deleted; recoverable at
`e30afab`.

## Complexity Tracking

No Constitution Check violations. Table intentionally empty.

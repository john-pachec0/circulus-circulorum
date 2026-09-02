# Implementation Plan: Obsidian-authored blog with assisted LinkedIn syndication

**Branch**: `001-blog-linkedin-syndication` | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

**Revision**: 2 — LinkedIn API integration removed. See spec.md → Revision
History for why. Revision 1's design is preserved in git history at `3617c1e`
if it is ever needed again.

## Summary

One directory that is simultaneously an Astro site and an Obsidian vault.
Static build to Cloudflare Pages on push. Comments via Giscus on this repo's
Discussions. On publish, a GitHub Action opens an issue containing paste-ready
LinkedIn text; the author pastes it when convenient.

The design principle for the syndication half: **make the side effect
reversible and every hard problem disappears.** Revision 1 had to engineer
against an un-publishable public post. Revision 2's side effect is an issue in
the author's own repo, so the failure modes collapse from nineteen to three.

## Technical Context

**Language/Version**: TypeScript for the site; plain ESM JavaScript (Node 24)
for the scripts — no build step for anything CI runs.

**Primary Dependencies**: `astro` 7.2.x, `@astrojs/rss`, `@astrojs/sitemap`,
`yaml` (dev). `yaml` is the sole added dependency, and it buys one thing:
`linkedinText` is a multi-line YAML block scalar, read by scripts that run
outside Astro, and hand-rolled block-scalar parsing is the flimsier algorithm.

**Storage**: None. GitHub issues are the only state, and they are the to-do
list the author already reads. No frontmatter ledger, no database.

**Testing**: `node:assert` in `scripts/test-posts.mjs` via `npm test`;
build-output assertions for draft exclusion. No test framework.

**Target Platform**: Static site on Cloudflare Pages; scripts on
`ubuntu-latest` runners and the author's macOS machine.

**Project Type**: Static site plus two small scripts. Single project.

**Performance Goals**: Not a driver.

**Constraints**: Public repository — no secrets, ever. The teaser length guard
defaults to 3000 characters, which is **LinkedIn's composer-UI figure and not
vendor-documented**; under this design a wrong value costs a rejected paste,
not a failed publication, so it is a convenience check rather than a gate.

**Scale/Scope**: Single author, tens of posts.

## Constitution Check

*GATE: evaluated against `.specify/memory/constitution.md`.*

| Principle | Status | Evidence |
|---|---|---|
| I. Vault and site are one directory | PASS | Posts build from `src/content/posts/` in place; attachments live beside notes and go through the asset pipeline |
| II. One-way and write-once | PASS, and now trivially | Nothing is read from LinkedIn and nothing is written to it by machine. Write-once is enforced by issue deduplication (§7.3) rather than a ledger |
| III. Fail loudly, publish nothing on doubt | PASS | Teaser validation runs at build, on the author's machine, before any workflow (§3). The workflow has no destructive act to fail halfway through |
| IV. No secret in the repo | PASS, strengthened | There are no credentials at all. The only workflow token is `GITHUB_TOKEN` scoped to `issues: write` |
| V. Smallest thing that works | PASS | One dependency; four scripts; no abstraction with a single caller. Revision 2 exists *because* of this principle |

**Constitution amendment required**: Principle II is worded around "a ledger in
the post's own frontmatter", which no longer exists. Amend to describe issue
deduplication. Tracked as a task, not silently ignored.

**Re-check after design**: no violations. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-blog-linkedin-syndication/
├── plan.md              # This file
├── spec.md              # WHAT and WHY, revision history, Adversarial Review
├── research.md          # Phase 0 findings; LinkedIn API sections now historical
├── quickstart.md        # Cloudflare + Giscus setup, and the paste routine
└── tasks.md             # /speckit-tasks output — not yet created
```

### Source Code (repository root)

```text
.github/workflows/
└── syndicate-issue.yml        # push:main → open paste-ready issues

.obsidian/                     # committed EXCEPT workspace.json
├── app.json
├── appearance.json
└── core-plugins.json

scripts/
├── posts.mjs                  # shared: read, validate, slug, canonical URL, render
├── lint-posts.mjs             # CLI, runs as npm `prebuild`
├── syndicate-issue.mjs        # CLI, runs in CI
└── test-posts.mjs             # assert-based self-check, `npm test`

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
package.json, tsconfig.json, .gitignore
```

**Structure Decision**: Single project, Astro's conventional layout, four flat
scripts with no `lib/` directory for four files. Two deliberate choices carried
from revision 1:

- **`site.config.mjs`** so the canonical URL has exactly one definition, shared
  by `astro.config.mjs` and the issue renderer. A drift here puts a wrong URL
  in a LinkedIn post.
- **Attachments inside `src/content/posts/`**, not `public/`, so Astro's asset
  pipeline processes them (FR-006).

`.gitignore`: `node_modules/`, `dist/`, `.astro/`, `.obsidian/workspace.json`,
`.env`, `.env.*`, `.DS_Store`.

---

## 3. Content collection and validation (FR-002, FR-003, FR-007, FR-018, FR-019)

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

**Seven fields, down from nine.** `linkedinUrn` is gone with the ledger, and
`linkedin: boolean` is gone because it was redundant: a teaser exists or it does
not (FR-014). Removing it also removes a failure mode — revision 1 had to
validate "flag set but text empty", which cannot now be expressed.

**Validation lives at build time** (FR-018), in `scripts/lint-posts.mjs`, wired
as an npm lifecycle hook so it cannot be forgotten:

```json
"prebuild": "node scripts/lint-posts.mjs"
```

npm runs `prebuild` before `build`, locally and on Cloudflare. Rules:

| Check | Message |
|---|---|
| filename `^[a-z0-9-]+\.md$` | `slug must be kebab-case` |
| `linkedinText`, if present, is non-blank | `linkedinText is present but empty` |
| length ≤ `LI_MAX_CHARS` (default 3000) | `linkedinText is N chars, limit 3000` |
| no `http://` / `https://` in `linkedinText` | `linkedinText must not contain a URL — it goes in the comment` |

Length is `[...text].length` — codepoints, not UTF-16 units, so emoji are not
miscounted. Never truncate.

The kebab-case rule is enforced here rather than at syndication time because
the adversarial gate showed the late placement could wedge a post: published
for months, then unsyndicatable, with the only remedy a rename the Assumptions
forbid. At build time it fails on the very first `npm run build`.

**Draft exclusion** (FR-003, FR-004), applied in the index, tag pages, RSS,
sitemap, and `getStaticPaths`:

```ts
const published = (await getCollection('posts'))
  .filter(p => import.meta.env.PROD ? !p.data.draft : true);
```

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

Cloudflare Pages: framework preset Astro, build `npm run build`, output `dist`,
production branch `main`, `NODE_VERSION=24`.

The `[skip ci]` prefix subtlety from revision 1 is gone: nothing writes back to
the repo, so there is no ledger commit whose rebuild needs suppressing.

## 5. Giscus (FR-011 – FR-013)

Preconditions on this repo: public, [giscus app](https://github.com/apps/giscus)
installed, Discussions enabled, and a category **`Comments`** of type
**Announcement** — so only maintainers can open threads and giscus creates them
(FR-013).

`src/components/Giscus.astro`, rendered in `PostLayout.astro` below the article:

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

`data-repo` and the two ids are filled in once the repository exists and its
name is decided. Giscus keys threads on the numeric `repo-id`, so a later
repository **rename does not orphan existing comments** — which is what makes
the repo name a cheap decision relative to the domain.

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

`useMarkdownLinks` + `newLinkFormat` guarantee `![](attachments/x.png)` and
never `![[x.png]]` (FR-009). `userIgnoreFilters` is the "Excluded files"
setting (FR-010). `attachmentFolderPath` puts pastes in
`src/content/posts/attachments/`. `alwaysUpdateLinks` so a rename does not
break an image path.

`.obsidian/workspace.json` is gitignored — it churns on every pane move.

Open verification: whether Astro resolves a bare `attachments/x.png` or requires
`./attachments/x.png`. Tested in §11 Phase 2; the fallback is a four-line remark
plugin normalising the prefix.

## 7. Syndication assistance

### 7.1 Workflow

```yaml
name: syndicate-issue
on:
  push:
    branches: [main]
    paths: ['src/content/posts/**']
  workflow_dispatch:
permissions:
  contents: read            # note: READ. Nothing writes to the repo.
  issues: write
jobs:
  prepare:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci
      - run: node scripts/syndicate-issue.mjs
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

No `concurrency` group, no `ref: main` subtlety, no external secrets. Two
concurrent runs can at worst race to create the same issue, and the cost of
losing that race is one duplicate issue — so the guard revision 1 needed is not
worth its own complexity here.

### 7.2 What it does

Rather than diffing the push to find changed posts, the script **reconstructs
the whole desired state every run**:

1. Read every post; keep those with `draft: false` and a non-empty
   `linkedinText`.
2. `gh issue list --label syndicate --state all --limit 500 --json title` —
   one call — and parse the slug out of each `Syndicate: <slug>` title.
3. For every kept post whose slug is not in that set, create its issue.

This is both simpler and self-healing: a missed push, a failed run, or a
manually deleted issue all correct themselves on the next run, and there is no
before/after SHA logic to get wrong. Re-running the workflow on an old commit
is harmless.

### 7.3 Idempotency (FR-016, SC-003)

The issue is the ledger. Deduplication is `--state all`, so a **closed** issue
still suppresses recreation — the common case, since closing it is how the
author marks a post as pasted. The slug, not the title, is the key, so editing
a post's `title` does not orphan its issue.

Worst case under a race is a duplicate issue. Compare with revision 1, where
the equivalent race published a second post to LinkedIn.

### 7.4 Issue content

Title: `Syndicate: <slug>`, label `syndicate`.

Body carries the two blocks in fenced code, so GitHub's copy button yields
exactly the bytes in the repo (FR-020, SC-007) with no markdown interpretation:

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

Nothing is escaped, encoded, or transformed at any point. Revision 1's
`little`-format escaper — fifteen reserved characters, a non-idempotent
transform, and its own test row — does not exist here, because the LinkedIn
composer takes literal text.

## 10. Failure modes

| # | Failure | Detection | Behaviour |
|---|---|---|---|
| 1 | Teaser empty, over-length, or contains a URL | `prebuild` lint | build fails, on the author's machine, before push |
| 2 | Filename not kebab-case | `prebuild` lint | build fails on the first build |
| 3 | Issue creation fails (API error, rate limit) | `gh` exit code | workflow fails visibly; **no side effect**; re-run recreates cleanly |

Three rows, down from nineteen. There is no partial state to recover, nothing
irreversible to guard, and no credential to expire. The failure table shrank
because the design did, not because the analysis got lazier.

## 11. Test plan

Verify by exercising behaviour, not by typechecking. One runnable check per
piece of non-trivial logic.

### Phase 1 — site

- `npx astro check && npm run build` clean.
- Fixtures: one published, one `draft: true`, one with an image, one with a
  teaser containing awkward characters (`(parens)`, `_under_`, `#hash`,
  `C:\path`, an emoji) to confirm they survive untouched.
- **Draft exclusion, asserted not eyeballed**: grep `dist/` for the draft's
  slug, and **also assert the published fixture IS present**, so the check
  cannot pass vacuously.
- `dist/rss.xml` parses, contains the published post, not the draft.
- `[...slug]` and 404 render.

### Phase 2 — Obsidian

- Open the repo as a vault; paste an image. Assert the emitted markdown is
  `![](attachments/…)`, no `[[…]]`.
- Build and confirm the image reaches `dist/_astro/`. **The fixture MUST set
  `draft: false`** — a draft emits no image regardless, so the test would fail
  for the wrong reason and send us to write a remark plugin that was never
  needed.
- Quick switcher shows no `node_modules` path.
- Move panes, close Obsidian, `git status` shows no tracked change.

### Phase 3 — Giscus

- Build, serve `dist/`, open a post: the widget renders. A wrong `repo-id`
  fails visibly here, which is why this runs against built output.
- Post one comment; confirm a Discussion appears keyed to the pathname. Delete
  it after.
- Toggle OS dark mode; the widget follows.

### Phase 4 — syndication assistance

`scripts/test-posts.mjs`, plain `node:assert`, `npm test`:

| Assertion | Guards |
|---|---|
| teaser with reserved characters and emoji round-trips **byte-identical** into the issue body | FR-020, SC-007 |
| over-limit teaser ⇒ lint throws, count in message | FM #1 |
| teaser at exactly the limit ⇒ passes | off-by-one |
| 3000-codepoint emoji string ⇒ passes | codepoint counting |
| teaser containing a URL ⇒ throws | FM #1 |
| blank teaser ⇒ throws | FM #1 |
| non-kebab filename ⇒ throws | FM #2 |
| `draft: true` with a teaser ⇒ not selected | FR-015 |
| post with no teaser ⇒ not selected, no error | FR-015 |
| slug already in the existing-issue set ⇒ not selected | FR-016 |
| slug present with a **closed** issue ⇒ still not selected | FR-016 — the common case |
| canonical URL is built from `SITE_URL` + slug with exactly one `/` between | URL correctness |
| the selection fixture set contains ≥1 selected AND ≥1 rejected | **non-vacuity** |

The dedupe assertions run against a fixture list of issue titles, so the whole
selection path is testable with no network and no GitHub.

**Live verification, one post:** publish a real post with a teaser; confirm one
issue appears with correct content; re-push and confirm no second issue; close
it and re-push and confirm still no second issue.

## 12. Build order and definition of done

| Phase | Scope | Done when |
|---|---|---|
| 1 | Astro site, collection, layouts, RSS, sitemap, `lint-posts.mjs`, fixtures | §11 Phase 1 green, deployed to Pages |
| 2 | Obsidian config, gitignore, image round-trip | §11 Phase 2 green |
| 3 | Giscus | §11 Phase 3 green, one real comment posted and deleted |
| 4 | `syndicate-issue.yml`, `posts.mjs`, `syndicate-issue.mjs`, tests | §11 Phase 4 green and one real issue produced end to end |

**Blocked on the author**: the site name, which fixes the domain (`SITE_URL`),
the repository name (`data-repo`), and nothing else. Phases 1–4 can all be
built with a placeholder `SITE_URL` and one edit to `site.config.mjs` when the
name is chosen — the single-source-of-truth structure exists precisely so that
edit is one line.

Removed from the build order entirely: the LinkedIn app, the Company Page, the
OAuth bootstrap, and the permission probe. `scripts/oauth-bootstrap.mjs` is
deleted; it is recoverable from git history at `e30afab` if revision 1 is ever
revived.

## Complexity Tracking

No Constitution Check violations. One amendment owed to the constitution itself
(Principle II wording), tracked as a task.

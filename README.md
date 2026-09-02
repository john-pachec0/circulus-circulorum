# Circulus circulorum

A personal blog at [pacheco-ops.com](https://pacheco-ops.com).

This repository is two things at once. Open it in **Obsidian** and it is a
vault. Point **Astro** at it and it is a static site. There is no export step
between them — the markdown file you type into is the one that gets built.

Comments are GitHub Discussions on this repo, via [Giscus](https://giscus.app/).
Deployment is GitHub Pages on push to `main`.

---

## Quick start

Requires **Node 24+**.

```bash
npm install
npm run dev          # http://localhost:4321 — drafts ARE visible here
```

To open the vault: Obsidian → *Open folder as vault* → this directory. Editor
settings are committed, so a fresh clone is already configured — markdown-style
image links, build directories excluded from search.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server. **Drafts are rendered**, so you can preview unpublished posts. |
| `npm run build` | Production build to `dist/`. Runs `lint` first via `prebuild`. **Drafts are excluded** from every artifact. |
| `npm run preview` | Serve the built `dist/` locally — the closest thing to what deploys. |
| `npm run lint` | Filename and teaser rules (see below). Runs automatically before every build. |
| `npm run check` | `astro check` — typecheck `.astro` and `.ts`. Should report 0 errors, 0 warnings, 0 hints. |
| `npm test` | Assertions over the post-selection, validation, and issue-rendering logic. |

## Writing a post

Create `src/content/posts/<kebab-case-name>.md`. **The filename becomes the
URL**, so it must match `[a-z0-9-]+` — the lint enforces this at build time, on
purpose: a filename problem discovered after a post is live and linked cannot
be fixed by renaming without breaking those links.

```yaml
---
title: How this blog works
description: One line. Shown on the index, in the feed, and in search results.
pubDate: 2026-09-02
updated: 2026-09-10        # optional
tags:
  - meta
draft: false               # omit or set true to keep it unpublished
linkedinText: |-           # optional; see "Syndication assist"
  A standalone plain-text teaser.
---
```

### Drafts

`draft` defaults to **`true`**. A note with no `draft` key is unpublished — you
have to say `draft: false` on purpose. Drafts are committed and readable in the
repo and the vault, and appear nowhere in the built site, the RSS feed, or the
sitemap.

That default is stated in two places: the collection schema in
`src/content.config.ts` for Astro, and explicitly in `scripts/posts.mjs`, which
reads raw YAML where an omitted key is `undefined` rather than `true`. Both say
`draft === false`. Getting that wrong would offer a link to a page the build
never emitted, so there is a test for exactly this case.

### Images

Paste into Obsidian and it lands in `src/content/posts/attachments/`. The
emitted link is a plain relative path:

```markdown
![A small circle](attachments/circulus.png)
```

Astro resolves that and runs it through the asset pipeline — hashed, converted
to webp, no raw path left in the HTML. Do **not** use `![[wikilinks]]`; the
committed vault config already prevents Obsidian from generating them.

---

## Syndication assist

There is no LinkedIn integration, no credential, and nothing in this repo talks
to LinkedIn. Instead:

> Add a `linkedinText` to a post. On push, a GitHub Action opens an issue
> titled `Syndicate: <slug>` containing two copy-buttons' worth of text — the
> post body, and the follow-up comment carrying the canonical URL. Paste both,
> close the issue.

The presence of `linkedinText` is the entire opt-in; there is no boolean to
remember to flip. Closing the issue is what marks it done — deduplication
matches issues in **any** state, so a closed issue is never re-offered.

### Preview an issue locally

No network, no repo, no credentials:

```bash
npm run build
node scripts/syndicate-issue.mjs --dry-run --offered=

# pretend a post was already syndicated:
node scripts/syndicate-issue.mjs --dry-run --offered=hello-world
```

`--offered=` supplies the already-syndicated set by hand instead of querying
GitHub. CI never passes it.

### Teaser rules, enforced at build

| Rule | Why |
|---|---|
| Non-empty if present | An empty teaser means a blank post |
| ≤ 3000 codepoints | LinkedIn's composer limit. Counted in codepoints, so emoji aren't double-counted. Never truncated — it fails instead |
| No URL | The link goes in the follow-up comment, not the body. This is a gate, not a convention |

### Things that are deliberately not automated

- **Editing a post does not update LinkedIn.** It's a snapshot at paste time.
- **Nothing re-offers a post.** Delete its issue and re-run the workflow.
- **Renaming a published post** produces a second issue and breaks links you've
  already pasted. Treat published slugs as immutable.

---

## Testing

```bash
npm test        # logic assertions
npm run check   # typecheck
npm run build   # includes the lint
```

`npm test` covers post selection, teaser validation, issue rendering, and the
deduplication parsing. Notable cases, all of which have been live bugs or were
one edit away from being live bugs:

- A `draft` key **omitted entirely** must not be selected. The obvious test
  (`draft: true` ⇒ not selected) passes under both a correct implementation and
  a buggy `!data.draft`, so it proves nothing — the omitted case is the one that
  distinguishes them.
- A teaser containing a ``` fence must not truncate when wrapped in a code block
  in the issue body, or you paste half a post in public.
- Length must be counted in codepoints, not `String.length`.
- A failed issue listing must never be read as "nothing has been syndicated."
- The selection fixture set must contain at least one selected **and** one
  rejected post, so the suite cannot pass by filtering everything away.

### Proving a test isn't vacuous

Before trusting a guard, break it and confirm the suite goes red:

```bash
cp scripts/posts.mjs /tmp/posts.bak         # cp, not git — these may be untracked
# edit the guard to be wrong
npm test                                    # MUST fail, and name the right case
cp /tmp/posts.bak scripts/posts.mjs
npm test                                    # green again
```

### Verifying draft exclusion

Check both directions — an absence test that matches nothing passes for the
wrong reason:

```bash
npm run build
grep -r 'on-drafts' dist/ ; echo "expect: no matches"
test -f dist/posts/hello-world/index.html && echo "expect: published post IS present"
```

---

## Layout

```
src/
  content.config.ts        typed frontmatter schema (shape only)
  content/posts/           the vault — posts and attachments/
  posts.ts                 publishedPosts() — the one place drafts are filtered
  layouts/  components/  pages/  styles/
scripts/
  posts.mjs                shared: read, validate, slug, canonical URL, render
  lint-posts.mjs           runs as npm `prebuild`
  syndicate-issue.mjs      runs in CI, after the build
  test-posts.mjs           npm test
site.config.mjs            SITE_URL, title, limits — single source of truth
.obsidian/                 committed vault config (workspace.json is ignored)
specs/                     the spec this was built from
```

**`site.config.mjs` is the one file to edit** when something needs to change
globally. The site URL lives there once, because both the Astro build and the
syndication script need it and a drift between them would put a wrong URL in a
LinkedIn post you can't edit.

## Deployment

GitHub Pages, from Actions, on push to `main`. One workflow, three jobs:

```
build  ──▶  deploy  ──▶  syndicate
```

`syndicate` declares `needs: deploy`, so a syndication issue cannot be opened
before the page it links to is actually live. That ordering is the reason
hosting lives on GitHub rather than elsewhere — hosting and syndication used to
be independent processes whose failures could diverge.

Repo setup is Settings → Pages → **Source: GitHub Actions**, plus the custom
domain and its DNS records. The `CNAME` file is generated at build time from
`SITE_URL`, so the domain is defined once. Full steps in
[`quickstart.md`](specs/001-blog-linkedin-syndication/quickstart.md).

No adapter — the site is fully static.

## Spec

This project was specified before it was built. The spec, the design, the
research with vendor citations, and two rounds of adversarial review — including
the reasoning behind dropping an automated LinkedIn API integration — are in
[`specs/001-blog-linkedin-syndication/`](specs/001-blog-linkedin-syndication/).

Start with [`spec.md`](specs/001-blog-linkedin-syndication/spec.md) for what and
why, [`plan.md`](specs/001-blog-linkedin-syndication/plan.md) for how.

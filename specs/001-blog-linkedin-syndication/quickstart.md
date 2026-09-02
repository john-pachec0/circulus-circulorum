# Quickstart — one-time setup, and the publishing routine

**Revision 2.** The LinkedIn OAuth bootstrap and permission probe that filled
this file under revision 1 are gone; there is no LinkedIn app, no credential,
and nothing to authorise. Recoverable from git history at `e30afab` if the API
design is ever revived.

Nothing here is needed to write or build the blog locally. It is the setup for
deploying it and for the syndication assist.

---

## A. One-time: GitHub

1. Create the repository, public. Public is required — Giscus will not work on
   a private repo, and the author has accepted that drafts and history are
   readable.
2. Settings → General → Features → enable **Discussions**.
3. Discussions → New category → **Comments**, type **Announcement**. The type
   matters: only maintainers can open Announcement threads, so giscus creates
   them and nobody else can seed the category with junk.
4. Install the [giscus app](https://github.com/apps/giscus) on the repository.
5. Create the label `syndicate` (any colour). The workflow filters on it.

No secrets are configured at any point. The workflow uses the automatic
`GITHUB_TOKEN`, scoped to `issues: write` and `contents: read`.

## B. One-time: Giscus ids

Visit [giscus.app](https://giscus.app/), enter the repository, and pick
**Discussion title contains page pathname** for mapping. It emits a script tag
containing `data-repo-id` and `data-category-id`. Copy those two values into
`src/components/Giscus.astro`.

They are public identifiers, not secrets — they belong in the committed
component.

Giscus keys threads on the numeric `repo-id`, so **renaming the repository
later will not orphan existing comments**. The repository name is a cheap
decision; the domain is not.

## C. One-time: Cloudflare Pages

Connect the repository as a Pages project:

| Setting | Value |
|---|---|
| Framework preset | Astro |
| Build command | `npm run build` |
| Output directory | `dist` |
| Production branch | `main` |
| Environment variable | `NODE_VERSION=24` |

No adapter and no Workers configuration — a fully static Astro site needs
neither (`research.md` §7).

Set the custom domain once the name is decided, and set the same URL in
`site.config.mjs`. That file is the single source for the canonical link, so
this is one edit in one place.

## D. One-time: the site name

The only decision blocking Phases 1–4. It fixes three things, in descending
order of how hard they are to change later:

1. **The domain** (`SITE_URL`). Hardest — it appears in every LinkedIn post you
   paste, and you will not go back and edit those.
2. **The repository name** (`data-repo`). Cheap; GitHub redirects and Giscus
   survives a rename.
3. **The Page name** — no longer applicable. Revision 2 removed the LinkedIn
   app, and with it the requirement to create and verify a LinkedIn Company
   Page. That obligation is simply gone.

Everything can be built against a placeholder `SITE_URL` and switched with one
line when you decide.

---

## E. The publishing routine

Ordinary post, no LinkedIn:

1. Write the note in Obsidian under `src/content/posts/`, kebab-case filename.
2. Fill the frontmatter; set `draft: false` when ready.
3. `git push`. Cloudflare builds it.

Post you also want on LinkedIn — add one frontmatter field:

```yaml
linkedinText: |
  A standalone plain-text teaser. It has to stand on its own,
  because it will carry no link.

  Literal line breaks. No markdown — LinkedIn renders none of it.
```

The presence of `linkedinText` is the entire opt-in; there is no boolean to
also remember to flip.

On push, a GitHub issue appears titled `Syndicate: <slug>` containing two code
blocks. Then, whenever you feel like it:

1. Open the issue, click copy on block 1, paste into LinkedIn's composer, post.
2. Click copy on block 2, paste as the first comment on that post.
3. Close the issue.

Closing is what marks it done — the workflow deduplicates against issues in
**any** state, so a closed issue is never recreated.

### Things that are deliberately not automated

- **Editing a post does not update LinkedIn.** LinkedIn is a snapshot at paste
  time. If you want a revised teaser out, do it by hand.
- **Nothing re-offers a post.** To syndicate again, delete the issue and
  re-run the workflow, or just paste it again yourself.
- **The URL is not in the post body.** It goes in the follow-up comment.
  Note that the premise behind this — that LinkedIn down-ranks posts with
  outbound links — is widely repeated and *not* vendor-documented
  (`research.md` §11). If you decide it is folklore, the simplification is to
  put the URL in the body and stop pasting twice.

## F. Local checks

```bash
npm run build      # runs the prebuild lint first
npm test           # validation, selection, and issue-rendering assertions
```

The lint runs as an npm `prebuild` hook, so an over-length teaser, a URL in the
body, or a non-kebab-case filename fails on your own machine before it can
reach a push.

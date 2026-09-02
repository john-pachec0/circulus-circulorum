# Phase 0 Research — 001-blog-linkedin-syndication

Every claim below was checked against the live vendor documentation on
2026-09-02, not recalled. Sources are linked inline so the next reader can
re-derive rather than trust.

> ## Section status (revisions 2 and 3)
>
> Spec revision 2 removed the LinkedIn API integration; revision 3 moved
> hosting to GitHub Pages (see spec.md → Revision History). Sections are
> therefore split:
>
> | Section | Status |
> |---|---|
> | §1 `little` text format | **Historical** — no API call, so no escaping. Kept because it is the single best argument against reviving the API design |
> | §2 comment scope conflict | **Historical** — the unanswerable question that motivated the change |
> | §3 refresh tokens | **Historical** — no credential exists |
> | §4 Posts API contract | **Historical** |
> | §5 comment contract, URN forms | **Historical** |
> | §6 Astro 7 content collections | **LIVE** — still the basis of the schema and the slug constraint |
> | §7 Cloudflare deployment | **HISTORICAL as of revision 3** — hosting moved to GitHub Pages. Kept because the `[skip ci]` prefix correction and the build/workflow independence it documents are exactly what motivated the move. Current hosting facts are in §12 |
> | §8 Giscus prerequisites | **LIVE** |
> | §9 deploy/publish race | **Historical** — the author pastes long after the deploy finishes |
> | §10 the 3000-char limit is uncited | **LIVE, downgraded** — now a build-time convenience guard, not a publication gate |
> | §11 unverified claims | **LIVE** — in particular, that LinkedIn down-ranks posts containing links is still unverified, and still the reason the URL goes in a follow-up comment rather than the body |
> | §12 GitHub Pages | **LIVE** — added at revision 3; supersedes §7 for hosting |
>
> Nothing is deleted. The historical sections are the record of what the API
> route costs, and the reason the project is not taking it.

---

## 1. `commentary` is NOT plain text — it is LinkedIn's `little` format

**Contradicts the brief.** The brief specifies "LinkedIn posts are PLAIN TEXT".
That is true of what a reader sees; it is false of what the API accepts.

Source: [little Text Format](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format)

> All reserved characters need to be escaped with a backslash, **even if those
> characters are not used in one of the supported elements or templates.**

The reserved set, from the published grammar:

```
|  {  }  @  [  ]  (  )  <  >  #  \  *  _  ~
```

Fifteen characters. An essay teaser containing `(an aside)`, `snake_case`,
`C:\path`, or `*emphasis*` is not safe to send raw — it will either be rejected
or silently rendered as markup.

**Decision**: `linkedinText` stays plain text *as authored* (FR-020). The job
applies escaping as the final transform before the POST. The author never types
a backslash.

**Consequence, accepted**: a literal `#tag` in `linkedinText` renders as the
text "#tag", not a LinkedIn hashtag. Real hashtags need the
`{hashtag|\#|tag}` template. Not building that — no stated need, and it is an
additive escape hatch later.

**Not symmetric**: a *comment*'s `message.text` uses the older model (plain text
plus a separate `attributes` array) and is **not** escaped. Two calls, two text
formats, easy to get backwards — pinned by a test.

**Length**: measured on the unescaped text, since backslashes are markup rather
than content. If LinkedIn disagrees and counts the escaped string, the API
returns `FIELD_LENGTH_TOO_LONG` and the run fails loudly. Acceptable: it fails,
it does not mangle.

---

## 2. The comment endpoint documents a scope no self-serve app can obtain

**This is the owner's open question. Research sharpens it; it does not settle
it.** The documentation now conflicts with itself:

| Source | Scope named for commenting |
|---|---|
| [Getting Access](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access) — open permissions | `w_member_social` — "Post, **comment** and like posts on behalf of an authenticated member" |
| [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api) — permissions table | `w_member_social` — "Post, **comment**, and like posts…" |
| [Social Actions API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/network-update-social-actions) — permissions table | `w_member_social_feed` — "Post, comment, and like posts…" |

The complete set of self-serve ("Open") permissions is `profile`, `email`, and
`w_member_social`. **`w_member_social_feed` appears in no self-serve product.**

So either the Social Actions page names a newer scope that `w_member_social`
still satisfies, or commenting genuinely requires Community Management
approval. Not decidable from documentation.

**Decision**: settle it empirically before Phase 4 is called done. `quickstart.md`
carries the exact probe: create a throwaway post, attempt a comment, delete the
post, read the status code. The design ships with the fallback already built
(plan.md §7.5) so the answer costs a configuration change (FR-023, SC-008).

A free pre-check exists: the bootstrap prints the token's granted `scope`. Its
contents are suggestive but not decisive — the probe is ground truth.

---

## 3. A refresh token may never be issued to this app

**New risk, not in the brief, on the critical path.**

Source: [Programmatic Refresh Tokens](https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens), opening line:

> LinkedIn supports programmatic refresh tokens **for all approved Marketing
> Developer Platform (MDP) partners.**

And, on the exchange:

> **If your application is authorized for programmatic refresh tokens**, the
> following fields are returned…

A non-authorised app's token exchange simply returns no `refresh_token`. The
entire design assumes `LI_REFRESH_TOKEN` exists.

Confirmed TTLs: access token **60 days**; refresh token **365 days**; the
refresh TTL does **not** reset when used (day 360 → both expire in 5 days).
LinkedIn also reserves the right to revoke either at any time.

**Decision**: detected for free at bootstrap — the script reports whether a
refresh token came back. One seam (`getAccessToken`) sits in front of the
difference; the fallback is a 60-day `LI_ACCESS_TOKEN` secret re-minted by hand,
with the existing health check nagging before expiry (FR-033). No other code
moves.

**Exchange contract**, confirmed:
`POST https://www.linkedin.com/oauth/v2/accessToken`,
`Content-Type: application/x-www-form-urlencoded`, body
`grant_type=refresh_token&refresh_token=…&client_id=…&client_secret=…`.
The response carries `refresh_token_expires_in`, which is what the health check
reads — no stored issue date is needed.

---

## 4. Posts API contract, confirmed

Source: [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api)

- `POST https://api.linkedin.com/rest/posts`
- Headers: `Authorization: Bearer …`, `LinkedIn-Version: YYYYMM`,
  `X-Restli-Protocol-Version: 2.0.0`, `Content-Type: application/json`
- Success is **201**, and the created identifier arrives in the **`x-restli-id`
  response header** — as `urn:li:share:{id}` *or* `urn:li:ugcPost:{id}`. It is
  not in the body. This is exactly as the brief specified.
- Documented errors relevant here: `403 ACCESS_DENIED` (scope),
  `400 FIELD_LENGTH_TOO_LONG` (over-length commentary),
  `429 TOO_MANY_REQUESTS`, `409 CONFLICT` (retryable).

**Version pinning**: the current moniker is `202608`. Versions sunset after
roughly twelve months — `202508` sunset on 2026-08-17. Pinned as one constant;
a sunset surfaces as a failed run, not as silent drift.

---

## 5. Comment contract and the URN-form trap, confirmed

Source: [Social Actions API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/network-update-social-actions)

- `POST https://api.linkedin.com/rest/socialActions/{urn}/comments`
- The URN in the path is URL-encoded, colons included:
  `urn%3Ali%3AugcPost%3A7096760097833439232`.
- Body: `{ actor, object, message: { text } }`.
- Response `201`; the new comment id is again in `x-restli-id`.

The brief's trap is real and the docs demonstrate it: LinkedIn's own sample
pairs a **`ugcPost` URN in the path** with an **`activity` URN in `object`** —
`urn:li:ugcPost:7096760097833439232` against
`urn:li:activity:7096760097833439232`. The numeric id is shared across forms,
so handling both is a prefix swap on the same id, not a lookup.

Also documented: `429 Comment create throttled: creation rate limit exceeded
for member` — a per-minute limit distinct from the general rate limit.

---

## 6. Astro contract, confirmed against the installed version

`npm view astro version` → **7.2.10**. Checked because the content collections
API changed shape and stale recall would produce a config that silently loads
nothing.

Source: [Content Collections](https://docs.astro.build/en/guides/content-collections/)

- Config lives at **`src/content.config.ts`** — not the legacy
  `src/content/config.ts`.
- A **`loader` is required**; `glob({ pattern, base })` from `astro/loaders`.
- `z` from `astro/zod`; query with `getCollection`; render with
  `render(entry)` imported from `astro:content` — not the old
  `entry.render()` method.

**Slug derivation** is the risk here: the glob loader slugifies ids from
filenames, so an Obsidian note titled `My First Post.md` and the syndication
job's idea of the slug can diverge — and a diverged slug means a LinkedIn post
linking to a 404. Rather than reimplement Astro's slugifier in the job and hope
it stays in sync, filenames are constrained to kebab-case and validated
(FR-018). Then slug equals filename minus `.md` in both places, trivially.

---

## 7. Cloudflare deployment, confirmed

Source: [Deploy to Cloudflare](https://docs.astro.build/en/guides/deploy/cloudflare/)

- A fully static Astro site needs **no adapter**. Build `npm run build`, output
  `dist/`.
- Cloudflare now recommends **Workers** for new projects; Pages is maintained
  but no longer the primary recommendation. **Pages is a locked decision and
  does exactly what was asked** — recorded here only so it is not a surprise.
- **Skip marker placement — corrected at the adversarial gate.** An earlier
  draft of this file said Pages "honours `[skip ci]` in a commit message",
  which is true of the token and wrong about where it may sit. From
  [Cloudflare's GitHub integration docs](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/):

  > By adding the `[CI Skip]`, `[CI-Skip]`, `[Skip CI]`, `[Skip-CI]`, or
  > `[CF-Pages-Skip]` flag **as a prefix in your commit message**, Pages will
  > omit that deployment.

  Prefixes are case-insensitive, so `[skip ci]` matches `[Skip CI]` — but only
  at the **start** of the message. The plan's original
  `chore: record … [skip ci]` would have rebuilt the site on every ledger
  commit. Corrected to `[skip ci] chore: record …` (plan.md §7.4).

- **And the marker is only needed for Cloudflare.** From
  [GitHub's event docs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows):
  with the exception of `workflow_dispatch` and `repository_dispatch`, events
  triggered by the default `GITHUB_TOKEN` "do not create workflow runs at all".
  So the ledger commit could never have re-triggered the workflow anyway — the
  marker's sole job is suppressing the Pages rebuild, which is precisely the
  job the suffix placement failed (FR-027).

- **Scheduled workflows are disabled after 60 days of inactivity.** Same
  source: *"In a public repository, scheduled workflows are automatically
  disabled when no repository activity has occurred in 60 days."* This repo is
  public and single-author, so the token-health cron cannot be the only nag —
  mitigation in plan.md §7.7.

---

## 8. Giscus prerequisites, confirmed

Source: [giscus.app](https://giscus.app/)

Three preconditions, all satisfiable on this repo: it is **public**, the
**giscus app** must be installed, and **Discussions** must be enabled.

`data-mapping="pathname"` with `data-strict="1"` keys the thread to
`/posts/<slug>/`; `data-theme="preferred_color_scheme"` follows the reader's OS
setting with no theme-sync script. Repo and category ids are public
identifiers, not secrets.

---

## 9. Deploy/publish race — identified, not from a doc

Not a vendor finding; a consequence of the architecture worth recording because
the fix is a design element rather than an implementation detail.

The Cloudflare build and the syndication workflow both start from the same
push and run concurrently. Without ordering, a LinkedIn post can be created and
its canonical URL attached before that URL is deployed — publishing a link to a
404. The site rebuild is cheap and repeatable; the LinkedIn post is neither.

**Decision**: the job polls the canonical URL until it resolves *before*
creating the LinkedIn post (FR-024, SC-005), bounded, failing rather than
publishing on timeout.

---

---

## 10. The 3000-character limit is NOT vendor-documented

Raised at the adversarial gate, and it is correct: nothing I fetched states a
number. The Posts API error table documents `FIELD_LENGTH_TOO_LONG` with no
value; the `little` page states no limit. 3,000 is LinkedIn's *composer UI*
figure, carried in from the brief and from recall.

Under the constitution's Quality Gates ("every external API claim cites the
current vendor doc, not recall"), this cannot be presented as a fact.

**Decision**: treat it as a tunable pre-flight guard (`LI_MAX_CHARS`, default
3000), not a law, with the API's `FIELD_LENGTH_TOO_LONG` as the real backstop.
Counting is by **codepoint** (`[...text].length`), not UTF-16 unit, so emoji
are not miscounted. Whether LinkedIn measures the escaped or unescaped string
is also undocumented, so the dry-run prints both counts.

---

## 11. Claims that remain unverified

Recorded rather than dropped — omission and checked-and-false look identical to
the next reader.

- **Whether `content.article` requires a `thumbnail` for an organic post.** The
  Posts API says partners "must set article fields such as thumbnail, title,
  and description", and the schema page delegates ArticleContent to the ads
  integration page, which was not fetched. If thumbnail is mandatory, the
  `article` fallback additionally needs the Images API upload flow — and its
  claim to be a configuration-only change becomes false. **Must be settled
  before `article` is relied on**, not after.
- **Whether LinkedIn down-ranks posts containing links.** This is the premise
  the entire distinctive design rests on — no URL in the body, link attached
  separately, the permission probe, the strategy ladder. It is widely repeated
  and not vendor-documented; no authoritative source found. The decision is
  locked by the owner and is not being relitigated. Named because a premise
  checked-and-unverifiable should not read as a premise never checked.
- **Obsidian's `app.json` key names** (`userIgnoreFilters`,
  `attachmentFolderPath`) were not probed against Obsidian's own schema; they
  are settled empirically by the Phase 2 test.

---

## 12. GitHub Pages, confirmed (revision 3)

Checked 2026-09-02 against live docs, because guessing action versions or DNS
records here fails on the first real deploy.

**Apex domain DNS.** Source:
[Managing a custom domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).
All four A records — `185.199.108.153`, `.109.153`, `.110.153`, `.111.153` —
plus optional AAAA `2606:50c0:800{0,1,2,3}::153`. ALIAS/ANAME pointing at the
default `github.io` domain is explicitly supported for providers that offer it.
HTTPS is supported for apex domains but **"Enforce HTTPS" is a manual toggle
that can take up to 24 hours to become available**.

**Action versions.** Source: the
[official Astro Pages starter workflow](https://github.com/actions/starter-workflows/blob/main/pages/astro.yml).
`checkout@v4`, `setup-node@v4`, `configure-pages@v5`,
`upload-pages-artifact@v3`, **`deploy-pages@v5`**. The deploy job declares
`environment: { name: github-pages, url: ... }` and needs
`pages: write` + `id-token: write`.

`deploy-pages` being on **v5** is the reason this was checked rather than
recalled — v4 was the plausible guess and would have failed on the first run.

**One thing from that starter workflow deliberately NOT copied.** It builds
with `--site "${{ steps.pages.outputs.origin }}"` from `configure-pages`. This
project omits `configure-pages` entirely and keeps `site.config.mjs` as the
single source of the URL. If the custom domain were unset or mid-propagation,
that origin resolves to `https://<user>.github.io` — and the build would emit
github.io canonical URLs into a LinkedIn issue, permanently. The starter's
convenience is a correctness hazard for this specific design.

**CNAME.** Generated at build time from `SITE_URL` by an `astro:build:done`
hook, rather than committed as `public/CNAME`, so the domain has one
definition. Verified by falsification: changing `SITE_URL` changes
`dist/CNAME`.

---

## Open questions carried into implementation

> Rewritten for revision 2b. The previous version of this table was left
> pointing at withdrawn requirements and a probe that no longer exists — row 1
> still read "run it **before writing Phase 4 code**". `/speckit-tasks` consumes
> this file, so a stale row here becomes a stale task.

| # | Question | Status | Settled by |
|---|---|---|---|
| 1 | Can `w_member_social` create comments? (§2) | **DEAD** — no API integration | — |
| 2 | Does this app get a refresh token? (§3) | **DEAD** — no credential | — |
| 3 | Does Astro resolve Obsidian's bare relative image paths? (§6) | **ANSWERED 2026-09-02 — yes** | Settled empirically, not by reading docs: a real 64×64 PNG at `src/content/posts/attachments/circulus.png`, referenced as `![](attachments/circulus.png)` with no `./` prefix, from a fixture pinned `draft: false`. The build emitted `/_astro/circulus.<hash>.webp` and the rendered HTML contains no raw `attachments/` path. **No remark plugin needed** — the contingency is dropped |
| 4 | Does `content.article` need a thumbnail? | **DEAD** — no article posts | — |
| 5 | Does GitHub's copy button on a fenced block in an issue body copy exactly the block's bytes, trailing newline included? | **LIVE** | Observation on the first real issue. FR-020 and SC-007 depend on it. If it misbehaves, the fallback is an attached file or a plain indented block |
| 6 | Does LinkedIn's composer preserve pasted plain text — smart quotes, autocorrect, newlines, `@` interception, auto-linkification? | **LIVE, and structurally unverifiable in CI** | Eyeball the first real paste. Recorded here rather than asserted as a success criterion (see spec.md SC-007) |

Cross-reference note for anyone following links out of the historical sections:
they cite `plan.md` section numbers and FR/SC identifiers **from revision 1**,
which have since been renumbered and in most cases withdrawn. Read them as a
record of what was investigated, not as pointers into the current plan.

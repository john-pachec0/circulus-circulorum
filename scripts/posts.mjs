// Shared post logic for the lint (prebuild) and the syndication workflow.
// Pure functions where possible so scripts/test-posts.mjs can exercise the
// selection and rendering paths with no filesystem and no network.
//
// Spec: specs/001-blog-linkedin-syndication/plan.md §1, §5

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { LI_MAX_CHARS, LI_COMMENT_SUFFIX, canonicalUrl } from '../site.config.mjs';

export const POSTS_DIR = 'src/content/posts';
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ISSUE_TITLE_RE = /^Syndicate: ([a-z0-9-]+)$/;

/** Codepoints, not UTF-16 units — otherwise a teaser of non-BMP emoji reads as
 *  twice its real length and gets rejected. */
export const codepoints = (s) => [...s].length;

/** A post is a draft unless it says `draft: false`.
 *
 *  NOT `!data.draft`. Astro applies `z.boolean().default(true)`, but this
 *  module reads raw YAML where an omitted key is `undefined` — and `!undefined`
 *  is true, which would select an unpublished post and offer a LinkedIn link
 *  to a page Astro never emitted. plan.md §1.1. */
export const isPublished = (data) => data.draft === false;

/** The canonical teaser: trailing whitespace trimmed, once, here — so
 *  validation, length, rendering and tests all agree on the same bytes. YAML
 *  `|` block scalars keep a trailing newline that means nothing to LinkedIn. */
export function teaserOf(data) {
  const t = data?.linkedinText;
  if (typeof t !== 'string') return undefined;
  const trimmed = t.replace(/\s+$/, '');
  return trimmed.length ? trimmed : '';
}

export function splitFrontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return null;
  return { frontmatter: m[1], body: raw.slice(m[0].length) };
}

export function readPosts(dir = POSTS_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((file) => {
      const raw = readFileSync(join(dir, file), 'utf8');
      const split = splitFrontmatter(raw);
      if (!split) throw new Error(`${file}: no YAML frontmatter block`);
      let data;
      try {
        data = parseYaml(split.frontmatter) ?? {};
      } catch (e) {
        throw new Error(`${file}: frontmatter is not valid YAML — ${e.message}`);
      }
      return { file, slug: file.replace(/\.md$/, ''), data };
    });
}

/** Throws on the first violation. Rules zod cannot express; shape errors are
 *  left to the content collection, which reports them a second later. */
export function validatePost({ file, slug, data }) {
  const fail = (msg) => {
    throw new Error(`${file}: ${msg}`);
  };

  if (!SLUG_RE.test(slug)) {
    fail(`slug must be kebab-case ([a-z0-9-]), got "${slug}"`);
  }

  if (data.linkedinText === undefined) return;

  const teaser = teaserOf(data);
  if (!teaser) fail('linkedinText is present but empty');

  const n = codepoints(teaser);
  if (n > LI_MAX_CHARS) fail(`linkedinText is ${n} chars, limit ${LI_MAX_CHARS}`);

  if (/https?:\/\/|\bwww\.\S/i.test(teaser)) {
    fail('linkedinText must not contain a URL — it goes in the follow-up comment');
  }
}

/** Fence wide enough to survive a teaser containing backticks. A bare ``` fence
 *  around text with its own ``` line closes early, and GitHub's copy button
 *  then yields a TRUNCATED teaser that gets pasted publicly. plan.md §5.5. */
export function fenceFor(text) {
  let longest = 0;
  for (const m of text.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  return '`'.repeat(Math.max(3, longest + 1));
}

export const issueTitle = (slug) => `Syndicate: ${slug}`;

export function commentText(slug) {
  return `${canonicalUrl(slug)}\n\n${LI_COMMENT_SUFFIX}`;
}

export function renderIssueBody(slug, teaser) {
  const url = canonicalUrl(slug);
  const comment = commentText(slug);
  const f1 = fenceFor(teaser);
  const f2 = fenceFor(comment);
  return [
    '**1 — paste as the post body**',
    '',
    f1,
    teaser,
    f1,
    '',
    '**2 — paste as the first comment, immediately after posting**',
    '',
    f2,
    comment,
    f2,
    '',
    '---',
    '',
    `Close this issue once pasted — a closed issue is never re-offered.`,
    '',
    `[View the post](${url})`,
    '',
  ].join('\n');
}

/** `gh issue list` returns newest-first, so a truncated page hides the OLDEST
 *  issues — exactly the long-since-pasted posts — and re-offers them. Fail
 *  rather than dedupe against a partial set. plan.md §5.3, FM #4. */
export function assertUnderCeiling(count, limit) {
  if (count >= limit) {
    throw new Error(
      `issue list hit the ${limit} ceiling — the oldest issues would be invisible ` +
        `and their posts re-offered. Raise the limit.`,
    );
  }
}

/** Slugs already offered, parsed out of existing issue titles. Titles that are
 *  not exactly `Syndicate: <slug>` are ignored rather than half-parsed. */
export function parseOfferedSlugs(titles) {
  const out = new Set();
  for (const t of titles) {
    const m = ISSUE_TITLE_RE.exec(t ?? '');
    if (m) out.add(m[1]);
  }
  return out;
}

/** Published, has a teaser, not already offered. */
export function selectForSyndication(posts, offeredSlugs) {
  return posts.filter(
    (p) => isPublished(p.data) && teaserOf(p.data) && !offeredSlugs.has(p.slug),
  );
}

/** A post is only offered if Astro actually emitted its page. Frontmatter
 *  saying `draft: false` is a claim; this is evidence. plan.md §5.2 step 2. */
export function builtPagePath(slug, distDir = 'dist') {
  return join(distDir, 'posts', slug, 'index.html');
}

export const pageWasBuilt = (slug, distDir = 'dist') =>
  existsSync(builtPagePath(slug, distDir));

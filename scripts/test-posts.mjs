#!/usr/bin/env node
// Self-check for the syndication logic. node:assert, no framework.
// Each case maps to a row of plan.md §7 Phase 4.
//
//   npm test

import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import {
  validatePost,
  isPublished,
  teaserOf,
  fenceFor,
  renderIssueBody,
  parseOfferedSlugs,
  selectForSyndication,
  assertUnderCeiling,
  codepoints,
  readPosts,
  pageWasBuilt,
} from './posts.mjs';
import { LI_MAX_CHARS, canonicalUrl, SITE_URL } from '../site.config.mjs';

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`✗ ${name}\n  ${e.message}`);
    process.exitCode = 1;
  }
};

const post = (slug, data) => ({ file: `${slug}.md`, slug, data });
const throws = (fn, re) => assert.throws(fn, re);

// ── selection ────────────────────────────────────────────────────────────────

// THE case that distinguishes a correct implementation from `!data.draft`.
// An omitted `draft` key is undefined here but defaults to true in Astro, so a
// naive check selects a post whose page was never emitted.
test('draft omitted + teaser => NOT selected', () => {
  assert.equal(isPublished({ linkedinText: 'hi' }), false);
  assert.deepEqual(selectForSyndication([post('a', { linkedinText: 'hi' })], new Set()), []);
});

test('draft: true + teaser => not selected', () => {
  assert.deepEqual(
    selectForSyndication([post('a', { draft: true, linkedinText: 'hi' })], new Set()),
    [],
  );
});

test('draft: false + teaser => selected', () => {
  const sel = selectForSyndication([post('a', { draft: false, linkedinText: 'hi' })], new Set());
  assert.equal(sel.length, 1);
  assert.equal(sel[0].slug, 'a');
});

test('published but no teaser => not selected, no error', () => {
  assert.deepEqual(selectForSyndication([post('a', { draft: false })], new Set()), []);
});

test('slug already offered => not selected', () => {
  assert.deepEqual(
    selectForSyndication([post('a', { draft: false, linkedinText: 'hi' })], new Set(['a'])),
    [],
  );
});

test('a CLOSED issue still suppresses re-offering', () => {
  // parseOfferedSlugs is fed titles from `--state all`; state is not in the
  // title, so a closed issue is indistinguishable from an open one. That is
  // the intended behaviour and this pins it.
  const offered = parseOfferedSlugs(['Syndicate: a']);
  assert.deepEqual(
    selectForSyndication([post('a', { draft: false, linkedinText: 'hi' })], offered),
    [],
  );
});

test('selection fixture set is non-vacuous (>=1 selected AND >=1 rejected)', () => {
  const posts = [
    post('yes-one', { draft: false, linkedinText: 'teaser' }),
    post('no-draft', { draft: true, linkedinText: 'teaser' }),
    post('no-omitted', { linkedinText: 'teaser' }),
    post('no-teaser', { draft: false }),
    post('yes-two', { draft: false, linkedinText: 'teaser' }),
    post('no-offered', { draft: false, linkedinText: 'teaser' }),
  ];
  const sel = selectForSyndication(posts, new Set(['no-offered']));
  assert.ok(sel.length >= 1, 'nothing selected — the test would pass vacuously');
  assert.ok(posts.length - sel.length >= 1, 'nothing rejected — filter may be a no-op');
  assert.deepEqual(sel.map((p) => p.slug), ['yes-one', 'yes-two']);
});

// ── issue title parsing ──────────────────────────────────────────────────────

test('titles that are not exactly "Syndicate: <slug>" are ignored', () => {
  const offered = parseOfferedSlugs([
    'Syndicate: good-post',
    'Syndicate: Not A Slug',
    'syndicate: lowercase-prefix',
    'Re: Syndicate: embedded',
    'Syndicate: trailing ',
    '',
    null,
  ]);
  assert.deepEqual([...offered], ['good-post']);
});

// ── validation ───────────────────────────────────────────────────────────────

test('non-kebab filename throws', () => {
  throws(() => validatePost(post('My First Post', {})), /kebab-case/);
  throws(() => validatePost(post('Trailing-Caps', {})), /kebab-case/);
  throws(() => validatePost(post('double--dash', {})), /kebab-case/);
  validatePost(post('good-slug-123', {}));
});

test('blank teaser throws; absent teaser is fine', () => {
  throws(() => validatePost(post('a', { linkedinText: '   \n  ' })), /present but empty/);
  validatePost(post('a', {}));
});

test('over-limit teaser throws, with the actual count', () => {
  const n = LI_MAX_CHARS + 1;
  throws(() => validatePost(post('a', { linkedinText: 'x'.repeat(n) })), new RegExp(`${n} chars`));
});

test('teaser at exactly the limit passes', () => {
  validatePost(post('a', { linkedinText: 'x'.repeat(LI_MAX_CHARS) }));
});

test('length is counted in codepoints, not UTF-16 units', () => {
  const emoji = '🌀';
  assert.equal(emoji.length, 2, 'precondition: this emoji is 2 UTF-16 units');
  assert.equal(codepoints(emoji), 1);
  // Exactly at the limit in codepoints, double it in `.length`. Must pass.
  validatePost(post('a', { linkedinText: emoji.repeat(LI_MAX_CHARS) }));
  throws(() => validatePost(post('a', { linkedinText: emoji.repeat(LI_MAX_CHARS + 1) })), /chars/);
});

test('teaser containing a URL throws', () => {
  throws(() => validatePost(post('a', { linkedinText: 'see https://x.com' })), /must not contain a URL/);
  throws(() => validatePost(post('a', { linkedinText: 'see http://x.com' })), /must not contain a URL/);
  throws(() => validatePost(post('a', { linkedinText: 'see www.example.com' })), /must not contain a URL/);
});

test('trailing whitespace is normalised away before validation and rendering', () => {
  assert.equal(teaserOf({ linkedinText: 'body\n\n' }), 'body');
  assert.equal(teaserOf({ linkedinText: 'body' }), 'body');
  assert.equal(teaserOf({}), undefined);
});

// ── issue rendering ──────────────────────────────────────────────────────────

/** Pull fenced blocks back out the way a reader's copy button would. */
function extractBlocks(body) {
  return [...body.matchAll(/^(`{3,})\n([\s\S]*?)\n\1$/gm)].map((m) => m[2]);
}

test('teaser round-trips byte-identical through the issue body', () => {
  const teaser = 'Parens (like this), _under_, #hash, C:\\path, a tilde ~ and 🌀 emoji.\n\nSecond para.';
  const blocks = extractBlocks(renderIssueBody('a-post', teaser));
  assert.equal(blocks[0], teaser);
});

// The bug that would otherwise yield a truncated public paste.
test('teaser containing a ``` fence widens the wrapper and survives whole', () => {
  const teaser = 'before\n```\nfenced\n```\nafter';
  const body = renderIssueBody('a-post', teaser);
  assert.ok(body.includes('````\nbefore'), 'wrapper fence did not widen');
  const blocks = extractBlocks(body);
  assert.equal(blocks[0], teaser, 'teaser was truncated by an early fence close');
});

test('fenceFor sizes to the longest run present', () => {
  assert.equal(fenceFor('no backticks'), '```');
  assert.equal(fenceFor('one ` tick'), '```');
  assert.equal(fenceFor('```'), '````');
  assert.equal(fenceFor('`````'), '``````');
});

test('comment block carries the canonical URL and the suffix', () => {
  const blocks = extractBlocks(renderIssueBody('a-post', 'teaser'));
  assert.equal(blocks.length, 2);
  assert.ok(blocks[1].startsWith(canonicalUrl('a-post')));
  assert.ok(blocks[1].includes("I don't read LinkedIn"));
});

test('canonical URL has exactly one slash between segments', () => {
  const url = canonicalUrl('a-post');
  assert.equal(url, `${SITE_URL}/posts/a-post/`);
  assert.ok(!/(?<!:)\/\//.test(url), `double slash in ${url}`);
});

// ── ceiling guard ────────────────────────────────────────────────────────────

test('issue list at the ceiling throws rather than deduping on a partial set', () => {
  assertUnderCeiling(499, 500);
  throws(() => assertUnderCeiling(500, 500), /ceiling/);
  throws(() => assertUnderCeiling(501, 500), /ceiling/);
});

// ── cross-phase: the script's slug must equal the path Astro emitted ──────────

test('every post the script would offer has a built page in dist/', () => {
  if (!existsSync('dist')) {
    console.error('  ⚠ skipped: no dist/ — run `npm run build` first to check slug agreement');
    return;
  }
  const posts = readPosts();
  const selected = selectForSyndication(posts, new Set());
  assert.ok(
    posts.some((p) => isPublished(p.data)),
    'no published fixtures — this check would pass vacuously',
  );
  for (const p of selected) {
    assert.ok(pageWasBuilt(p.slug), `${p.file}: no dist/posts/${p.slug}/index.html`);
  }
});

if (!process.exitCode) console.log(`test-posts: ${passed} checks passed`);

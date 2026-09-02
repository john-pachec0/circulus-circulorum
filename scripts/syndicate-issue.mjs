#!/usr/bin/env node
// Opens one paste-ready GitHub issue per newly published post that carries a
// teaser. Runs in CI AFTER `npm run build` — it reads dist/ as evidence that
// the page it is about to link to actually exists.
//
// Reconstructs desired state every run rather than diffing the push, so a
// missed push, a failed run, or a manually deleted issue all self-correct.
// plan.md §5.

import { execFileSync } from 'node:child_process';
import {
  readPosts,
  validatePost,
  parseOfferedSlugs,
  selectForSyndication,
  teaserOf,
  issueTitle,
  renderIssueBody,
  pageWasBuilt,
  builtPagePath,
  assertUnderCeiling,
} from './posts.mjs';

const LIMIT = 500;
const DRY_RUN = process.argv.includes('--dry-run');
// Lets `--dry-run` work with no network and no repo, so the exact issue body
// can be inspected locally before pushing. CI never passes it.
const OFFERED_ARG = process.argv.find((a) => a.startsWith('--offered='));

const gh = (args, opts = {}) =>
  execFileSync('gh', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'], ...opts });

// 1 — read and re-validate. The build already ran the lint; doing it again
// costs nothing and means this script is never the thing that trusted a step
// it did not perform.
const posts = readPosts();
for (const post of posts) validatePost(post);

// 2 — what has already been offered. Deliberately NOT filtered by label: a
// stripped label makes `gh issue list --label X` return [] with exit 0, which
// reads as "nothing syndicated yet" and re-offers every past post. plan.md §5.3
let offered;
if (OFFERED_ARG !== undefined) {
  offered = new Set(OFFERED_ARG.slice('--offered='.length).split(',').filter(Boolean));
} else {
  let issues;
  try {
    issues = JSON.parse(
      gh(['issue', 'list', '--state', 'all', '--limit', String(LIMIT), '--json', 'title']),
    );
  } catch (e) {
    // Never treat a failed listing as an empty listing — that would re-offer
    // every post ever published.
    console.error('could not list issues; refusing to run rather than re-offer every post');
    throw e;
  }
  assertUnderCeiling(issues.length, LIMIT);
  offered = parseOfferedSlugs(issues.map((i) => i.title));
}

// 3 — select, then demand evidence the page was built.
const selected = selectForSyndication(posts, offered);
const missing = selected.filter((p) => !pageWasBuilt(p.slug));
if (missing.length) {
  throw new Error(
    'these posts are marked published with a teaser but Astro emitted no page:\n' +
      missing.map((p) => `  ${p.file} -> expected ${builtPagePath(p.slug)}`).join('\n') +
      '\nrefusing to offer a link to a page that does not exist',
  );
}

if (!selected.length) {
  console.log(`nothing to offer (${posts.length} post(s), ${offered.size} already offered)`);
  process.exit(0);
}

// 4 — create. Body goes over stdin so arbitrary teaser content cannot be
// mangled by shell quoting.
for (const post of selected) {
  const title = issueTitle(post.slug);
  const body = renderIssueBody(post.slug, teaserOf(post.data));

  if (DRY_RUN) {
    console.log(`--- would create: ${title}\n${body}`);
    continue;
  }

  try {
    gh(['issue', 'create', '--title', title, '--body-file', '-', '--label', 'syndicate'], {
      input: body,
    });
  } catch {
    // The `syndicate` label is a filing convenience and may not exist yet.
    // Nothing depends on it, so never let it be the reason a post is not offered.
    console.warn(`label "syndicate" unavailable; creating ${title} without it`);
    gh(['issue', 'create', '--title', title, '--body-file', '-'], { input: body });
  }
  console.log(`opened ${title}`);
}

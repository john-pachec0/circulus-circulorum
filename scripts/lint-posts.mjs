#!/usr/bin/env node
// Runs as npm `prebuild`, so `npm run build` cannot skip it — locally or in CI.
// Rules the content collection schema cannot express: kebab-case filenames and
// the teaser constraints. plan.md §1.2.

import { readPosts, validatePost } from './posts.mjs';

const posts = readPosts();
const errors = [];

for (const post of posts) {
  try {
    validatePost(post);
  } catch (e) {
    errors.push(e.message);
  }
}

if (errors.length) {
  console.error(`\n${errors.length} post problem(s):\n`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error('');
  process.exit(1);
}

// Report the count so a run over zero posts is visibly a no-op rather than
// looking like a pass.
console.log(`lint-posts: ${posts.length} post(s) ok`);

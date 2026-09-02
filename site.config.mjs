// Single source of truth for anything that must agree between the Astro build
// and the syndication scripts. A drift here puts a wrong URL in a LinkedIn
// post you cannot edit, so both sides import from this file rather than
// restating it. See specs/001-blog-linkedin-syndication/plan.md.

export const SITE_URL = 'https://pacheco-ops.com';

export const SITE_TITLE = 'Circulus circulorum';

// Edit freely — this is the one line in the repo written by someone who is not
// the author. Shown in the <head>, the RSS feed, and search results.
export const SITE_DESCRIPTION = 'Notes on building software, and on the tools that build it.';

/** URL path prefix for posts. Changing this after publishing breaks every link
 *  already pasted to LinkedIn and orphans every Giscus thread. Don't. */
export const POSTS_BASE = '/posts';

/** Pre-flight guard on `linkedinText` length, in codepoints. LinkedIn's
 *  composer-UI figure; NOT vendor-documented for the API (research.md §10).
 *  A wrong value here costs a rejected paste, not a failed publication. */
export const LI_MAX_CHARS = 3000;

/** Appended to the canonical URL in the syndication comment. */
export const LI_COMMENT_SUFFIX =
  "I don't read LinkedIn — replies and comments live over there.";

/** Canonical URL for a post slug. One definition, used by the site and by the
 *  issue renderer, with exactly one slash between each segment. */
export function canonicalUrl(slug) {
  return `${SITE_URL}${POSTS_BASE}/${slug}/`;
}

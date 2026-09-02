import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Shape only. The cross-field rules (teaser length, no URL in the teaser,
// kebab-case filenames) live in scripts/posts.mjs, because the syndication
// workflow cannot import `astro:content` and a rule restated in two places
// drifts. See plan.md §1.
const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updated: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    // Default true: a post is unpublished until it says otherwise. Note that
    // scripts/posts.mjs must state this same default explicitly — it reads raw
    // YAML, where an omitted key is `undefined`, not `true`.
    draft: z.boolean().default(true),
    // Presence is the syndication opt-in. There is no separate boolean.
    linkedinText: z.string().optional(),
  }),
});

export const collections = { posts };

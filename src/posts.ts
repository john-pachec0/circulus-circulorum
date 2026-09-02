import { getCollection, type CollectionEntry } from 'astro:content';

/**
 * Published posts, newest first.
 *
 * Drafts are visible in `astro dev` and excluded from every production
 * artifact — pages, index, tag pages, feed, sitemap. Used everywhere rather
 * than re-filtering per page, so a page cannot forget.
 */
export async function publishedPosts(): Promise<CollectionEntry<'posts'>[]> {
  const all = await getCollection('posts');
  return all
    .filter((p) => (import.meta.env.PROD ? !p.data.draft : true))
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

export async function allTags(): Promise<string[]> {
  const posts = await publishedPosts();
  return [...new Set(posts.flatMap((p) => p.data.tags))].sort();
}

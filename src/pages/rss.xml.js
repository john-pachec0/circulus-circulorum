import rss from '@astrojs/rss';
import { publishedPosts } from '../posts';
import { SITE_TITLE, SITE_DESCRIPTION, POSTS_BASE } from '../../site.config.mjs';

export async function GET(context) {
  const posts = await publishedPosts();
  return rss({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    site: context.site,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      categories: post.data.tags,
      link: `${POSTS_BASE}/${post.id}/`,
    })),
  });
}

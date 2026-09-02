// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { SITE_URL } from './site.config.mjs';

export default defineConfig({
  site: SITE_URL,
  output: 'static',
  integrations: [sitemap({ filter: (page) => !page.includes('/404') })],
  markdown: {
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } },
  },
});

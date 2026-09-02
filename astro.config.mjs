// @ts-check
import { writeFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { SITE_URL } from './site.config.mjs';

/**
 * GitHub Pages needs a CNAME file in the published output to keep a custom
 * domain attached across Actions deploys.
 *
 * Generated from SITE_URL rather than committed as `public/CNAME`, so the
 * domain still has exactly one definition. Two files naming the domain is the
 * drift this project keeps designing against — a wrong URL here would put a
 * wrong link in a LinkedIn post that cannot be edited.
 */
/** @type {import('astro').AstroIntegration} */
const cname = {
  name: 'cname-from-site-url',
  hooks: {
    'astro:build:done': ({ dir }) => {
      writeFileSync(new URL('CNAME', dir), `${new URL(SITE_URL).hostname}\n`);
    },
  },
};

export default defineConfig({
  site: SITE_URL,
  output: 'static',
  integrations: [sitemap({ filter: (page) => !page.includes('/404') }), cname],
  markdown: {
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } },
  },
});

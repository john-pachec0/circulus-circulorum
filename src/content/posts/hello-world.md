---
title: How this blog works
description: An Obsidian vault that is also an Astro site, and a workflow that prepares LinkedIn posts I never have to think about.
pubDate: 2026-09-02
tags:
  - meta
draft: false
linkedinText: |-
  I built a blog that I write in Obsidian and publish with a git push.

  The part I like: I don't have a LinkedIn integration. On publish, a GitHub
  Action opens an issue containing the exact text of the post I'd want here,
  plus the link for the first comment. I paste it when I feel like it.

  The version with an API integration needed OAuth, a credential that expires
  annually, and a ledger to stop it publishing twice. This version needs a
  clipboard.
---

This repository is two things at once. Open it in Obsidian and it is a vault.
Point Astro at it and it is a website. There is no export step between them —
the markdown file I am typing into right now is the one that gets built.

![A small circle](attachments/circulus.png)

## Publishing

Set `draft: false`, push, done. Drafts stay in the repository, visible in the
vault and in `astro dev`, and are excluded from anything the build emits.

## The LinkedIn part

If a post has a `linkedinText` field, a workflow opens an issue containing the
text to paste and the link for the first comment. That's the whole integration.

The first design used the LinkedIn API and could publish on its own. It also
needed an OAuth bootstrap, a refresh token with a 365-day life, a scheduled job
to warn me before it expired, and a ledger written back into the post's own
frontmatter to guarantee it never published twice — which an adversarial review
found it would, the first time a git push failed.

Trading thirty seconds of copy-paste for all of that was not a hard call.

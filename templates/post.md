---
# Filename must be kebab-case — my-new-post.md — because it becomes the URL,
# and `npm run build` fails on anything else. Published slugs are permanent:
# renaming breaks links already pasted to LinkedIn and orphans the comments.
title: 
description: 
pubDate: {{date:YYYY-MM-DD}}
tags:
  - 
# Stays true until you mean it. Drafts are committed and visible in the vault
# and in `npm run dev`, and appear nowhere in the built site or the feed.
draft: true
#
# Want it prepared for LinkedIn too? Uncomment and fill in the block below.
# Its presence is the entire opt-in — there is no separate flag.
#   · plain text, no markdown (LinkedIn renders none of it)
#   · no URL — the link goes in the follow-up comment the Action writes for you
#   · 3000 characters max, never truncated; over it, the build fails
# Do NOT leave `linkedinText:` as an empty key — the build rejects that rather
# than silently skipping the post.
#
# linkedinText: |-
#   A standalone teaser. It has to stand on its own, because it carries no
#   link.
#
#   Literal line breaks between paragraphs.
---


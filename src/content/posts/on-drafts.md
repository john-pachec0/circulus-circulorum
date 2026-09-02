---
title: A post that isn't finished
description: Demonstrates the default — a note with no draft key is a draft.
pubDate: 2026-09-02
tags:
  - meta
---

This file has **no `draft` key at all**, which is the point of it.

`draft` defaults to `true`, so this note is visible in the vault and in
`astro dev` and appears nowhere in the built site. Omission means unpublished;
you have to say `draft: false` on purpose.

That default is stated twice — once in the content collection schema for Astro,
and once explicitly in `scripts/posts.mjs`, which reads raw YAML where an
omitted key is `undefined` rather than `true`. Getting that wrong would offer a
LinkedIn link to a page the build never emitted, so both sides say
`draft === false` and there is a test for exactly this case.

Delete this file whenever it stops being useful as a reminder.

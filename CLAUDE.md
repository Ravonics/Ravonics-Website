# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Static HTML marketing site for **Ravonics LLC** (defense/federal tech contractor), deployed to `ravonics.com`. Built on a **purchased Bootstrap "designesia" template**. Pure HTML + CSS + vanilla JS — no framework, no `package.json`, no build step. To preview, open an HTML file directly or serve the directory statically.

## THE IRON RULE: copy-only edits

This is a paid template. The layout, CSS, and per-element character budgets are deliberate and **paid for**. We are doing a **copywriting pass only** — edit human-readable **text nodes** and meta/JSON-LD text *values* only.

**FORBIDDEN** (this got a prior attempt rejected): any `<style>`/CSS change, any new/edited `class`/`id`, adding/removing any DOM element, changing the number of cards/slots/testimonials/team members, changing Bootstrap grid classes (`col-lg-*`, `row`), changing `<img src>`/icons/link structure, or changing an element's text length by more than ~±15%.

Acceptance gate: a structural fingerprint (counts of `<div`, `class=`, `<style`, `col-`) must stay identical per file. Text-only edits leave it unchanged. Full rules: @.copy-rewrite-protocol.md

## Canonical facts

`@.build-spec.md` is the single source of truth for all verified identifiers and claims. Use those exact values everywhere (footers, contact page, JSON-LD) — no paraphrase or abbreviation. Key compliance constraints:
- **HUBZone**: application pending — NEVER state as "certified."
- **SAM.gov**: phrase as "SAM.gov registered (Active)"; do NOT print the expiration date publicly.
- No fabricated testimonials, team faces, or `aggregateRating`. The build-spec lists fabricated identifiers (old UEI/CAGE/DUNS) that must not reappear.

## Directories — not all are live

- Root + `capabilities/ solutions/ industries/ company/ insights/` — live production pages.
- `template/` — pristine untouched vendor template (freight/logistics demo). Reference only, never the live site; excluded from crawlers.
- `_preview-*.html` and `styles/*.html` — color-scheme experiments, not production. The active scheme in `index.html` is `css/colors/scheme-01.css`.

## Workflow

- **No local builds.** CI is the GitLab `DroidOpsInc/launch-sequence` static-site pipeline.
- **Commit locally; do NOT push upstream without explicit approval.**
- `booking.html` is wired to a D365 lead intake via a Logic App — preserve that integration when editing.

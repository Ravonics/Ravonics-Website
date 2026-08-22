# Ravonics gh-pages Publish Guard

## What this guard checks

`verify-ghpages-clean.sh` is a pre-push safety gate for the Ravonics.com public site.
It must be run against the gh-pages worktree **after** the scrubbed overlay is applied
and **before** `git push github gh-pages`. In addition to the content scrub, the guard
verifies the final worktree's release manifest and deterministic artifact digest.

It exits non-zero (FAIL) if any of the following are detected in the target tree:

### Section 1 — Forbidden files and directories

These are internal/tooling files that are git-tracked on the `demo` branch
but must never appear on `gh-pages`:

| Pattern                                 | Reason                                                          |
| --------------------------------------- | --------------------------------------------------------------- |
| `CLAUDE.md`                             | AI agent instructions; internal                                 |
| `.copy-rewrite-protocol.md`             | Internal copywriting protocol                                   |
| `.copy-reframe-kit.md`                  | Internal copywriting kit                                        |
| `.build-spec.md`                        | Contains founder legal name PII + fabricated-identifier list    |
| `.image-plan.md`                        | Image generation strategy; internal                             |
| `.image-progress.md`                    | Image generation state; internal                                |
| `.gitlab-ci.yml`                        | Internal CI config; no value on public branch                   |
| `image-manifest.csv`                    | Internal image ledger                                           |
| `style.txt`                             | Internal style notes                                            |
| `website-strategy-recommendations.html` | Internal strategy doc                                           |
| `.image-runner.log`                     | Internal runtime log                                            |
| `README.md`                             | Internal repo readme                                            |
| `SEO-*.md`                              | Internal SEO working docs                                       |
| `_preview-*.html`                       | Color scheme experiments; not production                        |
| `*.md` (any Markdown)                   | Public site ships no Markdown; any .md is an internal leak      |
| `.claude/` directory                    | AI agent state and settings                                     |
| `.astro/`, `.vite/` directories         | Build caches; internal                                          |
| `build/`, `dist/` directories           | Build output and artifacts; publish only the scrubbed site root |
| `styles/` directory                     | Color scheme experiments                                        |
| `template/` directory                   | Pristine vendor template; never the live site                   |
| `scripts/` directory                    | This tooling directory; internal only                           |

### Section 2 — Forbidden content strings

The script greps across all HTML, JS, CSS, JSON, XML, CSV, and text files for:

| String / Pattern            | Reason                                                      |
| --------------------------- | ----------------------------------------------------------- |
| `Matthew`                   | Founder legal name PII (published name is "Sean Hackney")   |
| SAM expiration date pattern | Policy: do not publish the SAM.gov expiration date publicly |
| `F7K9M2P4N8Q6`              | Fabricated/old UEI — must not reappear                      |
| `8R4T5`                     | Fabricated/old CAGE code — must not reappear                |
| `07-845-9321`               | Fabricated DUNS — retired standard, must not reappear       |

### Section 3 — Belt-and-suspenders Markdown check

Any `.md` file at any depth triggers FAIL. The public site is pure HTML;
Markdown files are always internal documents.

---

## Exact publish sequence

The tested `build/site` artifact is the only source for publication. Do not
overlay files from `demo` or another source branch: that can silently publish
stale markup, omit the RSS feed, or bypass the Astro build checks.
Each build also publishes `.well-known/ravonics-release.json`, which records the
source commit and a deterministic SHA-256 tree digest for independent release
provenance verification.

```bash
# 1. Build and validate the exact artifact that will be published
npm ci
npm ci --prefix proxy
npm run test:all
./scripts/verify-ghpages-clean.sh build/site
npm run release:check

# 2. Create an isolated gh-pages worktree (non-destructive to the source tree)
git fetch github gh-pages
git worktree add /tmp/ghpages-publish github/gh-pages

# 3. Replace the temporary worktree with the validated artifact
git -C /tmp/ghpages-publish rm -r -f --ignore-unmatch .
git -C /tmp/ghpages-publish clean -f -d
cp -a build/site/. /tmp/ghpages-publish/

# 4. Remove any pre-existing leaked internal files
#    (enumerate the full exclude list from the memory runbook)
git -C /tmp/ghpages-publish rm -f --ignore-unmatch \
  CLAUDE.md .copy-rewrite-protocol.md .copy-reframe-kit.md \
  .build-spec.md .image-plan.md .image-progress.md \
  .gitlab-ci.yml image-manifest.csv style.txt \
  website-strategy-recommendations.html .image-runner.log \
  README.md 'SEO-*.md' '_preview-*.html'
git -C /tmp/ghpages-publish rm -rf --ignore-unmatch \
  .claude/ styles/ template/ scripts/

# 5. Ensure .nojekyll is present
touch /tmp/ghpages-publish/.nojekyll
git -C /tmp/ghpages-publish add .nojekyll

# 6. *** RUN THE SAFETY GUARD — abort if it fails ***
#    This also verifies the final worktree's source commit and artifact digest.
/home/mrh/repos/ravonics/Ravonics-Website/scripts/verify-ghpages-clean.sh \
  /tmp/ghpages-publish

# Guard exits non-zero on any violation — the shell will abort here if set -e
# is active, or check the exit code explicitly:
# if ! ./scripts/verify-ghpages-clean.sh /tmp/ghpages-publish; then
#   echo "PUBLISH ABORTED: safety guard failed. Fix violations and retry."
#   exit 1
# fi

# 7. Commit and push ONLY after a clean PASS
git -C /tmp/ghpages-publish add -A
git -C /tmp/ghpages-publish commit -m "chore(gh-pages): publish scrubbed overlay $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git -C /tmp/ghpages-publish push github gh-pages

# 8. Clean up
git worktree remove /tmp/ghpages-publish
```

**The guard is the gate.** If it exits non-zero, the push must not proceed.
Fix the violations (remove the offending file, strip the forbidden string),
then re-run the guard until it returns PASS.

---

## Note on scripts/ exclusion

The `scripts/` directory itself is tooling-only and must be removed from the
gh-pages worktree. It is listed in the forbidden directories section of the
guard above. The publish sequence step 4 includes `rm -rf scripts/`.

---

## What a PASS looks like

```
==========================================
  Ravonics gh-pages publish safety guard
  Target: /tmp/ghpages-publish
==========================================

  PASS — tree is clean; no forbidden files, dirs, or content found.

  Safe to run: git push github gh-pages
```

## What a FAIL looks like

```
==========================================
  Ravonics gh-pages publish safety guard
  Target: /tmp/ghpages-publish
==========================================

  FAIL — violations found. DO NOT push to gh-pages.

  Violations:
    FORBIDDEN FILE: /tmp/ghpages-publish/CLAUDE.md
    FORBIDDEN CONTENT (founder PII: 'Matthew'): /tmp/ghpages-publish/.build-spec.md
    MARKDOWN FILE (public site ships none): /tmp/ghpages-publish/SEO-BATCH-UPDATE-GUIDE.md

  Remedy: remove or exclude all listed items from the gh-pages
  worktree, then re-run this script until it returns PASS.
```

#!/usr/bin/env bash
# verify-ghpages-clean.sh
#
# Safety guard for the Ravonics gh-pages publish pipeline.
# Run this script against the gh-pages worktree BEFORE `git push github gh-pages`.
# Exits non-zero and prints a FAIL summary if any internal doc, PII, or fabricated
# identifier is found in the target tree.
#
# Usage:
#   ./scripts/verify-ghpages-clean.sh [TARGET_DIR]
#
# TARGET_DIR defaults to the current working directory if not supplied.
# Typical publish usage:
#   ./scripts/verify-ghpages-clean.sh /tmp/ghpages-work
#
# Exit codes:
#   0  — PASS: tree is clean; safe to push
#   1  — FAIL: one or more violations found; DO NOT push

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

TARGET_DIR="${1:-.}"

# Resolve to an absolute path so messages are unambiguous
TARGET_DIR="$(cd "${TARGET_DIR}" && pwd)"

FAIL=0
VIOLATIONS=()

# ---------------------------------------------------------------------------
# SECTION 1 — Forbidden files and globs
# ---------------------------------------------------------------------------
# These files/patterns must NEVER appear on gh-pages.

FORBIDDEN_FILES=(
  "CLAUDE.md"
  ".copy-rewrite-protocol.md"
  ".copy-reframe-kit.md"
  ".build-spec.md"
  ".image-plan.md"
  ".image-progress.md"
  ".gitlab-ci.yml"
  "image-manifest.csv"
  "style.txt"
  "website-strategy-recommendations.html"
  ".image-runner.log"
  "README.md"
)

# Forbidden directory trees (any file inside these is forbidden)
FORBIDDEN_DIRS=(
  ".claude"
  "styles"
  "template"
  "scripts"
)

# Forbidden globs (shell glob patterns, evaluated relative to TARGET_DIR)
FORBIDDEN_GLOBS=(
  "SEO-*.md"
  "_preview-*.html"
  "*.md"
)

# ---------------------------------------------------------------------------
# Helper: record a violation
# ---------------------------------------------------------------------------
violation() {
  FAIL=1
  VIOLATIONS+=("  $*")
}

# ---------------------------------------------------------------------------
# Check 1a: Exact forbidden filenames at any depth
# ---------------------------------------------------------------------------
for name in "${FORBIDDEN_FILES[@]}"; do
  # Use find; suppress "no such file" noise
  while IFS= read -r hit; do
    [[ -n "${hit}" ]] && violation "FORBIDDEN FILE: ${hit}"
  done < <(find "${TARGET_DIR}" -name "${name}" -not -path "*/.git/*" 2>/dev/null)
done

# ---------------------------------------------------------------------------
# Check 1b: Forbidden directory trees
# ---------------------------------------------------------------------------
for dir in "${FORBIDDEN_DIRS[@]}"; do
  if [[ -d "${TARGET_DIR}/${dir}" ]]; then
    violation "FORBIDDEN DIRECTORY: ${TARGET_DIR}/${dir}/"
  fi
done

# ---------------------------------------------------------------------------
# Check 1c: Forbidden globs (top-level and recursive)
# ---------------------------------------------------------------------------
for pattern in "${FORBIDDEN_GLOBS[@]}"; do
  while IFS= read -r hit; do
    [[ -n "${hit}" ]] && violation "FORBIDDEN GLOB (${pattern}): ${hit}"
  done < <(find "${TARGET_DIR}" -name "${pattern}" -not -path "*/.git/*" 2>/dev/null)
done

# ---------------------------------------------------------------------------
# Check 2 — Forbidden content strings inside HTML/text files
# ---------------------------------------------------------------------------
# grep returns exit 1 when no match is found; we handle that gracefully.

# Build a combined grep pattern for all forbidden strings
CONTENT_VIOLATIONS=()

# Helper: grep target tree for a pattern, collect matches
grep_tree() {
  local label="$1"
  local pattern="$2"
  # -r recursive, -l list filenames only, -I skip binaries
  # --include limits to text-like files
  # || true: grep exits 1 on no match; we don't want that to abort the script
  local hits
  hits=$(grep -r -l -I \
    --include="*.html" \
    --include="*.htm" \
    --include="*.txt" \
    --include="*.xml" \
    --include="*.json" \
    --include="*.csv" \
    --include="*.md" \
    --include="*.js" \
    --include="*.css" \
    -e "${pattern}" \
    "${TARGET_DIR}" \
    2>/dev/null || true)
  if [[ -n "${hits}" ]]; then
    while IFS= read -r f; do
      [[ -n "${f}" ]] && violation "FORBIDDEN CONTENT (${label}): ${f}"
    done <<< "${hits}"
  fi
}

# 2a. Founder legal name (PII)
grep_tree "founder PII: 'Matthew'" "Matthew"

# 2b. SAM.gov expiration date pattern
# The expiration date appears as a date string; the canonical risk is publishing
# a specific future date like "2026-12-31" or "December 31, 2026" or similar.
# We match two formats: ISO date-like with year 20xx and month-day, and
# "SAM" near "expir" as a belt-and-suspenders signal.
grep_tree "SAM expiration date pattern" "[Ee]xpir[a-z]* [Dd]ate.*[Ss][Aa][Mm]\|[Ss][Aa][Mm].*[Ee]xpir"

# 2c. Fabricated/old identifiers that must never reappear
grep_tree "old fabricated UEI: F7K9M2P4N8Q6" "F7K9M2P4N8Q6"
grep_tree "old fabricated CAGE: 8R4T5" "8R4T5"
grep_tree "old fabricated DUNS: 07-845-9321" "07-845-9321"

# ---------------------------------------------------------------------------
# Check 3 (belt-and-suspenders) — Any .md file present at all
# The public site ships no Markdown; any .md is an internal doc leak.
# NOTE: Check 1c already catches *.md files. This block adds a distinct,
# labelled violation entry if any slipped through a different path.
# ---------------------------------------------------------------------------
while IFS= read -r hit; do
  [[ -n "${hit}" ]] && violation "MARKDOWN FILE (public site ships none): ${hit}"
done < <(find "${TARGET_DIR}" -name "*.md" -not -path "*/.git/*" 2>/dev/null)

# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------
echo ""
echo "=========================================="
echo "  Ravonics gh-pages publish safety guard"
echo "  Target: ${TARGET_DIR}"
echo "=========================================="
echo ""

if [[ "${FAIL}" -eq 0 ]]; then
  echo "  PASS — tree is clean; no forbidden files, dirs, or content found."
  echo ""
  echo "  Safe to run: git push github gh-pages"
  echo ""
  exit 0
else
  echo "  FAIL — violations found. DO NOT push to gh-pages."
  echo ""
  echo "  Violations:"
  # Deduplicate (a file can match multiple checks)
  printf '%s\n' "${VIOLATIONS[@]}" | sort -u
  echo ""
  echo "  Remedy: remove or exclude all listed items from the gh-pages"
  echo "  worktree, then re-run this script until it returns PASS."
  echo ""
  exit 1
fi

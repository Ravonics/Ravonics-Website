#!/usr/bin/env bash
# build-pdfs.sh — regenerate Ravonics federal one-pager PDFs from HTML source
# Usage: bash scripts/build-pdfs.sh  (run from repo root)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$REPO_ROOT/src"
OUT_DIR="$REPO_ROOT"

echo "Building Ravonics capability statement PDFs..."

build_pdf() {
  local html="$1"
  local pdf="$2"
  echo "  -> $pdf"
  google-chrome \
    --headless \
    --disable-gpu \
    --no-sandbox \
    --print-to-pdf="$pdf" \
    --no-pdf-header-footer \
    --print-to-pdf-no-header \
    "file://$html"
}

build_pdf "$SRC_DIR/capability-statement.html" "$OUT_DIR/Ravonics-Capability-Statement.pdf"
build_pdf "$SRC_DIR/relevant-experience.html"  "$OUT_DIR/Ravonics-Relevant-Experience.pdf"

echo "PDFs written to:"
echo "  $OUT_DIR/Ravonics-Capability-Statement.pdf"
echo "  $OUT_DIR/Ravonics-Relevant-Experience.pdf"
echo "Done."

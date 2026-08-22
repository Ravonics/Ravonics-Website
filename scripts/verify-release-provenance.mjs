#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './site-routes.mjs';
import { artifactDigest, currentSourceCommit, RELEASE_MANIFEST_PATH } from './release-provenance.mjs';

const target = path.resolve(process.argv[2] || path.join(ROOT, 'build', 'site'));
const manifestFile = path.join(target, RELEASE_MANIFEST_PATH);
const packageJson = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
const expectedSource = process.env.RAVONICS_EXPECTED_SOURCE?.trim() || currentSourceCommit(ROOT);
const actualDigest = await artifactDigest(target);

if (manifest.schemaVersion !== 1) {
  throw new Error(`Unsupported release manifest schema: ${manifest.schemaVersion}`);
}
if (manifest.siteVersion !== packageJson.version) {
  throw new Error(
    `Release version mismatch: expected ${packageJson.version}, received ${manifest.siteVersion}`
  );
}
if (expectedSource !== 'unknown' && manifest.sourceCommit !== expectedSource) {
  throw new Error(`Release source mismatch: expected ${expectedSource}, received ${manifest.sourceCommit}`);
}
if (!/^[a-f0-9]{64}$/.test(manifest.artifactSha256) || manifest.artifactSha256 !== actualDigest) {
  throw new Error(
    `Release artifact digest mismatch: expected ${manifest.artifactSha256}, computed ${actualDigest}`
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      target,
      siteVersion: manifest.siteVersion,
      sourceCommit: manifest.sourceCommit,
      artifactSha256: actualDigest
    },
    null,
    2
  )
);

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const RELEASE_MANIFEST_PATH = '.well-known/ravonics-release.json';

async function listFiles(directory, prefix = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path.join(directory, entry.name), relative)));
    } else {
      files.push(relative);
    }
  }
  return files;
}

export async function artifactDigest(directory) {
  const digest = crypto.createHash('sha256');
  const files = (await listFiles(directory))
    .map((file) => file.split(path.sep).join('/'))
    .filter((file) => file !== RELEASE_MANIFEST_PATH)
    .sort();

  for (const relative of files) {
    digest.update(relative);
    digest.update('\0');
    digest.update(await fs.readFile(path.join(directory, relative)));
    digest.update('\0');
  }

  return digest.digest('hex');
}

export function currentSourceCommit(root) {
  const fromEnvironment = process.env.GITHUB_SHA?.trim();
  if (fromEnvironment) return fromEnvironment;

  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8'
  });
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  return 'unknown';
}

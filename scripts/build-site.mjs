#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './site-routes.mjs';
import { artifactDigest, currentSourceCommit, RELEASE_MANIFEST_PATH } from './release-provenance.mjs';

const output = path.join(ROOT, 'build', 'site');
const buildRoot = path.dirname(output);
const lockPath = path.join(buildRoot, '.site-build.lock');
const sitePackage = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
const fontAssets = [
  'elegant_font/HTML_CSS/style.css',
  'elegant_font/HTML_CSS/fonts',
  'et-line-font/style.css',
  'et-line-font/fonts',
  'icofont/icofont.min.css',
  'icofont/fonts',
  'fontawesome4/css/font-awesome.css',
  'fontawesome4/fonts',
  'fontawesome6/css/brands.css',
  'fontawesome6/css/fontawesome.css',
  'fontawesome6/css/solid.css',
  'fontawesome6/webfonts'
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
}

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

async function copyFontAssets(staging) {
  for (const relative of fontAssets) {
    const source = path.join(ROOT, 'fonts', relative);
    const target = path.join(staging, 'fonts', relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(source, target, { recursive: true });
  }
}

async function acquireBuildLock() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      await handle.writeFile(`${process.pid}\n`);
      return handle;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;

      const owner = await fs.readFile(lockPath, 'utf8').catch(() => '');
      const pid = Number.parseInt(owner, 10);
      if (pid && pid !== process.pid) {
        try {
          process.kill(pid, 0);
        } catch (probeError) {
          if (probeError.code === 'ESRCH') {
            await fs.unlink(lockPath).catch((unlinkError) => {
              if (unlinkError.code !== 'ENOENT') throw unlinkError;
            });
            continue;
          }
        }
      }
      throw new Error(`Another site build is already running (lock: ${lockPath}).`);
    }
  }
  throw new Error(`Could not acquire site build lock: ${lockPath}`);
}

async function releaseBuildLock(handle) {
  if (!handle) return;
  await handle.close();
  await fs.unlink(lockPath).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

await fs.mkdir(buildRoot, { recursive: true });
let lockHandle = null;
let staging = null;
let previous = null;

try {
  lockHandle = await acquireBuildLock();
  staging = await fs.mkdtemp(path.join(buildRoot, '.site-staging-'));
  // Build into an invocation-specific directory so another build cannot delete
  // the tree currently being served by Playwright or a local preview process.
  run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['astro', 'build', '--outDir', staging]);

  for (const directory of ['css', 'images', 'js']) {
    await fs.cp(path.join(ROOT, directory), path.join(staging, directory), { recursive: true });
  }
  await copyFontAssets(staging);
  for (const file of [
    'CNAME',
    'robots.txt',
    'sitemap.xml',
    'rss.xml',
    'Ravonics-Capability-Statement.pdf',
    'Ravonics-Relevant-Experience.pdf'
  ]) {
    await fs.copyFile(path.join(ROOT, file), path.join(staging, file));
  }

  // Public form endpoints contain no secrets. The publish script injects the
  // same proxy-only contract into the generated pages as the existing release
  // workflow, so Astro output cannot silently ship forms without endpoints.
  run('bash', ['scripts/inject-endpoints.sh', staging], {
    env: {
      ...process.env,
      RAVONICS_PROXY_BASE:
        process.env.RAVONICS_PROXY_BASE || 'https://ravonicsapi-adcah9bdahb4hca0.z02.azurefd.net/api'
    }
  });
  await fs.writeFile(path.join(staging, '.nojekyll'), '');

  const releaseManifest = {
    schemaVersion: 1,
    siteVersion: sitePackage.version,
    sourceCommit: currentSourceCommit(ROOT),
    artifactSha256: await artifactDigest(staging)
  };
  const releaseManifestFile = path.join(staging, RELEASE_MANIFEST_PATH);
  await fs.mkdir(path.dirname(releaseManifestFile), { recursive: true });
  await fs.writeFile(releaseManifestFile, `${JSON.stringify(releaseManifest, null, 2)}\n`);

  const forbidden = ['CLAUDE.md', 'README.md', 'scripts', 'proxy', 'src', 'template', 'styles', 'dist'];
  for (const entry of forbidden) {
    try {
      await fs.access(path.join(staging, entry));
      throw new Error(`Build output contains forbidden entry: ${entry}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  const vendorDocuments = (await listFiles(staging)).filter(
    (file) => file.startsWith(`fonts${path.sep}`) && /\.html?$/i.test(file)
  );
  if (vendorDocuments.length) {
    throw new Error(`Build output contains vendor documents: ${vendorDocuments.join(', ')}`);
  }

  // Replace the previous complete tree only after the new tree has passed all
  // checks. The lock makes this promotion a single-writer operation, so a
  // failed build cannot delete or restore over a concurrent successful build.
  previous = `${output}.previous-${process.pid}-${Date.now()}`;
  try {
    await fs.rename(output, previous);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    previous = null;
  }
  await fs.rename(staging, output);
  staging = null;
  if (previous) await fs.rm(previous, { recursive: true, force: true });
} catch (error) {
  if (previous) {
    try {
      await fs.rm(output, { recursive: true, force: true });
      await fs.rename(previous, output);
    } catch (restoreError) {
      error.message += ` (also failed to restore previous build: ${restoreError.message})`;
    }
  }
  throw error;
} finally {
  try {
    if (staging) await fs.rm(staging, { recursive: true, force: true });
  } finally {
    await releaseBuildLock(lockHandle);
  }
}

console.log(`Static site built at ${output}`);

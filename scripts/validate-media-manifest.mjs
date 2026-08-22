#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './site-routes.mjs';

const file = path.join(ROOT, 'image-manifest.csv');
const source = fs.readFileSync(file, 'utf8');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (character === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1;
      row.push(value);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      value = '';
    } else {
      value += character;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  const [header, ...data] = rows;
  return data.map((cells) => Object.fromEntries(header.map((key, index) => [key, cells[index] || ''])));
}

const rows = parseCsv(source);
const required = [
  'id',
  'page',
  'slot',
  'current_path',
  'target_path',
  'width',
  'height',
  'formats',
  'status'
];
const header = (source.split(/\r?\n/, 1)[0] || '').split(',');
const errors = [];
for (const field of required) if (!header.includes(field)) errors.push(`missing column: ${field}`);

const ids = new Set();
const imageExtensions = ['avif', 'webp', 'jpg', 'jpeg', 'png'];

function mediaCandidates(value, formats) {
  const candidates = [value];
  const extension = path.extname(value);
  const stem = extension ? value.slice(0, -extension.length) : value;
  const preferred = formats.split(/[\s,|]+/).filter(Boolean);
  for (const format of [...preferred, ...imageExtensions]) {
    const candidate = `${stem}.${format}`;
    if (!candidates.includes(candidate)) candidates.push(candidate);
  }
  return candidates;
}

function resolveMediaPath(value, formats) {
  return mediaCandidates(value, formats)
    .map((candidate) => path.join(ROOT, candidate))
    .find((candidate) => fs.existsSync(candidate));
}

let substitutions = 0;
for (const row of rows) {
  if (ids.has(row.id)) errors.push(`duplicate id: ${row.id}`);
  ids.add(row.id);
  for (const field of ['current_path', 'target_path']) {
    if (!row[field]) errors.push(`${row.id}: missing ${field}`);
    else if (/^https?:\/\//i.test(row[field])) errors.push(`${row.id}: external ${field}`);
    else {
      const resolved = resolveMediaPath(row[field], row.formats);
      if (!resolved) errors.push(`${row.id}: missing file ${row[field]}`);
      else if (path.relative(ROOT, resolved) !== row[field]) substitutions += 1;
    }
  }
  if (!/^\d+$/.test(row.width) || !/^\d+$/.test(row.height)) errors.push(`${row.id}: invalid dimensions`);
  if (!['done', 'planned', 'review', 'blocked'].includes(row.status))
    errors.push(`${row.id}: invalid status ${row.status}`);
}

if (errors.length) {
  console.error(`Media manifest failed with ${errors.length} error(s):`);
  errors.slice(0, 50).forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
console.log(
  `Media manifest valid: ${rows.length} entries, ${ids.size} unique IDs (${substitutions} format substitutions resolved).`
);

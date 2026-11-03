import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'Pass the original website directory from commit 7ab95d7028291da9b1cda3d3793d69dea1b718b4');
const target = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = await readdir(source, { recursive: true, withFileTypes: true });
let count = 0;
let bytes = 0;
for (const entry of files) {
  if (!entry.isFile()) continue;
  const path = join(entry.parentPath, entry.name);
  const name = relative(source, path);
  if (name === 'README.md') continue;
  const original = await readFile(path);
  const imported = await readFile(join(target, name));
  const hash = value => createHash('sha256').update(value).digest('hex');
  assert.equal(hash(imported), hash(original), `Changed source file: ${name}`);
  count++;
  bytes += original.length;
}
assert.equal(count, 821, 'Unexpected source snapshot file count');
console.log(JSON.stringify({ sourceCommit: '7ab95d7028291da9b1cda3d3793d69dea1b718b4', unchangedFiles: count, unchangedBytes: bytes, allowedChange: 'README.md' }));

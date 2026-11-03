import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, relative, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'Pass the original website directory from commit 7ab95d7028291da9b1cda3d3793d69dea1b718b4');
const target = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceCommit = '7ab95d7028291da9b1cda3d3793d69dea1b718b4';
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trimEnd();
const sourceRoot = git(source, 'rev-parse', '--show-toplevel');
assert.equal(relative(sourceRoot, source), 'website', 'Pass the original website directory');
const entries = git(sourceRoot, 'ls-tree', '-r', '-z', `${sourceCommit}:website`).split('\0').filter(Boolean).map(entry => {
  const [metadata, name] = entry.split('\t');
  const [mode, kind, hash] = metadata.split(' ');
  assert.equal(kind, 'blob');
  return { mode, hash, name };
});
const delivered = git(target, 'ls-files', '-z').split('\0').filter(Boolean).sort();
assert.deepEqual(delivered, [...entries.map(entry => entry.name), 'scripts/verify-migration.mjs'].sort(), 'Unexpected or missing tracked files');
assert.equal(git(target, 'ls-files', '--others', '--exclude-standard'), '', 'Unexpected untracked files');
let count = 0;
let bytes = 0;
for (const { hash, name } of entries) {
  if (name === 'README.md') continue;
  const imported = await readFile(join(target, name));
  const actual = createHash('sha1').update(`blob ${imported.length}\0`).update(imported).digest('hex');
  assert.equal(actual, hash, `Changed source file: ${name}`);
  count++;
  bytes += imported.length;
}
assert.equal(count, 821, 'Unexpected source snapshot file count');
console.log(JSON.stringify({ sourceCommit, unchangedFiles: count, unchangedBytes: bytes, allowedChange: 'README.md', addedFile: 'scripts/verify-migration.mjs' }));

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';


const root = dirname(dirname(fileURLToPath(import.meta.url)));

before(() => {
  execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' });
});

function builtBackblast(slug: string): string {
  return readFileSync(join(root, 'dist', 'backblasts', slug, 'index.html'), 'utf8');
}

test('renders imported workout sections and exercises as semantic content', () => {
  const html = builtBackblast('2026-10-15-what-goes-up-must-come-down');

  assert.match(html, /class="backblast-content"/);
  assert.match(html, /<h2[^>]*>Warm Up<\/h2>/);
  assert.match(html, /<h2[^>]*>The Thang: Ladders \+ Incinerator = Fireman<\/h2>/);
  assert.match(html, /<ul>\s*<li>15 Michael Phelps<\/li>/);
  assert.match(html, /<h2[^>]*>CoT<\/h2>/);
});

test('preserves nested lists and fenced diagrams in structured posts', () => {
  const html = builtBackblast('2026-09-22-musical-chairs');

  assert.match(html, /<li>The setup:\s*<ul>/);
  assert.match(html, /<pre[^>]*data-language="text"[^>]*><code>/);
});

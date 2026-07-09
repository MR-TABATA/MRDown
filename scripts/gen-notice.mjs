// Regenerates THIRD-PARTY-NOTICES.md from the dependencies that actually ship
// inside the binary: the npm production closure (Vite bundles it into the
// webview) and the normal-kind Rust crates linked into the Tauri executable.
//
//   node scripts/gen-notice.mjs
//
// MIT, BSD and Apache all require the copyright and permission notices to be
// reproduced in binary redistributions, so each package's license *text* is
// carried here verbatim. Identical texts are emitted once and shared — Apache-2.0
// collapses hundreds of crates, while MIT texts stay distinct because each names
// its own copyright holder.
//
// The npm side is deliberately over-inclusive: `@types/*` packages emit no
// runtime code, but listing a package that isn't shipped violates nothing, while
// omitting one that is would.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'THIRD-PARTY-NOTICES.md');
const LICENSE_FILE = /^(LICEN[CS]E|COPYING|NOTICE)/i;

/** Every license/copying file in a package directory, concatenated. */
function readLicenseTexts(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => LICENSE_FILE.test(f)).sort();
  const parts = [];
  for (const f of files) {
    const p = path.join(dir, f);
    if (!fs.statSync(p).isFile()) continue;
    const body = fs.readFileSync(p, 'utf8').trim();
    if (body) parts.push(files.length > 1 ? `----- ${f} -----\n\n${body}` : body);
  }
  return parts.length ? parts.join('\n\n') : null;
}

/**
 * SPDX id for a package whose manifest declares none. A few packages (khroma)
 * ship the license text and nothing else, so read the identifier off the text
 * rather than labelling it UNKNOWN.
 */
function inferLicense(text) {
  if (!text) return 'UNKNOWN';
  const head = text.slice(0, 400);
  if (/MIT License/i.test(head)) return 'MIT';
  if (/ISC License/i.test(head)) return 'ISC';
  if (/Apache License/i.test(head)) return 'Apache-2.0';
  if (/BSD 3-Clause/i.test(head)) return 'BSD-3-Clause';
  if (/BSD 2-Clause/i.test(head)) return 'BSD-2-Clause';
  return 'UNKNOWN';
}

/** npm production closure, deduped by name (npm hoists one copy per name). */
function npmPackages() {
  const json = execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const seen = new Map();
  (function walk(deps) {
    for (const [name, node] of Object.entries(deps ?? {})) {
      if (node.version && !seen.has(name)) seen.set(name, node.version);
      walk(node.dependencies);
    }
  })(JSON.parse(json).dependencies);

  return [...seen].map(([name, version]) => {
    const dir = path.join(ROOT, 'node_modules', name);
    const manifest = path.join(dir, 'package.json');
    const pkg = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, 'utf8')) : {};
    const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
    const text = readLicenseTexts(dir);
    return {
      name,
      version,
      license: pkg.license ?? pkg.licenses?.map((l) => l.type).join(' OR ') ?? inferLicense(text),
      repo: (repo ?? pkg.homepage ?? '').replace(/^git\+|\.git$/g, ''),
      text,
      ecosystem: 'npm',
    };
  });
}

/** Rust crates reachable from the root crate through normal (linked) deps. */
function cargoPackages() {
  const json = execFileSync('cargo', ['metadata', '--format-version', '1'], {
    cwd: path.join(ROOT, 'src-tauri'),
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const meta = JSON.parse(json);
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));

  // Build scripts and dev-dependencies never reach the shipped binary; skip them.
  const linked = new Set();
  (function walk(id) {
    if (linked.has(id)) return;
    linked.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      const normal = dep.dep_kinds.some((k) => k.kind === null || k.kind === 'normal');
      if (normal) walk(dep.pkg);
    }
  })(meta.resolve.root ?? meta.workspace_members[0]);
  linked.delete(meta.resolve.root ?? meta.workspace_members[0]); // our own crate

  return [...linked].map((id) => {
    const p = byId.get(id);
    const dir = path.dirname(p.manifest_path);
    let text = readLicenseTexts(dir);
    // Some crates point at a license file instead of shipping a conventional name.
    if (!text && p.license_file) text = readLicenseTexts(path.dirname(path.join(dir, p.license_file)));
    return {
      name: p.name,
      version: p.version,
      license: p.license ?? 'UNKNOWN',
      repo: p.repository ?? '',
      text,
      ecosystem: 'cargo',
    };
  });
}

const packages = [...npmPackages(), ...cargoPackages()].sort(
  (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)
);

// Group by license text so Apache-2.0 and friends are printed once, not 300 times.
const groups = new Map();
const missing = [];
for (const p of packages) {
  if (!p.text) {
    missing.push(p);
    continue;
  }
  const key = createHash('sha256').update(p.text.replace(/\s+/g, ' ').trim()).digest('hex');
  if (!groups.has(key)) groups.set(key, { text: p.text, pkgs: [] });
  groups.get(key).pkgs.push(p);
}

const ordered = [...groups.values()].sort((a, b) => b.pkgs.length - a.pkgs.length);
const npmCount = packages.filter((p) => p.ecosystem === 'npm').length;
const cargoCount = packages.length - npmCount;

const out = [];
out.push('# サードパーティ・ライセンス / Third-Party Notices');
out.push('');
out.push('MRDown はオープンソースのソフトウェアを同梱して配布しています。');
out.push('以下は同梱物とその著作権表示・許諾条件です。MRDown 本体のライセンスは [LICENSE](LICENSE) を参照してください。');
out.push('');
out.push('MRDown bundles the open-source software listed below. Their copyright and');
out.push('permission notices are reproduced here as their licenses require. For MRDown');
out.push("itself, see [LICENSE](LICENSE).");
out.push('');
out.push(`同梱パッケージ数 / Bundled packages: **${packages.length}** (npm: ${npmCount}, Rust: ${cargoCount})`);
out.push('');
out.push('> このファイルは `node scripts/gen-notice.mjs` で生成されます。手で編集しないでください。');
out.push('> Generated by `node scripts/gen-notice.mjs` — do not edit by hand.');
out.push('');
out.push('## 一覧 / Index');
out.push('');
out.push('| Package | Version | License |');
out.push('| --- | --- | --- |');
for (const p of packages) {
  const name = p.repo ? `[${p.name}](${p.repo})` : p.name;
  out.push(`| ${name} | ${p.version} | ${p.license} |`);
}
out.push('');
out.push('## ライセンス本文 / License texts');
out.push('');

for (const g of ordered) {
  const names = g.pkgs.map((p) => `\`${p.name} ${p.version}\``).join(', ');
  // `text` keeps highlight.js from auto-detecting a language for every one of
  // these blocks — on 200+ license texts the guessing costs seconds.
  const fence = '`'.repeat(Math.max(3, ...[...g.text.matchAll(/^\s*(`{3,})/gm)].map((m) => m[1].length + 1)));
  out.push(`### ${g.pkgs[0].license}`);
  out.push('');
  out.push(names);
  out.push('');
  out.push(`${fence}text`);
  out.push(g.text);
  out.push(fence);
  out.push('');
}

if (missing.length) {
  out.push('## 本文を同梱できなかったパッケージ / Packages without a bundled license file');
  out.push('');
  out.push('これらは配布物にライセンス本文を含んでいません。SPDX 識別子の示す条件が適用されます。');
  out.push('These ship no license file; the terms of the named SPDX identifier apply.');
  out.push('');
  for (const p of missing) out.push(`- \`${p.name} ${p.version}\` — ${p.license}${p.repo ? ` — ${p.repo}` : ''}`);
  out.push('');
}

fs.writeFileSync(OUT, out.join('\n'));

console.log(`THIRD-PARTY-NOTICES.md: ${packages.length} packages, ${ordered.length} distinct license texts`);
if (missing.length) console.log(`license text missing for ${missing.length}: ${missing.map((p) => p.name).join(', ')}`);

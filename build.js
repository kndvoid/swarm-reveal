#!/usr/bin/env node
/*
 * Bundles the engine into a single file — no module graph, no cache cascade,
 * one request. Output: dist/swarm-reveal.js (self-booting) and
 * dist/swarm-reveal.manual.js (you call bootReveal() yourself).
 */
const fs = require('fs');
const path = require('path');

const order = ['util.js', 'sound.js', 'scan.js', 'reveal.js', 'index.js'];
const root = __dirname;
let out = `/*! swarm-reveal — MIT licensed. https://github.com/kndvoid/swarm-reveal */\n(function () {\n'use strict';\n`;
for (const f of order) {
  let s = fs.readFileSync(path.join(root, 'src', f), 'utf8');
  s = s.replace(/^\s*import\s+[^;]+;\s*$/gm, '');
  s = s.replace(/^export\s+(async\s+function|function|const|let|class|var)\s/gm, '$1 ');
  s = s.replace(/^export\s*\{[^}]*\};?\s*$/gm, '');
  out += `\n/* ---- ${f} ---- */\n` + s + '\n';
}
out += '\n})();\n';

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/swarm-reveal.manual.js'), out);
const auto = out.replace(/\n\}\)\(\);\n$/, "\ntry { bootReveal(); } catch (e) {}\n})();\n");
fs.writeFileSync(path.join(root, 'dist/swarm-reveal.js'), auto);
console.log('built dist/swarm-reveal.js (%d bytes) and dist/swarm-reveal.manual.js (%d bytes)', auto.length, out.length);

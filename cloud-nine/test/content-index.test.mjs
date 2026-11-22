import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import * as content from '../js/content/index.js';

const DIR = new URL('../js/content/', import.meta.url);

test('index: the whole Contract 8 interface in one import', () => {
  for (const name of ['hype', 'createHype', 'EMOTES', 'cleanEmote', 'randomNick', 'cleanNick', 'birthdayInfo', 'FAMILY_NOTES',
    'cleanNote', 'GLOSSARY', 'trickLabel', 'HOWTO', 'gameTitle', 'SPIRIT_STICKS', 'cleanFoundSticks']) {
    assert.ok(name in content, `index exports ${name}`);
  }
  assert.equal(typeof content.hype('welcome', { name: 'Bailey' }), 'string');
});

test('index: no two modules export the same name (export * would hide it)', () => {
  const seen = new Map();
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.js') && f !== 'index.js')) {
    const src = readFileSync(new URL(file, DIR), 'utf8');
    for (const [, name] of src.matchAll(/^export (?:const|function|let|class) (\w+)/gm)) {
      assert.ok(!seen.has(name), `${name} is exported by both ${seen.get(name)} and ${file}`);
      seen.set(name, file);
    }
  }
});

test('content modules are pure: no DOM, storage, network, timers or three.js', () => {
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.js'))) {
    const code = readFileSync(new URL(file, DIR), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    assert.ok(!/\b(window|document|localStorage|sessionStorage|fetch|XMLHttpRequest|setTimeout|setInterval|THREE|navigator)\b/.test(code), file);
    for (const [, spec] of code.matchAll(/from '([^']+)'/g)) {
      assert.ok(spec.startsWith('./') || spec === '../config.js', `${file} imports ${spec}`);
      assert.ok(spec.endsWith('.js'), `${file}: imports end in .js`);
    }
  }
});

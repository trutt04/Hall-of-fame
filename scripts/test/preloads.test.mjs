import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PAGE, WORLD_DIR, moduleList, withFreshList } from '../preloads.mjs';

test('world/index.html: the preload list matches the files the world really loads', () => {
  const html = fs.readFileSync(PAGE, 'utf8');
  const fresh = withFreshList(html);
  assert.notEqual(fresh, null, 'world/index.html is missing the modulepreload markers');
  assert.equal(html, fresh, 'the preload list is out of date: run npm run preloads');
});

test('world: every preloaded file exists and the flow modules are included', () => {
  const list = moduleList();
  assert.ok(list.length > 20, 'the import walk found the world modules');
  assert.equal(new Set(list).size, list.length, 'no file is listed twice');
  for (const rel of list) assert.ok(fs.existsSync(path.join(WORLD_DIR, rel)), `${rel} exists`);
  assert.ok(list[0].includes('three.'), 'the 3D library is first');
  assert.ok(list.includes('js/ui/flow.js'), 'the dynamically imported flow is preloaded too');
  assert.ok(list.includes('js/model/derive.js'));
});

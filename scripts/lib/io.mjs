/**
 * io.mjs
 *
 * Small file helpers for the sync: tolerant JSON reads, atomic JSON writes, a readable
 * JSON layout, and "did anything real change?" comparisons.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Read a file as text, or null if it does not exist. */
export function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

/** Read and parse JSON. Returns null when the file is missing or is not valid JSON. */
export function readJson(file) {
  const text = readText(file);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Write a file so that readers never see half of it: write a temp file next to it,
 * then rename over the target (rename is atomic on the same filesystem).
 */
export function writeFileAtomic(file, text) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, file);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* already renamed */
    }
  }
}

function inline(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`;
  const parts = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`);
  return parts.length ? `{ ${parts.join(', ')} }` : '{}';
}

/**
 * JSON that is pleasant to read and to diff: short objects and arrays stay on one line,
 * long ones are broken up. Always valid JSON, always ends with a newline.
 */
export function prettyJson(value, { width = 110, indent = 2 } = {}) {
  const format = (v, depth) => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
    const oneLine = inline(v);
    if (depth > 0 && oneLine.length + depth * indent <= width) return oneLine;
    const pad = ' '.repeat((depth + 1) * indent);
    const end = ' '.repeat(depth * indent);
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]';
      return `[\n${v.map((item) => pad + format(item, depth + 1)).join(',\n')}\n${end}]`;
    }
    const entries = Object.entries(v).filter(([, item]) => item !== undefined);
    if (entries.length === 0) return '{}';
    return `{\n${entries.map(([k, item]) => `${pad}${JSON.stringify(k)}: ${format(item, depth + 1)}`).join(',\n')}\n${end}}`;
  };
  return format(value, 0) + '\n';
}

export function writeJsonAtomic(file, value) {
  writeFileAtomic(file, prettyJson(value));
}

/** JSON with keys sorted at every level, for comparing two objects. */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Same content, ignoring the top-level generatedAt stamp? */
export function sameIgnoringStamp(a, b) {
  if (!isObj(a) || !isObj(b)) return false;
  const strip = ({ generatedAt, ...rest }) => rest;
  return stableStringify(strip(a)) === stableStringify(strip(b));
}

/** Names of the top-level sections that differ between two objects (ignoring generatedAt). */
export function changedSections(before, after) {
  if (!isObj(before)) return ['everything (no usable previous file)'];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  keys.delete('generatedAt');
  return [...keys].filter((k) => stableStringify(before[k]) !== stableStringify(after[k]));
}

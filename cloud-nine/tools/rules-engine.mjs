// A small evaluator for Firebase Realtime Database security rules (the subset Cloud Nine uses), so
// tests can run the real firebase/database.rules.json against simulated devices. Test tooling only.
//
//   const rules = compileRules(json)                    json = the parsed rules file ({ rules: {...} })
//   rules.canRead(path, { auth, root, now }) -> { ok, reason }
//   rules.canWrite(path, value, ctx) -> { ok, reason }      one location (set / remove)
//   rules.canUpdate(path, updates, ctx) -> { ok, reason }   several locations at once (update), atomic
//   rules.lint() -> [problems]                              expressions that don't parse, risky regexes
//   applyAt(tree, segs, value) / getAt(tree, segs) / splitPath(path)
//
// Semantics, as documented by Firebase:
// - .read and .write cascade: access granted at a path covers everything below it. A write needs a
//   .write that is true at the written location or above; rules deeper down are not consulted.
// - .validate runs on every node of the new data at and below each written location, and on the
//   nodes above it, but never on deleted (null) data. It does not cascade.
// - Named children win over a $wildcard, which binds its variable for the expressions below.
// - Expressions are typed: comparing mismatched types, reading a property of null, or calling
//   anything unknown is an error, and an error makes the rule false.
// - In rules, `now` is the server time; serverTimestamp() values are resolved to it first.

export function splitPath(path) {
  return String(path || '')
    .split('/')
    .filter((s) => s.length > 0);
}

export function getAt(tree, segs) {
  let v = tree;
  for (const s of segs) {
    if (v === null || typeof v !== 'object' || !Object.prototype.hasOwnProperty.call(v, s)) return null;
    v = v[s];
  }
  return v === undefined ? null : v;
}

function prune(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') return v;
  const out = {};
  let n = 0;
  for (const k of Object.keys(v)) {
    const c = prune(v[k]);
    if (c !== null) {
      out[k] = c;
      n++;
    }
  }
  return n ? out : null;
}

// A copy of tree with value placed at segs (null deletes). Empty objects disappear, as in Firebase.
export function applyAt(tree, segs, value) {
  if (segs.length === 0) return prune(value);
  const base = tree !== null && typeof tree === 'object' ? { ...tree } : {};
  const [head, ...rest] = segs;
  const next = applyAt(base[head] === undefined ? null : base[head], rest, value);
  if (next === null) delete base[head];
  else base[head] = next;
  return Object.keys(base).length ? base : null;
}

// ---- expression parsing ---------------------------------------------------------------------------

const PUNCT = ['===', '!==', '==', '!=', '<=', '>=', '&&', '||', '<', '>', '!', '+', '-', '*', '/', '%', '(', ')', '[', ']', '.', ',', '?', ':'];

function tokenize(src) {
  const toks = [];
  let i = 0;
  const prevAllowsRegex = () => {
    const p = toks[toks.length - 1];
    return !p || (p.t === 'p' && ['(', ',', '=', '==', '===', '!=', '!==', '&&', '||', '!', '?', ':'].includes(p.v));
  };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i));
      toks.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) {
          s += src[j + 1];
          j += 2;
        } else s += src[j++];
      }
      if (j >= src.length) throw new Error('unterminated string');
      toks.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    if (c === '/' && prevAllowsRegex()) {
      let j = i + 1;
      let body = '';
      let inClass = false;
      while (j < src.length && (src[j] !== '/' || inClass)) {
        if (src[j] === '\\') {
          body += src[j] + src[j + 1];
          j += 2;
          continue;
        }
        if (src[j] === '[') inClass = true;
        if (src[j] === ']') inClass = false;
        body += src[j++];
      }
      if (j >= src.length) throw new Error('unterminated regex');
      j++;
      let flags = '';
      while (j < src.length && /[a-z]/.test(src[j])) flags += src[j++];
      toks.push({ t: 're', v: body, flags });
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i));
      toks.push({ t: 'id', v: m[0] });
      i += m[0].length;
      continue;
    }
    const p = PUNCT.find((x) => src.startsWith(x, i));
    if (!p) throw new Error('unexpected character ' + c);
    toks.push({ t: 'p', v: p });
    i += p.length;
  }
  return toks;
}

const BIN = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '===': 3,
  '!==': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};

export function parseExpression(src) {
  const toks = tokenize(src);
  let k = 0;
  const peek = () => toks[k];
  const isP = (v) => toks[k] && toks[k].t === 'p' && toks[k].v === v;
  const take = (v) => {
    if (!isP(v)) throw new Error('expected ' + v + ' at token ' + k);
    k++;
  };
  function primary() {
    const t = toks[k++];
    if (!t) throw new Error('unexpected end');
    if (t.t === 'num' || t.t === 'str') return { type: 'lit', value: t.v };
    if (t.t === 're') return { type: 're', body: t.v, flags: t.flags };
    if (t.t === 'id') {
      if (t.v === 'true') return { type: 'lit', value: true };
      if (t.v === 'false') return { type: 'lit', value: false };
      if (t.v === 'null') return { type: 'lit', value: null };
      return { type: 'id', name: t.v };
    }
    if (t.t === 'p' && t.v === '(') {
      const e = expr(0);
      take(')');
      return e;
    }
    if (t.t === 'p' && t.v === '[') {
      const items = [];
      if (!isP(']')) {
        items.push(expr(0));
        while (isP(',')) {
          k++;
          items.push(expr(0));
        }
      }
      take(']');
      return { type: 'array', items };
    }
    throw new Error('unexpected token ' + JSON.stringify(t));
  }
  function postfix() {
    let e = primary();
    for (;;) {
      if (isP('.')) {
        k++;
        const t = toks[k++];
        if (!t || t.t !== 'id') throw new Error('expected a name after .');
        e = { type: 'member', obj: e, name: t.v };
      } else if (isP('(')) {
        k++;
        const args = [];
        if (!isP(')')) {
          args.push(expr(0));
          while (isP(',')) {
            k++;
            args.push(expr(0));
          }
        }
        take(')');
        e = { type: 'call', callee: e, args };
      } else if (isP('[')) {
        k++;
        const idx = expr(0);
        take(']');
        e = { type: 'index', obj: e, idx };
      } else return e;
    }
  }
  function unary() {
    if (isP('!')) {
      k++;
      return { type: 'not', arg: unary() };
    }
    if (isP('-')) {
      k++;
      return { type: 'neg', arg: unary() };
    }
    return postfix();
  }
  function expr(minPrec) {
    let left = unary();
    for (;;) {
      const t = peek();
      if (t && t.t === 'p' && t.v === '?' && minPrec === 0) {
        k++;
        const a = expr(0);
        take(':');
        const b = expr(0);
        left = { type: 'cond', test: left, a, b };
        continue;
      }
      const prec = t && t.t === 'p' ? BIN[t.v] : undefined;
      if (prec === undefined || prec < minPrec) return left;
      k++;
      const right = expr(prec + 1);
      left = { type: 'bin', op: t.v, left, right };
    }
  }
  const out = expr(0);
  if (k !== toks.length) throw new Error('unexpected token after the end: ' + JSON.stringify(toks[k]));
  return out;
}

// ---- evaluation -----------------------------------------------------------------------------------

class RuleSnapshot {
  constructor(tree, segs) {
    this.tree = tree;
    this.segs = segs;
  }
}

class RuleError extends Error {}
const bad = (msg) => {
  throw new RuleError(msg);
};
const typeOf = (v) => (v === null ? 'null' : v instanceof RuleSnapshot ? 'snapshot' : typeof v);

function snapMethod(s, name, args) {
  const v = getAt(s.tree, s.segs);
  switch (name) {
    case 'val':
      return v === null || typeof v !== 'object' ? v : JSON.parse(JSON.stringify(v));
    case 'exists':
      return v !== null;
    case 'child':
      if (typeof args[0] !== 'string') bad('child() wants a string');
      return new RuleSnapshot(s.tree, s.segs.concat(splitPath(args[0])));
    case 'parent':
      if (!s.segs.length) bad('the root has no parent');
      return new RuleSnapshot(s.tree, s.segs.slice(0, -1));
    case 'hasChild':
      if (typeof args[0] !== 'string') bad('hasChild() wants a string');
      return getAt(s.tree, s.segs.concat(splitPath(args[0]))) !== null;
    case 'hasChildren':
      if (args.length === 0) return v !== null && typeof v === 'object' && Object.keys(v).length > 0;
      if (!Array.isArray(args[0])) bad('hasChildren() wants a list');
      return args[0].every((k) => getAt(s.tree, s.segs.concat(splitPath(k))) !== null);
    case 'isNumber':
      return typeof v === 'number';
    case 'isString':
      return typeof v === 'string';
    case 'isBoolean':
      return typeof v === 'boolean';
    case 'getPriority':
      return null;
    default:
      return bad('unknown snapshot method ' + name);
  }
}

function strMethod(s, name, args) {
  const a = args[0];
  switch (name) {
    case 'contains':
      if (typeof a !== 'string') bad('contains() wants a string');
      return s.includes(a);
    case 'beginsWith':
      if (typeof a !== 'string') bad('beginsWith() wants a string');
      return s.startsWith(a);
    case 'endsWith':
      if (typeof a !== 'string') bad('endsWith() wants a string');
      return s.endsWith(a);
    case 'replace':
      if (typeof a !== 'string' || typeof args[1] !== 'string') bad('replace() wants two strings');
      return s.split(a).join(args[1]);
    case 'toLowerCase':
      return s.toLowerCase();
    case 'toUpperCase':
      return s.toUpperCase();
    case 'matches':
      if (!a || !(a.re instanceof RegExp)) bad('matches() wants a regular expression literal');
      return a.re.test(s);
    default:
      return bad('unknown string method ' + name);
  }
}

function evaluate(node, ctx) {
  switch (node.type) {
    case 'lit':
      return node.value;
    case 're':
      return { re: new RegExp(node.body, node.flags) };
    case 'array':
      return node.items.map((x) => evaluate(x, ctx));
    case 'id': {
      const n = node.name;
      if (n === 'auth') return ctx.auth;
      if (n === 'now') return ctx.now;
      if (n === 'root') return ctx.root;
      if (n === 'data') return ctx.data;
      if (n === 'newData') return ctx.newData;
      if (n.startsWith('$') && Object.prototype.hasOwnProperty.call(ctx.vars, n)) return ctx.vars[n];
      return bad('unknown name ' + n);
    }
    case 'member': {
      const o = evaluate(node.obj, ctx);
      if (typeof o === 'string' && node.name === 'length') return o.length;
      if (o !== null && typeof o === 'object' && !(o instanceof RuleSnapshot) && !Array.isArray(o)) {
        return Object.prototype.hasOwnProperty.call(o, node.name) ? o[node.name] : null;
      }
      return bad('no property ' + node.name + ' on ' + typeOf(o));
    }
    case 'index':
      return bad('indexing is not supported');
    case 'call': {
      if (node.callee.type !== 'member') bad('only methods can be called');
      const o = evaluate(node.callee.obj, ctx);
      const args = node.args.map((a) => evaluate(a, ctx));
      if (o instanceof RuleSnapshot) return snapMethod(o, node.callee.name, args);
      if (typeof o === 'string') return strMethod(o, node.callee.name, args);
      return bad('cannot call ' + node.callee.name + ' on ' + typeOf(o));
    }
    case 'not': {
      const v = evaluate(node.arg, ctx);
      if (typeof v !== 'boolean') bad('! wants a boolean');
      return !v;
    }
    case 'neg': {
      const v = evaluate(node.arg, ctx);
      if (typeof v !== 'number') bad('- wants a number');
      return -v;
    }
    case 'cond': {
      const t = evaluate(node.test, ctx);
      if (typeof t !== 'boolean') bad('?: wants a boolean');
      return evaluate(t ? node.a : node.b, ctx);
    }
    case 'bin': {
      const op = node.op;
      if (op === '&&' || op === '||') {
        const l = evaluate(node.left, ctx);
        if (typeof l !== 'boolean') bad(op + ' wants booleans');
        if (op === '&&' && !l) return false;
        if (op === '||' && l) return true;
        const r = evaluate(node.right, ctx);
        if (typeof r !== 'boolean') bad(op + ' wants booleans');
        return r;
      }
      const l = evaluate(node.left, ctx);
      const r = evaluate(node.right, ctx);
      if (l instanceof RuleSnapshot || r instanceof RuleSnapshot) bad('snapshots cannot be compared; call val()');
      switch (op) {
        case '==':
        case '===':
          return l === r;
        case '!=':
        case '!==':
          return l !== r;
        case '<':
        case '<=':
        case '>':
        case '>=':
          if (!((typeof l === 'number' && typeof r === 'number') || (typeof l === 'string' && typeof r === 'string'))) {
            bad('cannot compare ' + typeOf(l) + ' with ' + typeOf(r));
          }
          return op === '<' ? l < r : op === '<=' ? l <= r : op === '>' ? l > r : l >= r;
        case '+':
          if (typeof l === 'number' && typeof r === 'number') return l + r;
          if (typeof l === 'string' || typeof r === 'string') {
            if ((l !== null && typeof l === 'object') || (r !== null && typeof r === 'object')) bad('cannot add objects');
            return String(l) + String(r);
          }
          return bad('cannot add ' + typeOf(l) + ' and ' + typeOf(r));
        default:
          if (typeof l !== 'number' || typeof r !== 'number') bad(op + ' wants numbers');
          return op === '-' ? l - r : op === '*' ? l * r : op === '/' ? l / r : l % r;
      }
    }
  }
  return bad('unknown node');
}

// ---- the rules tree -------------------------------------------------------------------------------

export function compileRules(json) {
  if (!json || typeof json !== 'object' || !json.rules || typeof json.rules !== 'object') throw new Error('rules file must look like { "rules": { ... } }');
  const cache = new Map();
  const problems = [];

  function compile(src, where) {
    if (typeof src === 'boolean') return { type: 'lit', value: src };
    if (cache.has(src)) return cache.get(src);
    let ast;
    try {
      if (typeof src !== 'string') throw new Error('a rule must be a string or a boolean');
      ast = parseExpression(src);
    } catch (err) {
      problems.push(where + ': ' + err.message);
      ast = { type: 'lit', value: false };
    }
    cache.set(src, ast);
    return ast;
  }

  // Walk the whole tree once so every expression is checked up front.
  (function walk(node, where) {
    for (const [k, v] of Object.entries(node)) {
      if (k === '.read' || k === '.write' || k === '.validate') {
        compile(v, where + '/' + k);
        if (typeof v === 'string') {
          for (const m of v.matchAll(/\/\^?[^/]*\//g)) {
            if (/\{\d/.test(m[0])) problems.push(where + '/' + k + ': avoid {n} quantifiers in rule regexes: ' + m[0]);
          }
        }
      } else if (k === '.indexOn') {
        // fine
      } else if (k.startsWith('.')) {
        problems.push(where + ': unknown rule property ' + k);
      } else if (v && typeof v === 'object') {
        walk(v, where + '/' + k);
      } else {
        problems.push(where + '/' + k + ': a rule node must be an object');
      }
    }
    const wild = Object.keys(node).filter((k) => k.startsWith('$'));
    if (wild.length > 1) problems.push(where + ': more than one $wildcard: ' + wild.join(', '));
  })(json.rules, '');

  function childRule(node, key, vars) {
    if (!node) return null;
    if (Object.prototype.hasOwnProperty.call(node, key) && !key.startsWith('$') && !key.startsWith('.')) return node[key];
    const w = Object.keys(node).find((k) => k.startsWith('$'));
    if (!w) return null;
    vars[w] = key;
    return node[w];
  }

  function run(rule, ctx, where) {
    const ast = compile(rule, where);
    try {
      return evaluate(ast, ctx) === true;
    } catch (err) {
      if (err instanceof RuleError) return false;
      throw err;
    }
  }

  function canRead(path, { auth = null, root = null, now = Date.now() } = {}) {
    const segs = splitPath(path);
    let node = json.rules;
    const vars = {};
    const rootSnap = new RuleSnapshot(root, []);
    for (let i = 0; i <= segs.length && node; i++) {
      if (node['.read'] !== undefined) {
        const ctx = { auth, now, root: rootSnap, data: new RuleSnapshot(root, segs.slice(0, i)), newData: null, vars: { ...vars } };
        if (run(node['.read'], ctx, '/' + segs.slice(0, i).join('/') + '/.read')) return { ok: true };
      }
      if (i < segs.length) node = childRule(node, segs[i], vars);
    }
    return { ok: false, reason: 'no .read rule allows /' + segs.join('/') };
  }

  function validateNode(node, segs, vars, oldRoot, newRoot, ctxBase, deep) {
    const nv = getAt(newRoot, segs);
    if (nv === null) return { ok: true };
    if (node && node['.validate'] !== undefined) {
      const ctx = { ...ctxBase, data: new RuleSnapshot(oldRoot, segs), newData: new RuleSnapshot(newRoot, segs), vars: { ...vars } };
      if (!run(node['.validate'], ctx, '/' + segs.join('/') + '/.validate')) return { ok: false, reason: '.validate failed at /' + segs.join('/') };
    }
    if (deep && node && typeof nv === 'object') {
      for (const key of Object.keys(nv)) {
        const cv = { ...vars };
        const cn = childRule(node, key, cv);
        if (!cn) continue;
        const r = validateNode(cn, segs.concat(key), cv, oldRoot, newRoot, ctxBase, true);
        if (!r.ok) return r;
      }
    }
    return { ok: true };
  }

  function checkLocation(segs, oldRoot, newRoot, ctxBase) {
    let node = json.rules;
    const vars = {};
    let granted = false;
    const chain = [];
    for (let i = 0; i <= segs.length; i++) {
      if (!node) break;
      chain.push({ node, segs: segs.slice(0, i), vars: { ...vars } });
      if (!granted && node['.write'] !== undefined) {
        const here = segs.slice(0, i);
        const ctx = { ...ctxBase, data: new RuleSnapshot(oldRoot, here), newData: new RuleSnapshot(newRoot, here), vars: { ...vars } };
        if (run(node['.write'], ctx, '/' + here.join('/') + '/.write')) granted = true;
      }
      if (i < segs.length) node = childRule(node, segs[i], vars);
    }
    if (!granted) return { ok: false, reason: 'no .write rule allows /' + segs.join('/') };
    // .validate above the written location (shallow), then at it and everything below it
    for (const c of chain) {
      const deep = c.segs.length === segs.length;
      const r = validateNode(c.node, c.segs, c.vars, oldRoot, newRoot, ctxBase, deep);
      if (!r.ok) return r;
    }
    return { ok: true };
  }

  function canUpdate(path, updates, { auth = null, root = null, now = Date.now() } = {}) {
    const base = splitPath(path);
    const locs = Object.entries(updates).map(([k, v]) => ({ segs: base.concat(splitPath(k)), value: v }));
    let newRoot = root;
    for (const l of locs) newRoot = applyAt(newRoot, l.segs, l.value);
    const ctxBase = { auth, now, root: new RuleSnapshot(root, []) };
    for (const l of locs) {
      const r = checkLocation(l.segs, root, newRoot, ctxBase);
      if (!r.ok) return r;
    }
    return { ok: true, newRoot };
  }

  function canWrite(path, value, ctx = {}) {
    const segs = splitPath(path);
    const root = ctx.root === undefined ? null : ctx.root;
    const newRoot = applyAt(root, segs, value);
    const r = checkLocation(segs, root, newRoot, { auth: ctx.auth || null, now: ctx.now === undefined ? Date.now() : ctx.now, root: new RuleSnapshot(root, []) });
    return r.ok ? { ok: true, newRoot } : r;
  }

  return { canRead, canWrite, canUpdate, lint: () => problems.slice() };
}

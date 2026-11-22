// Browser tabs, simulated in one Node process, for testing the local transport (js/net/transport-local.js)
// under node --test. Node has BroadcastChannel but no Web Locks, so this gives each simulated tab:
//
//   const tabs = createFakeTabs()
//   const tab = tabs.open()          { locks, BroadcastChannel, crash() }
//     locks                          a navigator.locks look-alike: request(name, [{ signal, ifAvailable }], cb)
//                                    The lock is held until cb's promise settles, like the browser.
//     BroadcastChannel               a class to hand to the transport; its channels die with the tab
//     crash()                        the tab vanishes without a word: its channels stop, its locks are
//                                    released and its queued lock requests are dropped (what closing a
//                                    browser tab does)
//
// Pass them in with createNet({ mode: 'local', local: { locks: tab.locks, BroadcastChannel: tab.BroadcastChannel } }).

function abortError() {
  const e = new Error('The request was aborted.');
  e.name = 'AbortError';
  return e;
}

export function createFakeTabs() {
  const held = new Map(); // name -> request
  const queues = new Map(); // name -> [request]

  function grantNext(name) {
    if (held.has(name)) return;
    const q = queues.get(name);
    while (q && q.length) {
      const req = q.shift();
      if (req.cancelled || !req.tab.alive) continue;
      grant(name, req);
      return;
    }
  }

  function release(name, req) {
    if (held.get(name) !== req) return;
    held.delete(name);
    req.tab.held.delete(name);
    queueMicrotask(() => grantNext(name));
  }

  function grant(name, req) {
    req.granted = true;
    held.set(name, req);
    req.tab.held.add(name);
    queueMicrotask(async () => {
      let result;
      let error = null;
      try {
        result = await req.cb({ name, mode: 'exclusive' });
      } catch (err) {
        error = err;
      }
      if (!req.tab.alive) return; // a crashed tab's locks were already released
      release(name, req);
      if (error) req.reject(error);
      else req.resolve(result);
    });
  }

  function open() {
    const tab = { alive: true, held: new Set(), channels: new Set() };

    const locks = {
      request(name, opts, cb) {
        if (typeof opts === 'function') {
          cb = opts;
          opts = {};
        }
        opts = opts || {};
        return new Promise((resolve, reject) => {
          if (!tab.alive) {
            reject(new Error('this tab is gone'));
            return;
          }
          const req = { tab, cb, resolve, reject, cancelled: false, granted: false };
          if (opts.signal) {
            if (opts.signal.aborted) {
              reject(abortError());
              return;
            }
            opts.signal.addEventListener('abort', () => {
              if (req.granted || req.cancelled) return;
              req.cancelled = true;
              reject(abortError());
            });
          }
          if (opts.ifAvailable && held.has(name)) {
            Promise.resolve()
              .then(() => cb(null))
              .then(resolve, reject);
            return;
          }
          let q = queues.get(name);
          if (!q) queues.set(name, (q = []));
          q.push(req);
          grantNext(name);
        });
      },
    };

    class TabChannel {
      constructor(name) {
        this.dead = false;
        this.onmessage = null;
        this.inner = new BroadcastChannel(name);
        this.inner.onmessage = (e) => {
          if (!this.dead && tab.alive && typeof this.onmessage === 'function') this.onmessage(e);
        };
        tab.channels.add(this);
      }
      postMessage(m) {
        if (!this.dead && tab.alive) this.inner.postMessage(m);
      }
      close() {
        if (this.dead) return;
        this.dead = true;
        this.inner.close();
      }
    }

    function crash() {
      if (!tab.alive) return;
      tab.alive = false;
      for (const c of tab.channels) c.close();
      for (const name of [...tab.held]) {
        held.delete(name);
        queueMicrotask(() => grantNext(name));
      }
      tab.held.clear();
    }

    return { locks, BroadcastChannel: TabChannel, crash, get alive() {
      return tab.alive;
    } };
  }

  return { open, held: () => [...held.keys()] };
}

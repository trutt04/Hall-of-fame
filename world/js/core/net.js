// Presence seam (Contract 6). Phase 1 ships this NO-OP adapter so the rest of the world can already
// talk to "the network" and phase 2 only has to swap the implementation.
//
// Interface every adapter must offer:
//
//   net.connect({ teamId, room? })  -> Promise<boolean>   resolves false when presence is unavailable
//   net.disconnect()
//   net.sendState(state)            state = { teamId, x, z, heading, anim } (what player.getState() returns).
//                                   Call it as often as you like; adapters throttle on their own.
//   net.on('peer', fn)              fn({ teamId, x, z, heading, anim, t })   a friend moved or joined
//   net.on('leave', fn)             fn({ teamId })                           a friend left
//   net.on('status', fn)            fn('offline' | 'connecting' | 'online')
//   net.connected                   boolean
//   net.peers                       Map<teamId, last state>
//
// Remote players and resident NPCs are the same avatar objects in one actor registry keyed by team
// id, so when a 'peer' arrives the world swaps the resident for the live friend with no other change.

import { emitter } from './util.js';

export function createNet() {
  const events = emitter();
  const peers = new Map();
  let last = null;
  return {
    kind: 'noop',
    connected: false,
    peers,
    connect() {
      events.emit('status', 'offline');
      return Promise.resolve(false);
    },
    disconnect() {},
    sendState(state) {
      last = state;
    },
    on: events.on.bind(events),
    off: events.off.bind(events),
    get lastSent() { return last; },
  };
}

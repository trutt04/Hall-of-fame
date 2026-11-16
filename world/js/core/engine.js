// Renderer, scene, main loop, adaptive quality and stats.
//
//   const engine = createEngine({ canvas, quality })     quality: 'auto' | 'low' | 'high'
//   engine.addSystem({ update(dt, t) }, order?)          systems run in ascending order each frame
//   engine.start() / engine.stop()
//   engine.stats() -> { fps, frameMs, drawCalls, triangles, pixelRatio }
//
// Throws if WebGL cannot be created, so the caller can show the DOM fallback.

import * as THREE from '../../lib/three.module.min.js';
import { PERF } from '../config.js';
import { clamp, emitter } from './util.js';

export function createEngine({ canvas, quality = 'auto' }) {
  const events = emitter();
  const dpr = window.devicePixelRatio || 1;
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const isMobile = coarse || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: dpr < 2,
    alpha: false,
    stencil: false,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false;
  renderer.setClearColor(0x0a1022, 1);
  renderer.info.autoReset = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 900);
  camera.position.set(0, 14, 30);
  scene.add(camera);

  // ---------------------------------------------------------------- pixel ratio and quality
  const capFor = (q) => {
    const base = isMobile ? PERF.maxPixelRatioMobile : PERF.maxPixelRatioDesktop;
    if (q === 'low') return Math.max(PERF.minPixelRatio, Math.min(1, dpr));
    return Math.max(PERF.minPixelRatio, Math.min(dpr, base));
  };
  let mode = quality === 'low' || quality === 'high' ? quality : 'auto';
  let cap = capFor(mode);
  let pixelRatio = cap;
  let width = 1;
  let height = 1;

  function applySize() {
    const w = Math.max(1, Math.floor(canvas.clientWidth || window.innerWidth));
    const h = Math.max(1, Math.floor(canvas.clientHeight || window.innerHeight));
    width = w;
    height = h;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    events.emit('resize', w, h);
  }

  function setPixelRatio(pr) {
    pr = clamp(Math.round(pr * 100) / 100, PERF.minPixelRatio, cap);
    if (pr === pixelRatio) return;
    pixelRatio = pr;
    applySize();
    events.emit('quality', pixelRatio);
  }

  // ---------------------------------------------------------------- systems and loop
  const systems = [];
  function addSystem(system, order = 100) {
    systems.push({ system, order });
    systems.sort((a, b) => a.order - b.order);
    return system;
  }
  function removeSystem(system) {
    const i = systems.findIndex((s) => s.system === system);
    if (i >= 0) systems.splice(i, 1);
  }

  let running = false;
  let wanted = false;
  let raf = 0;
  let last = 0;
  let time = 0;
  let frame = 0;
  let lost = false;

  // stats
  let emaMs = 16.7;
  let lastCalls = 0;
  let lastTris = 0;
  // adaptive quality: watch a rolling window of real frame times
  let winTime = 0;
  let winFrames = 0;
  let slowFor = 0;
  let fastFor = 0;
  let cooldown = 3;

  function adapt(rawDt) {
    if (mode !== 'auto') return;
    winTime += rawDt;
    winFrames++;
    if (winTime < 0.5) return;
    const avgMs = (winTime / winFrames) * 1000;
    const span = winTime;
    winTime = 0;
    winFrames = 0;
    if (cooldown > 0) {
      cooldown -= span;
      return;
    }
    if (avgMs > PERF.slowFrameMs) {
      slowFor += span;
      fastFor = 0;
    } else if (avgMs < PERF.slowFrameMs * 0.62) {
      fastFor += span;
      slowFor = 0;
    } else {
      slowFor = 0;
      fastFor = 0;
    }
    if (slowFor >= 2 && pixelRatio > PERF.minPixelRatio) {
      setPixelRatio(pixelRatio - 0.25);
      slowFor = 0;
      cooldown = 1.5;
    } else if (fastFor >= 6 && pixelRatio < cap) {
      setPixelRatio(pixelRatio + 0.25);
      fastFor = 0;
      cooldown = 3;
    }
  }

  function tick(now) {
    raf = requestAnimationFrame(tick);
    const raw = last ? (now - last) / 1000 : 1 / 60;
    last = now;
    if (raw > 1) return; // came back from a long pause: skip this frame's catch-up
    const dt = Math.min(raw, 0.05);
    time += dt;
    frame++;
    emaMs += (raw * 1000 - emaMs) * 0.08;
    for (let i = 0; i < systems.length; i++) {
      try {
        systems[i].system.update(dt, time);
      } catch (err) {
        if (!systems[i].failed) console.error('[lw] system update failed', err);
        systems[i].failed = true;
      }
    }
    renderer.render(scene, camera);
    lastCalls = renderer.info.render.calls;
    lastTris = renderer.info.render.triangles;
    adapt(raw);
  }

  function reallyStart() {
    if (running || lost || document.hidden) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(tick);
  }
  function reallyStop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  const onVisibility = () => {
    if (document.hidden) reallyStop();
    else if (wanted) reallyStart();
    events.emit('visibility', !document.hidden);
  };
  document.addEventListener('visibilitychange', onVisibility);

  let resizeQueued = false;
  const onResize = () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      applySize();
    });
    // iOS reports the old size for a moment after rotating
    setTimeout(applySize, 350);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    reallyStop();
    events.emit('contextlost');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
    if (wanted) reallyStart();
    events.emit('contextrestored');
  });

  applySize();

  return {
    renderer,
    scene,
    camera,
    isMobile,
    on: events.on.bind(events),
    addSystem,
    removeSystem,
    start() {
      wanted = true;
      reallyStart();
    },
    stop() {
      wanted = false;
      reallyStop();
    },
    // Render a single frame right now (used while the loop is paused, and by tests).
    renderOnce() {
      renderer.render(scene, camera);
      lastCalls = renderer.info.render.calls;
      lastTris = renderer.info.render.triangles;
    },
    resize: applySize,
    setQuality(q) {
      mode = q === 'low' || q === 'high' ? q : 'auto';
      cap = capFor(mode);
      setPixelRatio(cap);
      slowFor = 0;
      fastFor = 0;
      cooldown = 2;
    },
    get quality() { return mode; },
    get pixelRatio() { return pixelRatio; },
    get time() { return time; },
    get frame() { return frame; },
    get width() { return width; },
    get height() { return height; },
    get portrait() { return height > width; },
    get running() { return running; },
    stats() {
      return {
        fps: Math.round(1000 / Math.max(0.001, emaMs)),
        frameMs: Math.round(emaMs * 10) / 10,
        drawCalls: lastCalls,
        triangles: lastTris,
        pixelRatio,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
      };
    },
  };
}

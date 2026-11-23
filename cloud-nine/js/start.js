// The page's entry point (index.html). Normally the game: js/main.js. With ?check=online in the
// address, the online-play check instead (js/ui/netcheck.js, firebase/SETUP.md step 8), and none of
// the game loads: no three.js, no island, no sound. index.html preloads only what each one needs.

export function wantsCheck(search) {
  try {
    return new URLSearchParams(search).get('check') === 'online';
  } catch (err) {
    return false;
  }
}

function failed(err) {
  console.error('[c9] the page could not start', err);
  const veil = document.getElementById('veil');
  const box = document.getElementById('fallback');
  if (veil) veil.hidden = true;
  if (box) box.hidden = false;
}

if (typeof location !== 'undefined' && typeof document !== 'undefined') {
  if (wantsCheck(location.search)) import('./ui/netcheck.js').then((m) => m.mountOnlineCheck()).catch(failed);
  else import('./main.js').catch(failed);
}

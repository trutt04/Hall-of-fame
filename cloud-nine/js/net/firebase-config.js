// The Firebase project that online rooms use. firebase/SETUP.md walks you through filling this in.
//
// The family's project is filled in below, so online rooms are on. Put the PASTE-... placeholders back
// (see firebase/SETUP.md) and isConfigured() is false: the game plays without online rooms (solo play
// always works). On localhost the game keeps rooms in the browser unless ?net=firebase asks for this
// project (js/net/index.js), so testing never touches it. These values are not secrets: Firebase documents
// the web config, apiKey included, as an identifier. What keeps the data safe is the security
// rules in firebase/database.rules.json.
//
//   FIREBASE_CONFIG       the values from the Firebase console ("Your apps", the web app, "Config")
//   isConfigured(cfg?)    -> boolean   true once real values are in

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDmvNGm9sotOdTbuhPHUUuIBLdWMRsXd94',
  authDomain: 'cloud-nine-9a83d.firebaseapp.com',
  databaseURL: 'https://cloud-nine-9a83d-default-rtdb.firebaseio.com',
  projectId: 'cloud-nine-9a83d',
  appId: '1:270486630909:web:b2e8945a337e438ded6994',
};

export function isConfigured(cfg = FIREBASE_CONFIG) {
  if (!cfg || typeof cfg !== 'object') return false;
  for (const k of ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId']) {
    const v = cfg[k];
    if (typeof v !== 'string' || v.length < 4 || /PASTE|YOUR[-_ ]/i.test(v)) return false;
  }
  return /^https:\/\/[a-z0-9.-]+\.(firebaseio\.com|firebasedatabase\.app)\/?$/i.test(cfg.databaseURL);
}

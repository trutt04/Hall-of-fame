// The Firebase project that online rooms use. firebase/SETUP.md walks you through filling this in.
//
// Until the PASTE-... placeholders below are replaced, isConfigured() is false and the game plays
// without online rooms (solo play always works). These values are not secrets: Firebase documents
// the web config, apiKey included, as an identifier. What keeps the data safe is the security
// rules in firebase/database.rules.json.
//
//   FIREBASE_CONFIG       the values from the Firebase console ("Your apps", the web app, "Config")
//   isConfigured(cfg?)    -> boolean   true once real values are in

export const FIREBASE_CONFIG = {
  apiKey: 'PASTE-API-KEY-HERE',
  authDomain: 'PASTE-PROJECT-ID.firebaseapp.com',
  databaseURL: 'https://PASTE-PROJECT-ID-default-rtdb.firebaseio.com',
  projectId: 'PASTE-PROJECT-ID',
  appId: 'PASTE-APP-ID',
};

export function isConfigured(cfg = FIREBASE_CONFIG) {
  if (!cfg || typeof cfg !== 'object') return false;
  for (const k of ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId']) {
    const v = cfg[k];
    if (typeof v !== 'string' || v.length < 4 || /PASTE|YOUR[-_ ]/i.test(v)) return false;
  }
  return /^https:\/\/[a-z0-9.-]+\.(firebaseio\.com|firebasedatabase\.app)\/?$/i.test(cfg.databaseURL);
}

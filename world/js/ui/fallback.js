// The plain version for browsers where WebGL will not start: league name and week, the standings
// with tiers and the playoff line, this week's games and the headlines. DOM only. Nothing here
// depends on the 3D side.
//
//   renderFallback(el, { league, history, model })     model is optional: it is derived when missing

import { derive } from '../model/derive.js';
import { PAPER_NAME } from '../model/roasts.js';
import { el } from './dom.js';
import { buildStandings, buildMatchups } from './lists.js';

export function renderFallback(target, data = {}) {
  if (!target) return null;
  let model = data.model || null;
  if (!model && data.league) {
    try {
      model = derive(data.league, data.history || null, { now: new Date() });
    } catch (err) {
      console.warn('[lw] fallback could not read the league data', err);
    }
  }
  const box = el('div', 'lwf-fb');
  if (!model || !model.order || !model.order.length) {
    box.appendChild(el('p', 'lw-note', 'The league data did not load. Try again in a minute.'));
    target.replaceChildren(box);
    return box;
  }
  const meta = model.meta || {};
  box.append(
    el('h2', 'lwf-fb-league', meta.leagueName || 'League'),
    el('p', 'lwf-fb-week', 'Week ' + (meta.week || 1) + ' · ' + (meta.season || '') + (model.cutLine ? ' · Top ' + model.cutLine + ' make the playoffs' : '')),
  );
  if (meta.isSample) box.appendChild(el('p', 'lw-note', 'Sample data: the league is still private on ESPN, so these scores are placeholders for now.'));
  box.append(el('h3', 'lw-h3', 'Standings'), buildStandings(model, {}), el('h3', 'lw-h3', 'This week'), buildMatchups(model, {}));
  const stories = model.headlines || [];
  if (stories.length) {
    box.appendChild(el('h3', 'lw-h3', PAPER_NAME));
    for (const h of stories) {
      const a = el('article', 'lwf-fb-story');
      a.append(el('h4', null, h.headline || ''), el('p', null, h.body || ''));
      box.appendChild(a);
    }
  }
  target.replaceChildren(box);
  return box;
}

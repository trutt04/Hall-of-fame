/**
 * shape-report.mjs
 *
 * After a fetch, list which of the raw ESPN fields we rely on actually came back.
 * Several views could not be checked against the live league while it was private, so the
 * first real run prints exactly what ESPN returned. Only field NAMES and counts are
 * printed, never values and never whole response bodies.
 *
 * Path syntax: dots for objects, "[]" after a key for "each item of this list".
 *   teams[].record.overall.wins   ->  how many teams have record.overall.wins
 */

const OPTIONAL = 'optional';

/** [path, OPTIONAL?] per response kind. */
export const EXPECTED = Object.freeze({
  current: [
    ['id'], ['seasonId'], ['scoringPeriodId'],
    ['status.currentMatchupPeriod'], ['status.finalScoringPeriod'], ['status.isActive'], ['status.previousSeasons'],
    ['settings.name'], ['settings.isPublic'], ['settings.size'],
    ['settings.scheduleSettings.matchupPeriodCount'], ['settings.scheduleSettings.playoffTeamCount'],
    ['settings.scheduleSettings.matchupPeriods', OPTIONAL],
    ['settings.scoringSettings.scoringItems'], ['settings.rosterSettings.lineupSlotCounts'],
    ['draftDetail.drafted', OPTIONAL],
    ['members[].id'], ['members[].firstName'],
    ['teams[].id'], ['teams[].abbrev'], ['teams[].name'],
    ['teams[].location', OPTIONAL], ['teams[].nickname', OPTIONAL],
    ['teams[].primaryOwner'], ['teams[].owners'], ['teams[].playoffSeed'], ['teams[].rankCalculatedFinal'],
    ['teams[].record.overall.wins'], ['teams[].record.overall.losses'], ['teams[].record.overall.ties'],
    ['teams[].record.overall.pointsFor'], ['teams[].record.overall.pointsAgainst'],
    ['teams[].record.overall.streakType'], ['teams[].record.overall.streakLength'],
    ['teams[].transactionCounter.acquisitions'], ['teams[].transactionCounter.drops'], ['teams[].transactionCounter.trades'],
    ['teams[].roster.entries'],
    ['teams[].roster.entries[].lineupSlotId'],
    ['teams[].roster.entries[].playerPoolEntry.appliedStatTotal', OPTIONAL],
    ['teams[].roster.entries[].playerPoolEntry.player.fullName'],
    ['teams[].roster.entries[].playerPoolEntry.player.defaultPositionId'],
    ['teams[].roster.entries[].playerPoolEntry.player.proTeamId'],
    ['teams[].roster.entries[].playerPoolEntry.player.injuryStatus', OPTIONAL],
    ['teams[].roster.entries[].playerPoolEntry.player.injured', OPTIONAL],
    ['teams[].roster.entries[].playerPoolEntry.player.stats'],
    ['teams[].roster.entries[].playerPoolEntry.player.stats[].scoringPeriodId'],
    ['teams[].roster.entries[].playerPoolEntry.player.stats[].statSourceId'],
    ['teams[].roster.entries[].playerPoolEntry.player.stats[].statSplitTypeId'],
    ['teams[].roster.entries[].playerPoolEntry.player.stats[].appliedTotal'],
    ['schedule[].matchupPeriodId'], ['schedule[].winner'], ['schedule[].playoffTierType'],
    ['schedule[].home.teamId'], ['schedule[].home.totalPoints'],
    ['schedule[].away.teamId'], ['schedule[].away.totalPoints'],
    ['schedule[].home.totalPointsLive', OPTIONAL], ['schedule[].home.totalProjectedPointsLive', OPTIONAL],
    ['schedule[].home.pointsByScoringPeriod', OPTIONAL],
    ['schedule[].home.rosterForCurrentScoringPeriod.entries', OPTIONAL],
    ['schedule[].home.rosterForCurrentScoringPeriod.appliedStatTotal', OPTIONAL],
  ],
  lineups: [
    ['scoringPeriodId'],
    ['schedule[].matchupPeriodId'], ['schedule[].home.teamId'], ['schedule[].away.teamId'],
    ['schedule[].home.rosterForCurrentScoringPeriod.entries', OPTIONAL],
    ['schedule[].home.rosterForMatchupPeriod.entries', OPTIONAL],
    ['schedule[].home.rosterForCurrentScoringPeriod.entries[].lineupSlotId', OPTIONAL],
    ['schedule[].home.rosterForCurrentScoringPeriod.entries[].playerPoolEntry.appliedStatTotal', OPTIONAL],
    ['schedule[].home.rosterForCurrentScoringPeriod.entries[].playerPoolEntry.player.fullName', OPTIONAL],
    ['schedule[].home.rosterForCurrentScoringPeriod.entries[].playerPoolEntry.player.defaultPositionId', OPTIONAL],
    ['schedule[].home.rosterForCurrentScoringPeriod.entries[].playerPoolEntry.player.stats', OPTIONAL],
  ],
  draft: [
    ['draftDetail.drafted'], ['draftDetail.picks'],
    ['draftDetail.picks[].roundId'], ['draftDetail.picks[].roundPickNumber'], ['draftDetail.picks[].overallPickNumber'],
    ['draftDetail.picks[].teamId'], ['draftDetail.picks[].playerId'],
  ],
  players: [
    // ESPN has used both a plain list and { players: [{ player: {...} }] } for player lists.
    ['[].id', OPTIONAL], ['[].fullName', OPTIONAL], ['[].defaultPositionId', OPTIONAL],
    ['players[].id', OPTIONAL], ['players[].player.fullName', OPTIONAL],
  ],
  proSchedule: [
    ['settings.proTeams'],
    ['settings.proTeams[].id'], ['settings.proTeams[].byeWeek'], ['settings.proTeams[].proGamesByScoringPeriod'],
  ],
  history: [
    ['id'], ['seasonId'], ['status.isActive'], ['status.finalScoringPeriod'],
    ['settings.scheduleSettings.matchupPeriodCount'], ['settings.scheduleSettings.playoffTeamCount'],
    ['members[].id'], ['members[].firstName'],
    ['teams[].id'], ['teams[].name', OPTIONAL], ['teams[].location', OPTIONAL], ['teams[].nickname', OPTIONAL],
    ['teams[].primaryOwner'], ['teams[].playoffSeed'], ['teams[].rankCalculatedFinal'],
    ['teams[].record.overall.wins'], ['teams[].record.overall.losses'],
    ['teams[].record.overall.pointsFor'], ['teams[].record.overall.pointsAgainst'],
    ['schedule[].matchupPeriodId'], ['schedule[].winner'], ['schedule[].playoffTierType'],
    ['schedule[].home.teamId'], ['schedule[].home.totalPoints'], ['schedule[].away.teamId'], ['schedule[].away.totalPoints'],
  ],
});

function count(value, segments, acc) {
  if (segments.length === 0) {
    acc.total++;
    if (value !== undefined && value !== null) acc.present++;
    return;
  }
  const [head, ...rest] = segments;
  if (head.endsWith('[]')) {
    const key = head.slice(0, -2);
    const list = key ? value?.[key] : value;
    if (!Array.isArray(list)) return;
    acc.lists++;
    if (rest.length === 0) {
      acc.total += list.length;
      acc.present += list.length;
      return;
    }
    for (const item of list) count(item, rest, acc);
    return;
  }
  count(value === null || value === undefined ? undefined : value[head], rest, acc);
}

/** { total, present, lists } for one path. */
export function probe(raw, path) {
  const acc = { total: 0, present: 0, lists: 0 };
  count(raw, path.split('.'), acc);
  return acc;
}

/**
 * Human-readable lines describing one raw response.
 * Returns { lines, missing } where missing lists required paths that did not come back at all.
 */
export function shapeReport(label, raw, kind) {
  const spec = EXPECTED[kind] ?? [];
  const lines = [`  ${label}`];
  const missing = [];
  if (raw === null || raw === undefined) {
    lines.push('    (not fetched or not available)');
    return { lines, missing };
  }
  const keys = Array.isArray(raw) ? [`a list of ${raw.length} items`] : Object.keys(raw).sort();
  lines.push(`    top level: ${keys.join(', ') || '(empty)'}`);
  for (const [path, flag] of spec) {
    const isList = path.includes('[]');
    const { total, present } = probe(raw, path);
    const optional = flag === OPTIONAL;
    let mark;
    if (isList) mark = total === 0 ? (optional ? 'none' : 'MISSING') : `${present}/${total}`;
    else mark = present ? 'ok' : optional ? 'none' : 'MISSING';
    if (!optional && (total === 0 || present === 0)) missing.push(path);
    lines.push(`    ${mark.padEnd(9)} ${path}${optional ? '  (optional)' : ''}`);
  }
  return { lines, missing };
}

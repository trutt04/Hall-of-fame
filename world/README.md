# League World

A 3D world for Dan's Real Cool League. Open the link on a phone, pick your team, and walk
around a hillside town where your address is your place in the standings.

- **1st place** lives in the mansion on The Hill, with gold gates, a throne and the crown.
- **The next few playoff teams** live in Playoff Heights.
- **Teams on either side of the playoff line** live in The Bubble.
- **The teams below that** live in the Waiver Wire Trailer Park.
- **Last place** lives in a tent on the garbage heap at The Dump.

Nothing in the world is edited by hand. It is all built from ESPN data.

## Where it lives

- The world is the `world/` folder. Once this is merged to `main`, it is at
  `https://trutt04.github.io/Hall-of-fame/world/`.
- The original Hall of Fame page (`index.html` and `beat.mp3` at the top of the repo) is not
  changed by any of this.

## How the ESPN data gets in

1. A small job runs on GitHub by itself: every 10 minutes while NFL games are on, and once an
   hour the rest of the time.
2. It asks ESPN for the league, checks that the answer makes sense, and saves it into
   `world/data/`.
3. The world reads those saved files. Phones never talk to ESPN directly.

Things worth knowing:

- **Scores are near live, not live.** GitHub's timer and page cache put the world roughly 10 to
  20 minutes behind ESPN during games.
- **If ESPN says no or is down**, the job keeps the last good data and tries again next time.
  Nothing breaks.
- **There are no passwords, cookies or tokens anywhere in this repo.** The job only works for a
  league that is viewable to the public.
- **The timer only runs from the `main` branch.** That is a GitHub rule.

## What to do when...

| Situation | What to do |
|---|---|
| The league manager makes the league public | Nothing. The next run picks it up and the "sample data" label disappears. |
| You want fresh data right now | On GitHub: Actions tab, "ESPN sync", "Run workflow". |
| A new season starts | Nothing. The job works out the season from the date. |
| ESPN moves its address again | GitHub emails you after the job has failed for a day. Add the new address as the first line of `DEFAULT_BASE_URLS` in `scripts/lib/espn-client.mjs`. Nothing else changes. |
| You want to pause the job | On GitHub: Actions tab, "ESPN sync", the "..." menu, "Disable workflow". |
| The league goes private again | Nothing breaks. The world keeps showing the last data it got. |

## Sample data

Until the league is public, the world runs on sample data and says so on the standings board.
The team names, records, points and streaks in the sample are the real ones from November 15,
2026. Everything else in the sample (weekly scores, this week's matchups, rosters, injuries and
all past seasons) is invented so the world has something to show.

## House rules

- No NFL, team or ESPN logos or artwork. Avatars are generic and team-colored.
- Roasts are about records, lineups and luck. Nothing personal.
- Team names are shown exactly as ESPN has them, and everything is tracked by team id, so
  renaming a team never breaks anything.

## For whoever works on this next

- `world/ARCHITECTURE.md` is the technical blueprint: the data formats, how the pieces connect,
  and where phases 2 and 3 plug in.
- `npm test` runs the checks for the sync and the league logic. No install step is needed.
- `npm run sample` rebuilds the sample data. It refuses to overwrite real ESPN data.
- `npm run preloads` refreshes the list of files the page loads up front. Run it after adding
  or removing a file under `world/js/`. `npm test` tells you if you forgot.
- There is no build step. The files in `world/` are served as they are.

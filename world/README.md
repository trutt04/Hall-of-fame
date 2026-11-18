# League World

A 3D world for Dan's Real Cool League. Open the link on a phone, pick your team, and walk
around a hillside town where your address is your place in the standings.

- **1st place** lives in the mansion on The Hill, with gold gates, a throne and the crown.
- **The next few playoff teams** live in Playoff Heights.
- **Teams on either side of the playoff line** live in The Bubble.
- **The teams below that** live in the Waiver Wire Trailer Park.
- **Last place** lives in a tent on the garbage heap at The Dump.

Nothing in the world is edited by hand. It is all built from ESPN data.

## Things to do in the world

- **Ride the garbage truck.** It waits at the "Truck stop" sign by the gold gates on The Hill,
  then drives down to The Dump and tips you out with the trash.
- **Kick field goals.** There is a practice field beside the plaza. Swipe up to kick. Your best
  distance is saved on your own phone.
- **Send a postcard.** The camera button, or the "Postcard" button on any home's card, makes a
  picture you can save or share to the group chat. You always see it before it goes anywhere.
- **Check the playoff picture.** It is in the standings panel. During the regular season it
  shows what the bracket would be if the season ended today. In the playoffs it follows the
  real games.
- **Visit the headstones.** Beside the Graveyard building there is a plot for early draft picks
  that are no longer on the team that drafted them, or are stuck on its injured reserve.

The map has all of these under "Things to do".

## Settling scores

If your team won last week, you may vandalize the home of the team you beat: a dozen eggs, four
rolls of toilet paper and one spray tag, from a preset list only. Walk to their house (or use
Map, Things to do, Settle the score) and tap "Settle the score". The slate is wiped when the
next week is final.

For now the damage is saved on the phone of whoever did it. Everyone else sees it when that
person shares a postcard of the house. Showing it on every phone needs a small free online
service, which can be added later (see `world/ARCHITECTURE.md`, Contract 6).

## The Supreme Commissioner

The league's running joke: the commissioner as glorious leader. There is a bronze monument, a
bust in every neighborhood, a mandatory portrait beside every front door, banners along the
boulevard, loudspeakers, and a "state media" box in the paper. The words are written from his
real record each week, so they change by themselves.

- The face comes from two picture files: `world/img/leader-portrait.jpg` and
  `world/img/leader-poster.png`. Replace those two files to change the pictures.
- Who it is about is one line in `world/js/config.js` (`REGIME`, by team id). Setting it to
  `null` takes every statue, portrait and banner down.
- Because the site is public, anyone with the link can see the pictures.
- With sound on, the loudspeakers say one line out loud: the first time you walk up to one, then
  at most every five minutes. The recording is `world/audio/loudspeaker.mp3`, made with the
  open-source Kokoro voice (Apache 2.0 licence) and a megaphone effect. To use your own
  recording instead, replace that file with an MP3 and change `voiceLine` in
  `world/js/config.js` so the words on screen match.

## Where it lives

- The world is the `world/` folder. It is at `https://trutt04.github.io/Hall-of-fame/world/`.
- The original Hall of Fame page (`index.html` and `beat.mp3` at the top of the repo) is the
  same as before, with two small additions: a "League World" button in its header, and links
  ending in `#hall`, `#grave` or `#league` now open it on that section. The three buildings on
  the world's plaza use those links.

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
- **Nothing secret is written in this repo.** If the league is viewable to the public, the job
  needs no login at all. If it is private, the job can use your own ESPN login, stored by GitHub
  in a locked box that is not part of the repo. See "Reading a private league" below.
- **The timer only runs from the `main` branch.** That is a GitHub rule.

## What to do when...

| Situation | What to do |
|---|---|
| The league manager makes the league public | Nothing. The next run picks it up and the "sample data" label disappears. |
| You want fresh data right now | On GitHub: Actions tab, "ESPN sync", "Run workflow". |
| A new season starts | Nothing. The job works out the season from the date. |
| ESPN moves its address again | GitHub emails you after the job has failed for a day. Add the new address as the first line of `DEFAULT_BASE_URLS` in `scripts/lib/espn-client.mjs`. Nothing else changes. |
| You want to pause the job | On GitHub: Actions tab, "ESPN sync", the "..." menu, "Disable workflow". |
| The league goes private again | Nothing breaks. The world keeps showing the last data it got. You can add your ESPN login so it keeps updating. See "Reading a private league". |
| The standings stop changing for a day or two | Open the standings panel and read the line under the table. If it says the last check with ESPN did not go through, your login has expired. See "When the login stops working". |

## Reading a private league

Our league is private, so ESPN will not show it to a stranger. The job can prove it is you by
using the same two values your browser already uses to keep you signed in. They are called
cookies. Their names are `espn_s2` and `SWID`.

**Read this part first.** Those two values together are your ESPN login. Anyone who has them can
use ESPN as you. So:

- Never type them into a file, a message, an email or a chat. Not even to yourself.
- Only ever paste them into the GitHub box described below. GitHub keeps them locked and never
  shows them again, not even to you.
- The job is built so that they do not end up in the repo, in the data files, on the website or
  in the job's own logs. It blanks them out of every line it prints or saves, as a last check.
- If you think someone else has seen them, change your ESPN password. That makes the old values
  useless straight away. Then do step 1 and step 2 again with the new ones. (Signing out of ESPN
  also works, if you sign out on every device you use it on.)

### Step 1: get the two values from your browser

You need a laptop or a desktop computer for this step. Phones and tablets cannot show you
cookies. Step 2 can be done on a phone afterwards if you prefer.

In Chrome or Edge:

1. Go to `fantasy.espn.com` and sign in, so you can see our league.
2. Press F12. A panel opens. (On a Mac: Command, Option, I.)
3. Click the **Application** tab at the top of that panel. If you do not see it, click the small
   arrows to show more tabs.
4. In the list on the left, open **Cookies**, then click `https://fantasy.espn.com`.
5. A table appears. Find the row named `espn_s2`. **Double-click its Value cell**, then press
   Ctrl+A and Ctrl+C (on a Mac, Command+A then Command+C). That copies the whole thing. The
   value is about 300 characters long and has `%` signs in it. Do not drag across it to select
   it: the column only shows the beginning, and a half-copied value looks fine to you but is
   rejected by ESPN.
6. Do the same for the row named `SWID`. That one is short and looks like
   `{AB12CD34-56EF-78AB-90CD-EF1234567890}`.

If the panel offers a tick box called "Show URL-decoded", leave it unticked. The `espn_s2` value
is supposed to arrive with its `%` signs in it, and ESPN rejects it without them.

In Safari, turn on the Develop menu first: Safari, Settings, Advanced, "Show features for web
developers". Then Develop, Show Web Inspector, and use the Storage tab instead of Application.

Browsers move these panels around and rename things between versions, so what you see may not
match the words above. That is fine. All you need is the value of the two cookies named
`espn_s2` and `SWID`, so any up-to-date guide for your own browser will get you to the same
place.

Keep the browser window open until you have finished step 2.

### Step 2: put them in GitHub

1. Go to the repo on GitHub: `https://github.com/trutt04/Hall-of-fame`.
2. Click **Settings** (the tab along the top of the repo, not your own account settings).
3. In the left menu, click **Secrets and variables**, then **Actions**.
4. Click the green **New repository secret** button.
5. In **Name** type `ESPN_S2`. In **Secret** paste the long `espn_s2` value. Click
   **Add secret**.
6. Click **New repository secret** again. In **Name** type `ESPN_SWID`. In **Secret** paste the
   `SWID` value. Click **Add secret**.

You should now see two secrets listed, `ESPN_S2` and `ESPN_SWID`. GitHub shows only the names.

Do not worry about the curly braces, a space or a newline at either end, quote marks, or a
leftover `SWID=` in front of the value. The job tidies all of that up. What it cannot fix is a
space or a line break in the MIDDLE of a value, which is what you get if the value was copied in
two pieces. Both names must be spelled exactly as above, and you need both. One on its own does
nothing, and the job says so on the run page.

### Step 3: check it worked

On GitHub: the **Actions** tab, then "ESPN sync", then **Run workflow**. Give it a minute or two,
then open the run. If it worked, the summary at the top says `Result: ok`. That summary is the
part that tells you whether it worked.

The world itself takes longer to catch up, usually 10 to 20 minutes, because GitHub has to
republish the site. Once it does, the "sample data" label on the standings board is gone.

If the summary says `login_expired`, ESPN would not accept the two values. ESPN does not tell us
why, so it is one of these four:

- one of the values was copied wrong, or only part of it was copied,
- the `espn_s2` value was copied with the `%` signs stripped out of it (the summary points this
  one out on its own "ESPN login" line, and step 1 says which tick box causes it),
- the values have already changed (see "When the login stops working" below),
- or the ESPN account they came from is not in this league.

Go back to step 1 in the same browser you are signed in to, check that you can see our league
there, and copy both values again.

If the summary still says `league_private` even though both secrets are set, the job chose not to
send the login at all. The summary says why on its own "ESPN login" line, and there is a yellow
note headed "ESPN login" near the top of the run page as well. Almost always it is that the
pasted value picked up a space or a line break, so copy that one value again, on its own, and
update the secret with its pencil icon. (The other possible cause is an `ESPN_BASE_URLS` setting
in the job that does not point at ESPN. It is normally not set at all.)

### What this means for privacy

Once this works, the job writes the league's **real** names, rosters, scores, draft and past
seasons into this repo, and this repo is public. That means:

- Anybody with the link can read our real team names, records, scores, lineups and draft.
- Each manager's **first name** is saved as well, exactly as ESPN has it, so it is public too.
  Last names are not.
- Anybody can also see all of it in the files on GitHub, and in the repo's history, forever.
- The job does leave out the rest of what ESPN sends about people. Last names, display names,
  email addresses and ESPN member ids are never saved. Each owner gets a short one-way hash
  instead, so the world can follow the same person across seasons without storing who they are.
  (The invented sample league under `scripts/fixtures/` contains made-up ids that look like real
  ones. They are produced by a random generator in `scripts/make-fixture.mjs` and belong to
  nobody.)
- Your ESPN login itself is never written anywhere. Only the league data is.

If any of that is not okay, do not add the secrets. The world runs happily on sample data. The
other managers are in this too, so it is worth telling them before you switch it on.

### When the login stops working

ESPN changes these values from time to time. It always happens when you change your ESPN password
or sign out, and it can also happen on its own. There is no schedule to plan around, so do not
watch the calendar: the job tells you when it has happened. When it does:

- Nothing breaks and nothing is lost, and that is exactly why it is easy to miss. The job still
  finishes green, GitHub does not email you, and the world keeps showing the last data it got.
  Once it has had real data once, the "sample data" label does NOT come back.
- How to spot it in the world: open the standings panel. The line under the table changes to
  "The data was last saved ... ago. The last check with ESPN did not go through, so this is the
  most recent good copy." If the standings have stopped moving, read that line first.
- `world/data/status.json` says `login_expired`, and the job's log says in plain words what to do.
- The fix is to do step 1 and step 2 again. In step 2 you click the existing secret's pencil icon
  and paste the new value instead of making a new secret. `ESPN_S2` is usually the only one that
  changes, but it does no harm to redo both.
- The job keeps trying without the login as well, so if the league is ever made public it starts
  working again by itself even with an old login sitting in GitHub.

To stop using your login altogether, delete both secrets on that same GitHub page. The job goes
straight back to asking ESPN as the public, which is how it behaved before.

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

# Turning on online rooms

Cloud Nine works on its own with no setup at all: Bailey can play solo, with computer friends
(bots), and nothing ever goes over the internet.

To play **together**, each on her own phone or tablet, the devices need somewhere online to pass
the game along: who is in the room, where everyone is standing, who is "it". That place is a small,
free database from Google called **Firebase**. This page walks you through setting it up, once. It
takes about 15 minutes on a laptop or desktop computer.

You need a Google account. You do **not** need a credit card.

## Before you start: what it costs and what it keeps

- **It is free.** Firebase's free plan is called **Spark**. It never asks for a card, so it can
  never charge you. Its limits are far more than a family needs: 100 devices online at once, 1 GB
  stored, 10 GB downloaded a month. If a limit were ever reached, online rooms would simply stop
  until the next month. Solo play keeps working.
- **What it keeps:** for each room, the 4-character room code, each player's nickname, their
  character's look (preset choices like "big pink bow"), where they are standing while they play,
  which quick-cheer they tapped, and the game's score. Nothing else. A player's nickname, look and
  position are removed when they leave or close the game; an empty room keeps only its code,
  anonymous IDs, the last score and the last minute of quick-cheers.
- **What it never keeps:** no emails, no passwords, no real names (unless a kid types her first
  name as her nickname), no photos, no messages, no locations, no ads, no tracking. There is no chat
  in the game at all.
- **Private rooms.** A room can only be joined by someone who knows its code, and nobody can see a
  list of rooms. Each device gets an invisible, anonymous ID when it joins a room. There is nothing
  to sign up for. The host can also lock a room once everyone is in: then nobody else can join it
  or see who is inside, and the host can send someone home. If you pasted the rules before this
  was added, paste them again (step 3).
- **The settings you copy in step 6 are not secret.** Firebase says so itself: they only say which
  database to use. What protects the data are the security rules you paste in step 3, which this
  repo already contains.

Firebase changes its pages now and then, so the buttons may not match the words below exactly.
That is fine. What you need at the end is always the same: a **Realtime Database** with these
**rules**, **Anonymous** sign-in turned on, the game's web address on the **authorized domains**
list, and **five values** pasted into `cloud-nine/js/net/firebase-config.js`.

## Step 1: create the project

1. Go to `console.firebase.google.com` and sign in with your Google account.
2. Click **Create a project** (it may say **Add project**, or **Get started with a Firebase
   project**).
3. For the name, type `cloud-nine` (or anything you like; the kids never see it). Firebase may add
   a few letters and numbers to make it unique. That is fine. Keep names, towns and dates out of
   it: the project name becomes part of the database address, which goes into this public repo. Tick the box to accept the terms if
   it asks, then click **Continue**.
4. If it offers **Gemini in Firebase** or other extras, you can skip them.
5. On the page about **Google Analytics**, turn it **off** (the switch next to "Enable Google
   Analytics for this project"). The game doesn't use it, and this is a kids' game.
6. Click **Create project**, wait for "Your new project is ready", then click **Continue**.

If Firebase ever asks you to upgrade your plan or add billing, say no. Nothing here needs it.

## Step 2: create the database

1. In the menu on the left, open **Build**, then click **Realtime Database**. (Not "Firestore
   Database": that is a different product.)
2. Click **Create Database**.
3. Pick the location closest to you: **United States** if you are in America, **Belgium** for
   Europe, **Singapore** for Asia. Click **Next**.
4. Choose **Start in locked mode**, then click **Enable**.
5. The database page opens. At the top there is an address that looks like
   `https://cloud-nine-1a2b3-default-rtdb.firebaseio.com/` (it may end in `firebasedatabase.app`
   instead). Leave this tab open: you may need that address in step 6.

## Step 3: paste the security rules

1. On the same Realtime Database page, click the **Rules** tab.
2. Click inside the box of text, select all of it (Ctrl+A, or Command+A on a Mac) and delete it.
3. In another tab, open this repo on GitHub and go to `cloud-nine/firebase/database.rules.json`.
   Click the **Copy raw file** button (two overlapping squares, top right of the file).
4. Go back to Firebase and paste it into the empty box (Ctrl+V, or Command+V on a Mac).
5. Click **Publish**.

If Firebase shows a red error, part of the file went missing on the way. Select all, delete, and
copy the whole file again. Don't edit the rules by hand.

These rules are what keep the game safe: a device can only change its own player, only the room's
host can change the game, rooms can't be listed, names must be short and plain, and anything that
doesn't look right is refused.

## Step 4: turn on anonymous sign-in

1. In the menu on the left, open **Build**, then click **Authentication**. Click **Get started**
   if you see it.
2. Click the **Sign-in method** tab.
3. Find **Anonymous** in the list of providers (it may be under "Native providers", or you may
   need to click **Add new provider** first) and click it.
4. Switch **Enable** on, then click **Save**.

## Step 5: add the game's web address

1. Still in **Authentication**, click the **Settings** tab, then **Authorized domains**.
2. Click **Add domain**, type `trutt04.github.io` (just that: no `https://`, no slash at the end),
   and click **Add**.

`localhost` is already on the list. Leave it there.

## Step 6: copy the web app settings

1. At the top of the menu on the left, click the gear icon next to **Project Overview**, then
   **Project settings**.
2. On the **General** tab, scroll down to **Your apps** and click the web icon, which looks like
   `</>`.
3. For the nickname, type `Cloud Nine`. Leave "Also set up Firebase Hosting" **unticked**. Click
   **Register app**.
4. Firebase shows a block of code with `const firebaseConfig = {` in it. You need five of the
   values in there: `apiKey`, `authDomain`, `databaseURL`, `projectId` and `appId`. Ignore the
   others (`storageBucket`, `messagingSenderId`, `measurementId`).
   - If `databaseURL` is not in the list, use the database address from step 2 instead, without
     the slash at the end.
5. Click **Continue to console**. You can always find these values again: Project settings,
   General, Your apps, then the **Config** option under the web app.

## Step 7: put the settings into the game

1. On GitHub, open `cloud-nine/js/net/firebase-config.js`.
2. Click the pencil icon (**Edit this file**).
3. Replace each `PASTE-...` value with yours. Keep the quote marks around each value and the comma
   at the end of each line. When you are done, that part of the file looks like this, with your own
   values:

   ```js
   export const FIREBASE_CONFIG = {
     apiKey: 'AIzaSyB-your-own-key-here',
     authDomain: 'cloud-nine-1a2b3.firebaseapp.com',
     databaseURL: 'https://cloud-nine-1a2b3-default-rtdb.firebaseio.com',
     projectId: 'cloud-nine-1a2b3',
     appId: '1:123456789012:web:abc123def456',
   };
   ```

   Don't change anything else in the file.
4. Click the green **Commit changes** button, then **Commit changes** again in the box that pops
   up.

GitHub puts the new version of the site online by itself. That usually takes one or two minutes,
sometimes up to ten.

## Step 8: check it works

1. On one phone or tablet, open the game, choose to play with friends and make a room. A
   4-character code appears.
2. On a second device (a different phone, tablet or computer), choose to join and type that code.
3. Each of you should now see the other walking around. Try a quick-cheer.

If either device says it can't reach the clouds, wait a few minutes for GitHub to finish
publishing, then reload the page on both devices.

## What to do when...

| Situation | What to do |
|---|---|
| Every device says it can't reach the clouds | Check the internet first. Then look at step 7 again: all five values pasted, each in quote marks, commas kept, and the site has had a few minutes to update. Then check steps 4 and 5. |
| One device can't join but the others can | That device may be offline, or on a network that blocks Google's services (some school networks do). Try it on home Wi-Fi. |
| "No room with that code" | Check the letters: codes never use vowels, or `0`, `1` or `5`. A room also ends when everybody has left it (a link with that code then simply starts it again), and it is forgotten 12 hours after anyone last played in it. |
| "That room is full" | A room holds 10 players. Computer friends (bots) step aside for real people on their own, so "full" means 10 people. Make a second room. |
| Someone's tablet fell asleep in the middle of a game | The others carry on: after about 15 seconds the next player in line becomes the host. When the tablet wakes up it rejoins the room by itself. |
| You want to see what is stored | Firebase: **Realtime Database**, the **Data** tab. Rooms are listed under `rooms`. |
| You want to tidy up | In that **Data** tab you can delete anything under `rooms` at any time (hover over it and click the bin icon). Nothing breaks, but anyone still playing in a room you delete is sent out of it, so do it when nobody is playing. Players' own entries already disappear by themselves when they leave. |
| The list of users under **Authentication** keeps growing | That is expected. Each time the game is opened and joins a room, it gets a new anonymous ID. They hold no information. You can delete them in that list whenever you like. |
| Firebase emails you about rules or security | With the rules from this repo it shouldn't. If it does, someone may have changed them: paste them again as in step 3. |
| You want to turn online play off | In `cloud-nine/js/net/firebase-config.js`, put the `PASTE-...` placeholders back (or edit the file and undo your change from its history on GitHub). The game goes back to solo play with bots. You can also switch **Anonymous** off in step 4, which stops new devices from joining rooms. |

## Optional, later: lock the key to the game's address

Not needed, but tidy. In the Google Cloud console (`console.cloud.google.com`, same Google account,
same project), go to **APIs & Services**, then **Credentials**. Click the key named **Browser key
(auto created by Firebase)**. Under **Application restrictions** choose **Websites**, add
`https://trutt04.github.io/*`, and click **Save**. After that, the key only works from the game's
own address. (If anyone runs the game on their own computer for testing, add
`http://localhost/*` and `http://127.0.0.1/*` too.) If online rooms stop working right after you do
this, set Application restrictions back to **None**.

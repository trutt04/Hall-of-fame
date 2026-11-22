// Kid safety review: nicknames. Put-downs typed as one word are caught; real names kids have are
// not. Like content-names.test.mjs, these tests never print a blocked word (messages use indexes).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NICK_FIRST, NICK_SECOND, cleanNick } from '../js/content/names.js';
import { isBlocked, blockedEntries } from '../js/content/blocklist.js';

const L = blockedEntries();
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

test('names: put-downs typed as one word are caught, with doubled letters too', () => {
  L.halves.forEach((h, i) => {
    L.tails.forEach((t, j) => {
      assert.equal(cleanNick(cap(h + t).slice(0, 12)) === null || (h + t).length > 12, true, `halves #${i} + tails #${j}`);
      assert.ok(isBlocked(h + t), `halves #${i} + tails #${j}`);
      assert.ok(isBlocked(cap(h) + t + t.slice(-1)), `halves #${i} + tails #${j}, doubled`);
    });
  });
  L.endings.forEach((e, i) => {
    assert.ok(isBlocked('Bailey' + e), `endings #${i} after a name`);
    assert.ok(isBlocked('Bailey ' + e), `endings #${i} as its own word`);
  });
  L.starts.forEach((s, i) => assert.ok(isBlocked(s + 'bailey'), `starts #${i} before a name`));
  for (const [list, name] of [[L.anywhere, 'anywhere'], [L.words, 'words']]) {
    list.forEach((w, i) => {
      const stretched = Array.from(w, (ch) => ch + ch + ch).join('');
      assert.ok(isBlocked(cap(stretched)), `${name} #${i} with every letter tripled`);
    });
  }
  L.anywhere.forEach((w, i) => assert.ok(isBlocked('Super' + w + 'y'), `anywhere #${i} inside a longer name`));
});

// Real first names (and two-name combinations) a kid at the party could have. None may be refused.
const REAL = `Ashley Cassie Hazel Dakota Scarlett Shirley Cassandra Dickens Hancock Sussex Olivia Emma Ava Sophia Mia Amelia
Harper Evelyn Abigail Emily Ella Camila Luna Sofia Avery Mila Aria Penelope Layla Chloe Victoria Madison Eleanor Grace Nora
Riley Zoey Hannah Lily Ellie Violet Lillian Zoe Stella Aurora Natalie Everly Leah Aubrey Willow Addison Lucy Audrey Bella Nova
Brooklyn Paisley Savannah Claire Skylar Isla Naomi Elena Caroline Anna Maya Ruby Kennedy Ivy Ariana Aaliyah Cora Alice Kinsley
Hailey Allison Gianna Samantha Sarah Autumn Quinn Eva Piper Sophie Sadie Delilah Josephine Nevaeh Adeline Lydia Clara Vivian
Peyton Julia Brielle Reagan Jade Athena Maria Leilani Melanie Mackenzie Hadley Kaylee Rose Isabelle Melody Eliza Kylie Faith
Mary Margaret Iris Jasmine Charlotte Taylor Khloe Alexa Amara Andrea Parker Eden Brianna Eloise Cecilia Remi Josie Reese
Bailey Lucia Molly Daisy London Esther Harmony Alyssa Ariel Morgan Summer Juliette Callie Sienna Kayla Teagan Finley Sloane
Rachel Ember Kimberly Juniper Sydney Gemma Jessica Maddie Addie Goldie Freddie Frankie Elodie Heidi Dixie Trixie Bessie Jessie
Missy Kassidy Cassidy Cass Tess Bess Lassie Phoebe Chelsea Michelle Rochelle Shelly Helen Hellen Natasha Sasha Tasha Aisha
Fatima Fatma Anushka Nazia Janice Analise Annalise Analia Titania Kitty Titus Peter Willy Penny Peggy Hattie Dee Didi Diana
Lexi Saxon Jaxon Casey Stacey Spencer Hunter Shiloh Kshitij Dikshita Shital Fuka Nicole Nikki Gigi Coco Lulu Kiki Pippa
Poppy Polly Holly Ollie Bobby Abby Libby Izzy Dizzy Buttercup Butterfly Bumblebee Honeysuckle Raccoon Cockatoo Peacock
Scrappy Classy Sassy Bass Skill Killian Hello Whatever Cumulus Fuchsia Dickens Therapist Closer Dumbledore Dumbo Crystal
Piglet Pigeon Peeta Speedy Diego Dieter Hatem Rafat Grasshopper Bagley Facey Liam Noah Oliver James Elijah Henry Lucas
Theodore Mateo Levi Sebastian Daniel Jack Michael Owen Asher Samuel Ethan Leo Mason Ezra John Hudson Luca Aiden Joseph David
Logan Luke Julian Gabriel Wyatt Matthew Dylan Isaac Elias Thomas Carter Charles Caleb Cooper Lincoln Miles Nathan Kai Rowan
Hassan Ali Omar Yusuf Amir Kumar Raj Arjun Rohan Priya Anika Aditi Kiran Meera Diya Sana Zara Noor Hana Yuki Sakura Hina Mei
Lin Chen Wei Jun Min Hoon Seo Yeon Anh Linh Mai Bao Thu Nga Duc Minh Long Huy Tuan Bich Ngoc Phuong`.split(/\s+/).filter(Boolean);
const PAIRS = ['Mary Kate', 'Lily Rose', 'Ella Mae', 'Anna Lise', 'Sue Ellen', 'Rowan K', 'Rowan Kai', 'Raj Izzy', 'Cass Hattie',
  'Mia Rose', 'Ava Grace', 'Jo Ann', 'Bo Kim', 'Di Anna', 'Ngoc Bich', 'Ali Fatima', 'Kit Kat', 'Tess Hat', 'Bess Kid', 'Lee Ass'];

test('names: real names kids have are never refused, alone or two together', () => {
  const refused = [...REAL, ...PAIRS].filter((n) => n.length <= 12 && n !== 'Lee Ass' && cleanNick(n) === null);
  assert.deepEqual(refused, []);
  assert.equal(cleanNick('Lee Ass'), null, 'a split put-down is still caught');
  let n = 0;
  const pairRefused = [];
  const short = REAL.filter((x) => x.length <= 6).slice(0, 160);
  for (const a of short) {
    for (const b of short) {
      if (a.length + b.length + 1 > 12) continue;
      n++;
      if (cleanNick(`${a} ${b}`) === null) pairRefused.push(`${a} ${b}`);
    }
  }
  assert.ok(n > 10000);
  assert.ok(pairRefused.length <= 2, `two real names refused: ${pairRefused.join(', ')}`);
});

test('names: every generated name is fine, and none is about looks, bodies or food', () => {
  const NOT_KIND = /^(fluffy|chubby|skinny|tiny|big|little|chunky|plump|swirly|stinky|silly|goofy|crazy|nutty|cookie|candy|cupcake|sugar|honey|peachy|muffin|pudding|jelly|donut|butter|cheesy|spicy|sweetie)$/i;
  for (const w of [...NICK_FIRST, ...NICK_SECOND]) assert.ok(!NOT_KIND.test(w), `${w} in the generator`);
  for (const a of NICK_FIRST) for (const b of NICK_SECOND) assert.equal(isBlocked(`${a} ${b}`), false, `${a} ${b}`);
});

test('names: the blocked-name message is gentle, and the new lists never sit in plain text', () => {
  const creator = readFileSync(new URL('../js/ui/creator.js', import.meta.url), 'utf8');
  assert.match(creator, /Let's try a different name, or tap Pick for me!/);
  const src = readFileSync(new URL('../js/content/blocklist.js', import.meta.url), 'utf8').toLowerCase();
  // the rude lists (the tails are plain body words like the one in "Facey")
  for (const name of ['halves', 'endings', 'starts']) L[name].forEach((w, i) => assert.ok(w.length < 4 || !src.includes(w), `${name} #${i} in plain text`));
});

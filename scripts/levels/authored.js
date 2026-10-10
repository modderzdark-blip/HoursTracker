// The hand-authored opening (levels 1-25): like the original, the first levels teach by doing. A tutorial level's
// `guide` walks the player through it the first time: the board dims around the exact swap to make, a hand shows the
// move, and only that swap is allowed (find: the kind of move, see LOGIC.findGuideMove; a step without `find` just
// shows its words until the next move). New ideas arrive quickly, one per level: specials in the first six levels,
// then jelly, ingredients, frosting, orders, cages, popcorn, portals, cocoa and fuses.
// scripts/calibrate.js tunes only `moves` (and the star thresholds); layouts stay as written.
// Layout legend: '.' candy  '#' hole  'j'/'J' jelly (1/2 layers)  '1'-'5' frosting layers  'k' Sugar Cage
//   'o' Cocoa Creep  'b' Fuse Candy (meta.fuse)  'c' cherry  'h' hazelnut  'x' exit tray  'p'/'P' portal pair (meta.portals)
//   'n' Popcorn  '>' '<' '^' 'v' Sugar Belt. meta.preset: digits fix a starting candy color ('.' = random).
//   meta.specials: pre-placed specials.
'use strict';

const FULL7 = ['.......', '.......', '.......', '.......', '.......', '.......', '.......'];
const FULL8 = ['........', '........', '........', '........', '........', '........', '........', '........'];
const ROUND7 = ['##...##', '#.....#', '.......', '.......', '.......', '#.....#', '##...##'];

module.exports = [
  {
    id: 1, name: 'Sugar Start', role: 'tutorial', moves: 15, colors: 4, seed: 1001, rows: 7, cols: 7,
    layout: ROUND7.slice(),
    meta: { preset: ['.......', '.......', '.......', '..2.22.', '.......', '.......', '.......'] },
    goals: [{ type: 'collect', color: 2, count: 15 }],
    newMechanic: 'collect',
    tutorial: 'Swap two neighboring candies to make a line of three! Collect the lemon drops shown at the top.',
    tip: 'Follow the hand: swipe the candy, or tap it and then its neighbor.',
    guide: [
      { find: 'match', color: 2, text: 'Swipe the candy to line up three lemon drops!' },
      { find: 'match', color: 2, text: 'Sweet! Every lemon drop you match counts toward your goal. Make another!' },
      { text: 'You got it! Collect all the lemon drops before your moves run out.' },
    ],
  },
  {
    id: 2, name: 'Stripe School', role: 'tutorial', moves: 15, colors: 4, seed: 2002, rows: 7, cols: 7,
    layout: FULL7.slice(),
    meta: { preset: ['1231231', '2312312', '3120123', '1001023', '2003211', '3122332', '1231123'] },
    goals: [{ type: 'collect', color: 0, count: 18 }],
    newMechanic: 'striped',
    tutorial: 'Line up FOUR candies to make a Striped Candy. Match it to clear a whole row or column!',
    tip: 'Four in a row make a striped candy.',
    guide: [
      { find: 'striped', text: 'Line up FOUR candies to make a Striped Candy!' },
      { find: 'use_special', text: 'Now match the Striped Candy to fire it across the board!' },
      { text: 'Striped candies clear a whole line. Collect all the cherry beans!' },
    ],
  },
  {
    id: 3, name: 'Jelly Jar', role: 'tutorial', moves: 16, colors: 4, seed: 3003, rows: 7, cols: 7,
    layout: ['.......', '.jjjjj.', '.jjjjj.', '.jjjjj.', '.jjjjj.', '.jjjjj.', '.......'],
    goals: [{ type: 'jelly' }],
    newMechanic: 'jelly',
    tutorial: 'Jelly sits under some candies. Make matches on top of it to wipe it all away!',
    tip: 'The pink frames show where the jelly is. Clear every one!',
    guide: [
      { find: 'jelly', text: 'See the pink jelly? Match candies on top of it to clear it!' },
      { find: 'jelly', text: 'Great! Clear every square of jelly to win.' },
      { text: 'The number at the top counts the jelly squares left.' },
    ],
  },
  {
    id: 4, name: 'Wrap It Up', role: 'tutorial', moves: 18, colors: 4, seed: 4004, rows: 8, cols: 8,
    layout: ['#......#', '........', '........', '........', '........', '........', '........', '#......#'],
    meta: { preset: ['........', '........', '........', '...2....', '...2....', '.2202...', '.22.....', '........'] },
    goals: [{ type: 'collect', color: 2, count: 24 }],
    newMechanic: 'wrapped',
    tutorial: 'Match five in an L or T shape to make a Wrapped Candy. It explodes twice!',
    tip: 'Slide the lemon into the corner of the L.',
    guide: [
      { find: 'wrapped', text: 'Match five in an L or T shape to make a Wrapped Candy!' },
      { find: 'use_special', text: 'Now match the Wrapped Candy: it explodes, then explodes again!' },
      { text: 'Make specials whenever you can. They clear lots of candies at once!' },
    ],
  },
  {
    id: 5, name: 'Jelly Rows', role: 'normal', moves: 20, colors: 4, seed: 5005, rows: 8, cols: 8,
    layout: ['........', 'jjjjjjjj', '........', 'jjjjjjjj', '........', '........', 'jjjjjjjj', '........'],
    goals: [{ type: 'jelly' }],
    newMechanic: null,
    tip: 'A striped candy sweeps a whole jelly row in one go.',
  },
  {
    id: 6, name: 'Rainbow Maker', role: 'tutorial', moves: 18, colors: 4, seed: 6006, rows: 8, cols: 8,
    layout: FULL8.slice(),
    meta: { preset: ['........', '........', '........', '........', '........', '..3.....', '33133...', '........'] },
    goals: [{ type: 'collect', color: 3, count: 30 }],
    newMechanic: 'bomb',
    tutorial: 'Line up FIVE to make a Color Bomb. Swap it with a candy to clear every candy of that color!',
    tip: 'Drop the green square into the gap to line up five.',
    guide: [
      { find: 'bomb', text: 'Line up FIVE in a row to make a Color Bomb!' },
      { find: 'use_bomb', text: 'Swap the Color Bomb with a candy: every candy of that color goes!' },
      { text: 'Color Bombs are the most powerful candy of all. Save them for when you need them!' },
    ],
  },
  {
    id: 7, name: 'Cherry Drop', role: 'tutorial', moves: 18, colors: 4, seed: 7007, rows: 8, cols: 8,
    layout: ['#.c..c.#', '........', '........', '........', '........', '........', '........', 'xxxxxxxx'],
    goals: [{ type: 'ingredients', count: 2 }],
    newMechanic: 'ingredients',
    tutorial: 'Clear the candies under the cherries to drop them into the trays at the bottom.',
    tip: 'Matches below a cherry make it fall faster.',
    guide: [
      { find: 'ingredient', text: 'Bring the cherries down! Clear the candies right below them.' },
      { find: 'ingredient', text: 'Keep going! A cherry that reaches the bottom row is collected.' },
      { text: 'Striped candies that fire down a cherry column work wonders.' },
    ],
  },
  {
    id: 8, name: 'Combo Lab', role: 'tutorial', moves: 16, colors: 5, seed: 8008, rows: 8, cols: 8,
    layout: FULL8.slice(),
    meta: { specials: [{ at: [5, 2], special: 'stripe_row' }, { at: [5, 3], special: 'wrapped' }, { at: [2, 4], special: 'stripe_col' }, { at: [2, 5], special: 'stripe_row' }] },
    goals: [{ type: 'collect', color: 4, count: 30 }],
    newMechanic: 'combos',
    tutorial: 'Swap two special candies together for a giant combo!',
    tip: 'Striped + wrapped clears three rows and three columns.',
    guide: [
      { find: 'combo', text: 'Swap two special candies together for a MEGA combo!' },
      { find: 'combo', text: 'Again! Two striped candies together blast a giant cross.' },
      { text: 'Combos are the key to the hardest levels. Watch for specials side by side!' },
    ],
  },
  {
    id: 9, name: 'Cherry Hill', role: 'breather', moves: 22, colors: 4, seed: 9009, rows: 8, cols: 8,
    layout: ['#c..c.c#', '........', '........', '........', '........', '........', '........', 'xxxxxxxx'],
    goals: [{ type: 'ingredients', count: 3 }],
    newMechanic: null,
    tip: 'Three cherries, lots of moves. Enjoy the ride!',
  },
  {
    id: 10, name: 'Frosting Fields', role: 'tutorial', moves: 20, colors: 5, seed: 10010, rows: 8, cols: 8,
    layout: ['........', '........', '.1....1.', '..1..1..', '........', '..1..1..', '.1....1.', '........'],
    goals: [{ type: 'collect', color: 1, count: 24 }],
    newMechanic: 'frosting',
    tutorial: 'Frosting blocks a square. Make a match right next to it to crack it away.',
    tip: 'Blasts from special candies crack frosting too.',
    guide: [
      { find: 'frosting', text: 'Frosting blocks the board. Match right next to it to crack it!' },
      { text: 'Crack the frosting to free the board, and collect the orange lozenges.' },
    ],
  },
  {
    id: 11, name: 'Special Orders', role: 'tutorial', moves: 22, colors: 5, seed: 11011, rows: 8, cols: 8,
    layout: ['........', '........', '........', '...##...', '...##...', '........', '........', '........'],
    meta: { preset: ['........', '........', '........', '........', '........', '...1....', '.1101...', '.11.....'] },
    goals: [{ type: 'order', item: 'striped', count: 2 }, { type: 'order', item: 'wrapped', count: 1 }],
    newMechanic: 'order',
    tutorial: 'Candy orders ask for special candies. Make them and fire them to fill the order!',
    tip: 'A striped candy counts when it goes off.',
    guide: [
      { find: 'striped', text: 'This order wants special candies. Make a Striped Candy...' },
      { find: 'use_special', text: '...and fire it! The order counts it when it goes off.' },
      { text: 'Fire two striped candies and one wrapped candy to win.' },
    ],
  },
  {
    id: 12, name: 'Double Jelly', role: 'tutorial', moves: 24, colors: 5, seed: 12012, rows: 8, cols: 8,
    layout: ['........', '.JJJJJJ.', '.J....J.', '.J....J.', '.J....J.', '.J....J.', '.JJJJJJ.', '........'],
    goals: [{ type: 'jelly' }],
    newMechanic: 'jelly2',
    tutorial: 'Thick jelly is darker: it needs two matches on top.',
    tip: 'Wrapped candies hit the same squares twice. Handy!',
    guide: [
      { find: 'jelly', text: 'This jelly is extra thick: match on it twice to clear it!' },
      { text: 'Thick jelly has a double frame. Clear it all!' },
    ],
  },
  {
    id: 13, name: 'Frosted Jelly', role: 'normal', moves: 24, colors: 5, seed: 13013, rows: 9, cols: 9,
    layout: ['.........', '.jjjjjjj.', '.j1...1j.', '.j.....j.', '.j..1..j.', '.j.....j.', '.j1...1j.', '.jjjjjjj.', '.........'],
    goals: [{ type: 'jelly' }],
    newMechanic: null,
    tip: 'Work the jelly ring from the inside out.',
  },
  {
    id: 14, name: 'Sugar Cages', role: 'tutorial', moves: 22, colors: 5, seed: 14014, rows: 8, cols: 8,
    layout: ['........', '........', '..k..k..', '...kk...', '...kk...', '..k..k..', '........', '........'],
    goals: [{ type: 'collect', color: 1, count: 26 }],
    newMechanic: 'cage',
    tutorial: "Caged candies can't move. Match them, or blast them, to break the cage.",
    tip: 'A caged candy still counts in a match.',
    guide: [
      { find: 'cage', text: "Caged candies can't move, but they can still match! Match one to break its cage." },
      { text: 'Free the candies and collect the orange lozenges.' },
    ],
  },
  {
    id: 15, name: 'Popcorn Party', role: 'tutorial', moves: 22, colors: 5, seed: 15015, rows: 8, cols: 8,
    layout: ['........', '........', '..n..n..', '........', '........', '..n..n..', '........', '........'],
    goals: [{ type: 'order', item: 'popcorn', count: 4 }],
    newMechanic: 'popcorn',
    tutorial: 'Popcorn takes three hits. Match beside it or blast it, and it bursts into a Color Bomb!',
    tip: 'Use the Color Bomb from one popcorn to pop the next.',
    guide: [
      { find: 'popcorn', text: 'Hit the popcorn: match right next to it!' },
      { find: 'popcorn', text: 'It is splitting open! Two more hits and it pops.' },
      { text: 'Every popcorn bursts into a Color Bomb. Pop all four!' },
    ],
  },
  {
    id: 16, name: 'Lemon Rush', role: 'normal', moves: 20, colors: 5, seed: 16016, rows: 8, cols: 8,
    layout: FULL8.slice(),
    goals: [{ type: 'collect', color: 2, count: 36 }],
    newMechanic: null,
    tip: 'Make specials: one striped candy collects a whole row!',
  },
  {
    id: 17, name: 'Cherry Treats', role: 'breather', moves: 22, colors: 5, seed: 17017, rows: 8, cols: 8,
    layout: ['#......#', '........', '........', '........', '........', '........', '........', '#......#'],
    goals: [{ type: 'collect', color: 0, count: 26 }],
    newMechanic: null,
    tip: 'Plenty of moves. Go for specials!',
  },
  {
    id: 18, name: 'Caged Jelly', role: 'normal', moves: 24, colors: 5, seed: 18018, rows: 8, cols: 8,
    layout: ['........', '.jjjjjj.', '.jk..kj.', '.j....j.', '.j....j.', '.jk..kj.', '.jjjjjj.', '........'],
    goals: [{ type: 'jelly' }],
    newMechanic: null,
    tip: 'Free the cages first, then sweep the jelly.',
  },
  {
    id: 19, name: 'Portal Party', role: 'tutorial', moves: 22, colors: 5, seed: 19019, rows: 9, cols: 9,
    layout: ['.........', '.........', '.........', 'p.p.p.p.p', '#########', '##PPPPP##', '##.....##', '##.....##', '##.....##'],
    meta: { portals: [{ in: [3, 0], out: [5, 2] }, { in: [3, 2], out: [5, 3] }, { in: [3, 4], out: [5, 4] }, { in: [3, 6], out: [5, 5] }, { in: [3, 8], out: [5, 6] }] },
    goals: [{ type: 'collect', color: 3, count: 22 }],
    newMechanic: 'portals',
    tutorial: 'Candies that fall into a portal pop out of its partner below.',
    tip: 'Matches up top keep the lower garden supplied.',
  },
  {
    id: 20, name: 'Cocoa Creep', role: 'tutorial', moves: 22, colors: 5, seed: 20020, rows: 8, cols: 8,
    layout: ['........', '........', '........', '...oo...', '........', '........', '........', '........'],
    goals: [{ type: 'collect', color: 1, count: 28 }],
    newMechanic: 'cocoa',
    tutorial: "Cocoa spreads after any move that doesn't clear some. Match next to it to clean it up!",
    tip: 'Keep the cocoa in check every few moves.',
    guide: [
      { find: 'cocoa', text: 'Chocolate spreads if you leave it alone! Match next to it to clear it.' },
      { text: 'Every move that clears no cocoa lets it grow. Keep it in check!' },
    ],
  },
  {
    id: 21, name: 'Cocoa Cleanup', role: 'normal', moves: 24, colors: 5, seed: 21021, rows: 8, cols: 8,
    layout: ['........', '.o....o.', '........', '...nn...', '........', '........', '.o....o.', '........'],
    goals: [{ type: 'collect', color: 4, count: 30 }],
    newMechanic: null,
    tip: 'Pop the popcorn for Color Bombs, and tidy the cocoa as you go.',
  },
  {
    id: 22, name: 'Fuse Box', role: 'tutorial', moves: 22, colors: 5, seed: 22022, rows: 8, cols: 8,
    layout: ['........', '........', '..b..b..', '........', '........', '........', '........', '........'],
    meta: { fuse: 16 },
    goals: [{ type: 'collect', color: 4, count: 26 }],
    newMechanic: 'fuse',
    tutorial: 'Fuse Candies count down after every move. Clear them before they reach zero!',
    tip: 'Match a fuse candy, or blast it, to defuse it.',
  },
  {
    id: 23, name: 'Popcorn Garden', role: 'normal', moves: 24, colors: 5, seed: 23023, rows: 9, cols: 9,
    layout: ['.........', '.JJJ.JJJ.', '.JnJ.JnJ.', '.JJJ.JJJ.', '.........', '.JJJ.JJJ.', '.JnJ.JnJ.', '.JJJ.JJJ.', '.........'],
    goals: [{ type: 'jelly' }],
    newMechanic: null,
    tip: 'Thick jelly around every popcorn: pop it, and its Color Bomb helps clear the patch.',
  },
  {
    id: 24, name: 'Frosted Orders', role: 'normal', moves: 24, colors: 5, seed: 24024, rows: 8, cols: 8,
    layout: ['........', '.2....2.', '........', '..2..2..', '..2..2..', '........', '.2....2.', '........'],
    goals: [{ type: 'order', item: 'frosting', count: 14 }, { type: 'order', item: 'striped', count: 2 }],
    newMechanic: null,
    tip: 'Striped candies fired along a row crack every frosting they pass.',
  },
  {
    id: 25, name: 'Sweet Summit', role: 'normal', moves: 26, colors: 5, seed: 25025, rows: 9, cols: 9,
    layout: ['...c.c...', '.........', '.2.....2.', '..jjjjj..', '..j...j..', '..jjjjj..', '.2.....2.', '.........', 'xxxxxxxxx'],
    goals: [{ type: 'jelly' }, { type: 'ingredients', count: 2 }],
    newMechanic: null,
    tip: 'Two goals at once: jelly and cherries. You know all the tricks!',
  },
];

// LEVELS: data only. Adding level 11+ means appending one more object to this array (see README "Adding levels").
// Layout legend: '.' normal  '#' hole  'j' single jelly  'J' double jelly  'f' frosting (1)  'F' frosting (2)
//                'c' cherry start  'x' exit tray (cherries reaching it are collected)
// Colors: 0 Cherry Bean, 1 Orange Lozenge, 2 Lemon Drop, 3 Mint Square, 4 Blueberry Ball, 5 Grape Cluster.
// Goals are always candy goals (collect, glaze, cherries): a level is never won by points alone.
// `palette` (optional) picks which candies appear; by default the first `colors` candies are used.
// Finishing the goals always earns at least 1 star. Star thresholds come from tests/simulate.js and are set for a
// casual player: 3 stars = the 10th-percentile winning score of a player making random valid moves (end bonus
// included), 2 stars = its 2nd percentile, so nearly every win earns 3 stars; see README for the numbers.
(function attachLevels(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});

  const LEVELS = [
    {
      id: 1, name: 'Sugar Start', moves: 20, colors: 4, seed: 1001,
      rows: 7, cols: 7,
      layout: [
        '.......',
        '.......',
        '.......',
        '.......',
        '.......',
        '.......',
        '.......',
      ],
      goals: [{ type: 'collect', color: 0, count: 25 }],
      stars: [3000, 8000, 13000],
      tutorial: 'Swap two neighboring candies to make a row of three! Collect the red jelly beans shown at the top.',
    },
    {
      id: 2, name: 'Berry Rush', moves: 20, colors: 4, seed: 2002, palette: [0, 4, 1, 3],
      rows: 8, cols: 8,
      layout: [
        '........',
        '........',
        '........',
        '........',
        '........',
        '........',
        '........',
        '........',
      ],
      goals: [{ type: 'collect', color: 0, count: 30 }, { type: 'collect', color: 4, count: 30 }],
      stars: [3500, 9000, 15500],
      tutorial: 'Collect the candies shown at the top. Every bean and ball you clear counts!',
    },
    {
      id: 3, name: 'Striped Surprise', moves: 25, colors: 5, seed: 3003,
      rows: 9, cols: 9,
      layout: [
        '.........',
        '.........',
        '.........',
        '.........',
        '.........',
        '.........',
        '.........',
        '.........',
        '.........',
      ],
      goals: [{ type: 'collect', color: 1, count: 30 }, { type: 'collect', color: 3, count: 30 }],
      stars: [2500, 6500, 9500],
      tutorial: 'Match 4 in a line to make a Striped candy. Match it again to clear a whole row or column!',
    },
    {
      id: 4, name: 'Glaze Garden', moves: 25, colors: 5, seed: 4004,
      rows: 9, cols: 9,
      layout: [
        '.........',
        '.........',
        '..jjjjj..',
        '..jjjjj..',
        '..jj#jj..',
        '..jjjjj..',
        '..jjjjj..',
        '.........',
        '.........',
      ],
      goals: [{ type: 'jelly' }],
      stars: [3500, 9500, 13000],
      tutorial: 'Glaze sits under some candies. Make matches on top of it to wipe it all away!',
    },
    {
      id: 5, name: 'Wrapped Up', moves: 22, colors: 5, seed: 5005,
      rows: 9, cols: 9,
      layout: [
        '##.....##',
        '#.......#',
        '.........',
        '.........',
        '.........',
        '.........',
        '.........',
        '#.......#',
        '##.....##',
      ],
      goals: [{ type: 'collect', color: 3, count: 25 }],
      stars: [1500, 4500, 7000],
      tutorial: 'Make an L or T shape to create a Wrapped candy. It explodes twice!',
    },
    {
      id: 6, name: 'Cherry Drop', moves: 22, colors: 5, seed: 6006,
      rows: 9, cols: 9,
      layout: [
        '..c...c..',
        '.........',
        '.........',
        '.........',
        '.........',
        '.........',
        '.........',
        '.........',
        'xxxxxxxxx',
      ],
      goals: [{ type: 'ingredients', count: 2 }],
      stars: [3000, 8500, 12000],
      tutorial: 'Clear the candies under the cherries to drop them into the trays at the bottom.',
    },
    {
      id: 7, name: 'Frosty Fortress', moves: 28, colors: 5, seed: 7007,
      rows: 9, cols: 9,
      layout: [
        '.........',
        '.JJJ.JJJ.',
        '.J.....J.',
        '.J.F.F.J.',
        '.J..f..J.',
        '.J.F.F.J.',
        '.J..f..J.',
        '..JJ.JJ..',
        '.........',
      ],
      goals: [{ type: 'jelly' }],
      stars: [7000, 17500, 21500],
      tutorial: 'Frosting blocks swaps. Match next to it to crack it. Thick glaze needs two hits!',
    },
    {
      id: 8, name: 'Bomb Voyage', moves: 25, colors: 6, seed: 8008,
      rows: 9, cols: 9,
      layout: [
        '.........',
        '.........',
        '.........',
        '.........',
        '.........',
        '.........',
        '.........',
        '.........',
        '.........',
      ],
      goals: [{ type: 'collect', color: 2, count: 30 }, { type: 'collect', color: 5, count: 30 }],
      stars: [2000, 5500, 7000],
      tutorial: 'Match 5 in a line to make a Color Bomb. Swap it with a candy to clear every candy of that color!',
    },
    {
      id: 9, name: 'Twisty Orchard', moves: 30, colors: 6, seed: 9009,
      rows: 9, cols: 9,
      layout: [
        '...c.c...',
        '....c....',
        '#.......#',
        '##.....##',
        '#..jjj..#',
        '#.jjJjj.#',
        '#jjj.jjj#',
        '..j...j..',
        'xxxxxxxxx',
      ],
      goals: [{ type: 'jelly' }, { type: 'ingredients', count: 3 }],
      stars: [3500, 9500, 12500],
      tutorial: 'Two goals at once: wipe the glaze and bring all three cherries down through the orchard.',
    },
    {
      id: 10, name: 'Grand Gala', moves: 30, colors: 6, seed: 10010,
      rows: 9, cols: 9,
      layout: [
        '.........',
        '.JJ...JJ.',
        '.JJ.f.JJ.',
        '...F.F...',
        '.f.JJJ.f.',
        '...F.F...',
        '.JJ.f.JJ.',
        '.JJ...JJ.',
        '.........',
      ],
      goals: [{ type: 'jelly' }, { type: 'collect', color: 5, count: 30 }],
      stars: [3000, 8000, 9500],
      tutorial: 'The grand finale! Clear every bit of glaze and collect the purple clusters. Combine specials for huge blasts.',
    },
  ];

  SC.LEVELS = LEVELS;
  if (typeof module === 'object' && module.exports) module.exports = LEVELS;
})(typeof window !== 'undefined' ? window : globalThis);

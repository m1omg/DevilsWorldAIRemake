/*
 * Devil's Maze — maze layouts.
 *
 * The layouts are original designs made for this remake (generated with a
 * symmetric, dead-end-free lattice search and then hand-picked). Each maze is
 * 20 x 14 cells and wraps around at every edge, like a torus: walking off the
 * right side brings you back on the left. Only a 16 x 10 window is visible at
 * any time, and the Devil scrolls the maze under that window.
 *
 *   #  wall      .  floor      N  the Devil's nest (enemies hatch here)
 *
 * Item positions are [x, y] cell coordinates.
 */
(function (root) {
  'use strict';
  const DM = (root.DM = root.DM || {});
  const { mod } = DM.util;

  const RING_CORNERS = [
    [8, 6],
    [12, 6],
    [8, 10],
    [12, 10],
  ];
  const STD_CROSSES = [
    [4, 4],
    [16, 4],
    [4, 12],
    [16, 12],
    [10, 0],
    [0, 8],
  ];
  const STD_TREATS = [
    [2, 2],
    [18, 2],
    [2, 12],
    [18, 12],
  ];
  const STD_BIBLES = [
    [4, 4],
    [16, 4],
    [4, 12],
    [16, 12],
  ];
  const STD_STARTS = {
    one: [[10, 12]],
    two: [
      [6, 12],
      [14, 12],
    ],
  };

  const LAYOUTS = {
    amethyst: {
      name: 'Amethyst Halls',
      palette: 'amethyst',
      rows: [
        '...#.....#.#.....#..',
        '##.#####.#.#.#####.#',
        '.....#.........#....',
        '##.#.#.#######.#.#.#',
        '...#...#.....#...#..',
        '.###.#.#.###.#.#.###',
        '.....#.........#....',
        '.#####.#.NNN.#.#####',
        '.#.....#.NNN.#.....#',
        '.#.#.###.NNN.###.#.#',
        '...#...#.....#...#..',
        '####.#.###.###.#.###',
        '.....#.........#....',
        '.###.#####.#####.###',
      ],
    },
    ember: {
      name: 'Ember Forge',
      palette: 'ember',
      rows: [
        '...#...#.....#...#..',
        '##.#.#.#.###.#.#.#.#',
        '...#.#.........#.#..',
        '.###.###.#.#.###.###',
        '...#.....#.#.....#..',
        '##.#.#.###.###.#.#.#',
        '.....#.........#....',
        '##.#####.NNN.#####.#',
        '...#.....NNN.....#..',
        '##.#.###.NNN.###.#.#',
        '.....#.........#....',
        '.#####.###.###.#####',
        '.#.......#.#.......#',
        '.#.###.#.#.#.#.###.#',
      ],
    },
    abyss: {
      name: 'Abyssal Deep',
      palette: 'abyss',
      rows: [
        '.....#.........#....',
        '####.#.#######.#.###',
        '.....#.........#....',
        '.###.###.#.#.###.###',
        '...#.....#.#.....#..',
        '##.###.###.###.###.#',
        '...#...#.....#...#..',
        '.###.#.#.NNN.#.#.###',
        '.....#...NNN...#....',
        '.###.#.#.NNN.#.#.###',
        '...#...#.....#...#..',
        '##.###.###.###.###.#',
        '...#.....#.#.....#..',
        '.###.###.#.#.###.###',
      ],
    },
    sulfur: {
      name: 'Sulfur Pits',
      palette: 'sulfur',
      rows: [
        '.#.#.............#.#',
        '.#.#.###.###.###.#.#',
        '.....#.........#....',
        '.#####.#.###.#.#####',
        '.....#.#.....#.#....',
        '.#.#.#.###.###.#.#.#',
        '.#.#...#.....#...#.#',
        '.#.###.#.NNN.#.###.#',
        '.#.#...#.NNN.#...#.#',
        '.#.#.###.NNN.###.#.#',
        '.#.#.............#.#',
        '.#.###.#.###.#.###.#',
        '.#.....#.....#.....#',
        '.#.#######.#######.#',
      ],
    },
    vault: {
      name: 'Treasure Vault',
      palette: 'vault',
      bonus: true,
      rows: [
        '.....#.........#....',
        '.###.#####.#####.###',
        '.....#.........#....',
        '##.#.#.###.###.#.#.#',
        '...#...#.....#...#..',
        '.#####.#.###.#.#####',
        '...#...#.....#...#..',
        '.#.#.###.NNN.###.#.#',
        '.#.......NNN.......#',
        '.#.#.###.NNN.###.#.#',
        '...#...#.....#...#..',
        '.#####.#.###.#.#####',
        '...#...#.....#...#..',
        '##.#.#.###.###.#.#.#',
      ],
      starts: {
        one: [[10, 10]],
        two: [
          [8, 10],
          [12, 10],
        ],
      },
      // Arrow tiles: [x, y, dir] where dir is 0 up, 1 right, 2 down, 3 left.
      arrows: [
        [4, 10, 0],
        [16, 10, 0],
        [4, 4, 2],
        [16, 4, 2],
        [14, 8, 3],
        [14, 0, 3],
        [6, 8, 1],
        [6, 0, 1],
      ],
      chests: [
        [10, 0],
        [0, 8],
        [2, 2],
        [18, 2],
        [6, 12],
        [14, 12],
      ],
    },
  };

  const ROTATION = ['amethyst', 'ember', 'abyss', 'sulfur'];
  const cache = {};

  function parse(id) {
    const def = LAYOUTS[id];
    if (!def) throw new Error('Unknown maze: ' + id);
    const W = def.rows[0].length;
    const H = def.rows.length;
    const grid = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const row = def.rows[y];
      if (row.length !== W) throw new Error('Ragged maze row in ' + id);
      for (let x = 0; x < W; x++) {
        const ch = row[x];
        grid[y * W + x] = ch === '#' ? 1 : ch === 'N' ? 2 : 0;
      }
    }
    return {
      id,
      name: def.name,
      palette: def.palette,
      bonus: !!def.bonus,
      W,
      H,
      grid,
      nest: { x0: 9, y0: 7, x1: 11, y1: 9, cx: 10, cy: 8, door: [10, 7], exit: [10, 6] },
      starts: def.starts || STD_STARTS,
      crosses: def.bonus ? [] : STD_CROSSES,
      treats: def.bonus ? [] : STD_TREATS,
      bibles: def.bonus ? [] : STD_BIBLES,
      seals: def.bonus ? [] : RING_CORNERS,
      arrows: def.arrows || [],
      chests: def.chests || [],
    };
  }

  function get(id) {
    return cache[id] || (cache[id] = parse(id));
  }

  // Cell type with wrap-around: 0 floor, 1 wall, 2 nest.
  function cell(maze, x, y) {
    return maze.grid[mod(y, maze.H) * maze.W + mod(x, maze.W)];
  }

  function isFloor(maze, x, y) {
    return cell(maze, x, y) === 0;
  }

  function forRound(round) {
    return ROTATION[(Math.max(1, round) - 1) % ROTATION.length];
  }

  DM.mazes = { LAYOUTS, ROTATION, get, cell, isFloor, forRound, BONUS_ID: 'vault' };
})(typeof window !== 'undefined' ? window : globalThis);

// Original pixel sprites for Mica the scarf-fox and the patrol bugs of Bukit Arang.
// Rows are drawn 1:1 into the canvas. '.' is empty.

export const PALETTE = {
  K: '#1b1424',
  F: '#ffd56a',
  D: '#e39a32',
  A: '#c47a28',
  W: '#fff6e4',
  E: '#1b1424',
  S: '#ff4b5c',
  C: '#d62540',
  B: '#7a4630',
  L: '#5c3c2a',
  N: '#ff4b5c',
  M: '#2c241c',
}

export const PLAYER = {
  idle: [
    '................',
    '.....AA.........',
    '....AFFFA.......',
    '...AFFFFFFA.....',
    '...AFFWWFFA.....',
    '...AFEWWFFA.....',
    '...AFFNWFFA.....',
    '....CSSSSSC.....',
    '.....FFFFFB.....',
    '....DFFFFFBB....',
    '...DDFFFFBBB....',
    '....DFFFFFB.....',
    '.....LL..LL.....',
    '....LLL..LLL....',
    '................',
    '................',
  ],
  walk: [
    '................',
    '.....AA.........',
    '....AFFFA.......',
    '...AFFFFFFA.....',
    '...AFFWWFFA.....',
    '...AFEWWFFA.....',
    '...AFFNWFFA.....',
    '....CSSSSSC.....',
    '.....FFFFFB.....',
    '....DFFFFFBB....',
    '...DDFFFFBBB....',
    '....DFFFFFB.....',
    '....LL....LL....',
    '...LLL....LLL...',
    '................',
    '................',
  ],
  jump: [
    '................',
    '.....AA.........',
    '....AFFFA.......',
    '...AFFFFFFA.....',
    '...AFFWWFFA.....',
    '...AFEWWFFA.....',
    '...AFFNWFFA.....',
    '...CCSSSSSCC....',
    '.....FFFFFB.....',
    '....DFFFFFBB....',
    '...DDFFFFBBB....',
    '....DFFFFFB.....',
    '......LLLL......',
    '.....LL..LL.....',
    '................',
    '................',
  ],
}

const GRUB_BODY = [
  '................',
  '.....K....K.....',
  '.....E....E.....',
  '....KKKKKKKK....',
  '...KOOOOOOOOOK..',
  '..KOOKOOOOOKOOK.',
  '..KOBBOOOOBBOOK.',
  '..KOOOOOOOOOOOK.',
  '...KOOOOOOOOOK..',
  '....KKKKKKKK....',
  '...M........M...',
  '..MM........MM..',
  '................',
  '................',
]

const GRUB_WALK = [
  '................',
  '.....K....K.....',
  '.....E....E.....',
  '....KKKKKKKK....',
  '...KOOOOOOOOOK..',
  '..KOOKOOOOOKOOK.',
  '..KOBBOOOOBBOOK.',
  '..KOOOOOOOOOOOK.',
  '...KOOOOOOOOOK..',
  '....KKKKKKKK....',
  '..M..........M..',
  '.MM..........MM.',
  '................',
  '................',
]

export const GRUB_PALETTE = {
  K: '#2a1614',
  E: '#ffe08a',
  O: '#e2582c',
  B: '#ffb067',
  M: '#3a2420',
}

export const MOTH_PALETTE = {
  K: '#241830',
  E: '#e8fff6',
  O: '#6d5cff',
  B: '#c4b6ff',
  M: '#1a1230',
}

export const ENEMY = { idle: GRUB_BODY, walk: GRUB_WALK }

export const GLYPHS = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  M: ['10001', '11011', '10101', '10001', '10001'],
  I: ['111', '010', '010', '010', '111'],
  C: ['111', '100', '100', '100', '111'],
  A: ['0110', '1001', '1111', '1001', '1001'],
  '/': ['001', '010', '010', '010', '100'],
}

function assertRectangular(name, rows) {
  const width = rows[0].length
  for (const row of rows) {
    if (row.length !== width) throw new Error(`${name} is not rectangular`)
  }
}

assertRectangular('idle', PLAYER.idle)
assertRectangular('walk', PLAYER.walk)
assertRectangular('jump', PLAYER.jump)
assertRectangular('grub', ENEMY.idle)
assertRectangular('grub-walk', ENEMY.walk)

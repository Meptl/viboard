#!/usr/bin/env node

'use strict';

/**
 * 5-row ASCII block text renderer.
 *
 * Each '#' marks the left edge of a 2-column-wide block, which creates
 * overlapping diagonals when rows shift by one column.
 */
const GLYPHS = {
  ' ': [
    ' ',
    ' ',
    ' ',
    ' ',
    ' ',
  ],
  A: [
    '.####.',
    '#....#',
    '######',
    '#....#',
    '#....#',
  ],
  B: [
    '#####.',
    '#....#',
    '#####.',
    '#....#',
    '#####.',
  ],
  C: [
    '.#####',
    '#.....',
    '#.....',
    '#.....',
    '.#####',
  ],
  D: [
    '#####.',
    '#....#',
    '#....#',
    '#....#',
    '#####.',
  ],
  E: [
    '######',
    '#.....',
    '###...',
    '#.....',
    '######',
  ],
  F: [
    '######',
    '#.....',
    '#####.',
    '#.....',
    '#.....',
  ],
  G: [
    '.#####',
    '#.....',
    '#.####',
    '#....#',
    '.#####',
  ],
  H: [
    '#....#',
    '#....#',
    '######',
    '#....#',
    '#....#',
  ],
  I: [
    '#',
    '#',
    '#',
    '#',
    '#',
  ],
  J: [
    '..####',
    '.....#',
    '.....#',
    '#....#',
    '.####.',
  ],
  K: [
    '#....#',
    '#...#.',
    '####..',
    '#...#.',
    '#....#',
  ],
  L: [
    '#.....',
    '#.....',
    '#.....',
    '#.....',
    '######',
  ],
  M: [
    '#.....#',
    '##...##',
    '#.###.#',
    '#.....#',
    '#.....#',
  ],
  N: [
    '#.....#',
    '##....#',
    '#.#...#',
    '#..#..#',
    '#...###',
  ],
  O: [
    '.####.',
    '#....#',
    '#....#',
    '#....#',
    '.####.',
  ],
  P: [
    '#####.',
    '#....#',
    '#####.',
    '#.....',
    '#.....',
  ],
  Q: [
    '.#####.',
    '#.....#',
    '#.....#',
    '#..##.#',
    '.######',
  ],
  R: [
    '#####.',
    '#....#',
    '#####.',
    '#.###.',
    '#....#',
  ],
  S: [
    '.#####',
    '#.....',
    '.####.',
    '.....#',
    '#####.',
  ],
  T: [
    '######',
    '.####.',
    '.####.',
    '.####.',
    '.####.',
  ],
  U: [
    '#....#',
    '#....#',
    '#....#',
    '#....#',
    '.####.',
  ],
  V: [
    '#.....#',
    '#.....#',
    '#.....#',
    '.#...#.',
    '..###..',
  ],
  W: [
    '#.....#',
    '#.....#',
    '#.###.#',
    '##...##',
    '#.....#',
  ],
  X: [
    '#.....#',
    '.#...#.',
    '..###..',
    '.#...#.',
    '#.....#',
  ],
  Y: [
    '#.....#',
    '.#...#.',
    '..###..',
    '..###..',
    '..###..',
  ],
  Z: [
    '######',
    '..###.',
    '.#....',
    '#.....',
    '######',
  ],

  '0': [
    '.####.',
    '#....#',
    '#....#',
    '#....#',
    '.####.',
  ],
  '1': [
    '.#.',
    '##.',
    '.#.',
    '.#.',
    '###',
  ],
  '2': [
    '#####.',
    '.....#',
    '.####.',
    '#.....',
    '######',
  ],
  '3': [
    '#####.',
    '.....#',
    '.####.',
    '.....#',
    '#####.',
  ],
  '4': [
    '#....#',
    '#....#',
    '######',
    '.....#',
    '.....#',
  ],
  '5': [
    '######',
    '#.....',
    '#####.',
    '.....#',
    '#####.',
  ],
  '6': [
    '.#####',
    '#.....',
    '#####.',
    '#....#',
    '.####.',
  ],
  '7': [
    '######',
    '.....#',
    '..###.',
    '.#....',
    '#.....',
  ],
  '8': [
    '.####.',
    '#....#',
    '.####.',
    '#....#',
    '.####.',
  ],
  '9': [
    '.####.',
    '#....#',
    '.#####',
    '.....#',
    '#####.',
  ],

  '-': [
    '......',
    '......',
    '######',
    '......',
    '......',
  ],
  '_': [
    '......',
    '......',
    '......',
    '......',
    '######',
  ],
  '.': [
    '.',
    '.',
    '.',
    '.',
    '#',
  ],
  '/': [
    '.....#',
    '..###.',
    '.#....',
    '#.....',
    '......',
  ],
  '?': [
    '#####.',
    '.....#',
    '.####.',
    '......',
    '.#....',
  ],
};

const SHADOW_CHARS = ['═', '║', '╔', '╗', '╚', '╝', '╠', '╣', '╦', '╩', '╬'];

function normalizeGlyph(glyph) {
  const rows = glyph.map((r) => (r || '').trimEnd());
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return { rows, width };
}

function buildBlockCanvas(input, options = {}) {
  const text = String(input || '');
  const gap = options.gap ?? 1;
  const fallback = normalizeGlyph(GLYPHS['?']);

  const normalized = [...text].map((char) => {
    const key = char.toUpperCase();
    return normalizeGlyph(GLYPHS[key] ?? fallback.rows);
  });

  const totalWidth = normalized.reduce((sum, glyph, idx) => {
    const painted = glyph.width + (glyph.width > 0 ? 1 : 0);
    const spacer = idx < normalized.length - 1 ? gap : 0;
    return sum + painted + spacer;
  }, 0);

  if (totalWidth === 0) {
    return [];
  }

  const canvas = Array.from({ length: 5 }, () => Array(totalWidth).fill(' '));
  let cursor = 0;

  for (let gIndex = 0; gIndex < normalized.length; gIndex += 1) {
    const glyph = normalized[gIndex];

    for (let y = 0; y < 5; y += 1) {
      const row = glyph.rows[y] ?? '';
      for (let x = 0; x < row.length; x += 1) {
        if (row[x] !== '#') {
          continue;
        }

        const left = cursor + x;
        const right = cursor + x + 1;

        if (left >= 0 && left < totalWidth) {
          canvas[y][left] = '█';
        }
        if (right >= 0 && right < totalWidth) {
          canvas[y][right] = '█';
        }
      }
    }

    const paintedWidth = glyph.width + (glyph.width > 0 ? 1 : 0);
    cursor += paintedWidth;
    if (gIndex < normalized.length - 1) {
      cursor += gap;
    }
  }

  return canvas;
}

function boxCharForConnections(connections) {
  const key = ['up', 'right', 'down', 'left']
    .filter((dir) => connections[dir])
    .join(',');

  switch (key) {
    case 'up,down':
    case 'up':
    case 'down':
      return '║';
    case 'right,left':
    case 'right':
    case 'left':
      return '═';
    case 'right,down':
      return '╔';
    case 'down,left':
      return '╗';
    case 'up,right':
      return '╚';
    case 'up,left':
      return '╝';
    case 'up,right,down':
      return '╠';
    case 'up,down,left':
      return '╣';
    case 'right,down,left':
      return '╦';
    case 'up,right,left':
      return '╩';
    case 'up,right,down,left':
      return '╬';
    default:
      return '╬';
  }
}

// @lat: [[ascii-block-text#Bottom Right Shadow]]
function applyBottomRightShadow(baseCanvas, offsetX = 1, offsetY = 1) {
  if (baseCanvas.length === 0) {
    return baseCanvas;
  }

  const height = baseCanvas.length;
  const width = baseCanvas[0].length;
  const outHeight = height + offsetY;
  const outWidth = width + offsetX;

  const isBaseFilled = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return false;
    }
    return baseCanvas[y][x] === '█';
  };

  const shadowMask = Array.from({ length: outHeight }, () =>
    Array(outWidth).fill(false),
  );

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isBaseFilled(x, y)) {
        continue;
      }

      const shadowX = x + offsetX;
      const shadowY = y + offsetY;
      if (isBaseFilled(shadowX, shadowY)) {
        continue;
      }
      shadowMask[shadowY][shadowX] = true;
    }
  }

  const outCanvas = Array.from({ length: outHeight }, () =>
    Array(outWidth).fill(' '),
  );

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (baseCanvas[y][x] === '█') {
        outCanvas[y][x] = '█';
      }
    }
  }

  const isShadowFilled = (x, y) => {
    if (x < 0 || y < 0 || x >= outWidth || y >= outHeight) {
      return false;
    }
    return shadowMask[y][x];
  };

  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      if (!shadowMask[y][x]) {
        continue;
      }
      if (outCanvas[y][x] === '█') {
        continue;
      }

      const connections = {
        up: isShadowFilled(x, y - 1),
        right: isShadowFilled(x + 1, y),
        down: isShadowFilled(x, y + 1),
        left: isShadowFilled(x - 1, y),
      };
      outCanvas[y][x] = boxCharForConnections(connections);
    }
  }

  return outCanvas;
}

function renderCanvas(canvas) {
  return canvas.map((row) => row.join('').replace(/\s+$/g, '')).join('\n');
}

function renderBlockText(input, options = {}) {
  const baseCanvas = buildBlockCanvas(input, options);
  const withShadow = options.shadow
    ? applyBottomRightShadow(baseCanvas, 1, 1)
    : baseCanvas;
  return renderCanvas(withShadow);
}

function printUsage() {
  console.log(
    'Usage: node scripts/ascii-block-text.js "Your Text" [--gap 1] [--shadow] [--shadow-chars]',
  );
}

function parseArgs(argv) {
  const args = [...argv];
  let gap = 1;
  let shadow = false;
  let shadowChars = false;
  const textParts = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      return { help: true };
    }

    if (arg === '--gap') {
      const raw = args[i + 1];
      if (raw == null || Number.isNaN(Number(raw))) {
        throw new Error('--gap requires an integer value');
      }
      gap = Math.max(0, Math.trunc(Number(raw)));
      i += 1;
      continue;
    }

    if (arg === '--shadow') {
      shadow = true;
      continue;
    }

    if (arg === '--shadow-chars') {
      shadowChars = true;
      continue;
    }

    textParts.push(arg);
  }

  return {
    help: false,
    gap,
    shadow,
    shadowChars,
    text: textParts.join(' '),
  };
}

function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(String(error.message || error));
    printUsage();
    process.exit(1);
  }

  if (parsed.help || !parsed.text) {
    if (parsed.shadowChars) {
      console.log(SHADOW_CHARS.join(' '));
      process.exit(0);
    }
    printUsage();
    process.exit(parsed.help ? 0 : 1);
  }

  if (parsed.shadowChars) {
    console.log(SHADOW_CHARS.join(' '));
    process.exit(0);
  }

  const output = renderBlockText(parsed.text, {
    gap: parsed.gap,
    shadow: parsed.shadow,
  });
  console.log(output);
}

if (require.main === module) {
  main();
}

module.exports = {
  renderBlockText,
};

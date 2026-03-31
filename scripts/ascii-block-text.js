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

function normalizeGlyph(glyph) {
  const rows = glyph.map((r) => (r || '').trimEnd());
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return { rows, width };
}

function renderBlockText(input, options = {}) {
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
    return '';
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

  return canvas.map((row) => row.join('').replace(/\s+$/g, '')).join('\n');
}

function printUsage() {
  console.log('Usage: node scripts/ascii-block-text.js "Your Text" [--gap 1]');
}

function parseArgs(argv) {
  const args = [...argv];
  let gap = 1;
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

    textParts.push(arg);
  }

  return {
    help: false,
    gap,
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
    printUsage();
    process.exit(parsed.help ? 0 : 1);
  }

  const output = renderBlockText(parsed.text, { gap: parsed.gap });
  console.log(output);
}

if (require.main === module) {
  main();
}

module.exports = {
  renderBlockText,
};

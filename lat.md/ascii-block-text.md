# ASCII Block Text CLI

This section documents the block-text utility used to render banner text in terminals and how optional styling changes the output shape.

The renderer is implemented in [[scripts/ascii-block-text.js#renderBlockText]] and builds five-row glyphs from the `GLYPHS` table.

## Bottom Right Shadow

The optional shadow mode projects the block glyphs one cell down and right, then traces that projection using box-drawing characters so the text reads with a terminal-friendly drop-shadow effect.

The behavior is controlled via `--shadow` in [[scripts/ascii-block-text.js#parseArgs]] and rendered by [[scripts/ascii-block-text.js#applyBottomRightShadow]].

## Shadow Character Set

The CLI can print its supported box-drawing shadow glyphs so terminal art can be previewed or reused consistently in scripts.

Use `--shadow-chars` from [[scripts/ascii-block-text.js#parseArgs]], which prints the characters from [[scripts/ascii-block-text.js#SHADOW_CHARS]].

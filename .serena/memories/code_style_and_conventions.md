# Code Style and Conventions

## Rust
- Formatting: `rustfmt` (see `rustfmt.toml`).
- Conventions: snake_case modules/functions, PascalCase types.
- Keep imports grouped by crate.
- Prefer small functions and useful derives (`Debug`, `Serialize`, `Deserialize`) when appropriate.
- Tests: colocated unit tests with `#[cfg(test)]` when feasible.

## TypeScript/React
- Formatting/Linting: ESLint + Prettier.
- Style: 2 spaces, single quotes, ~80 column width.
- Naming: PascalCase components, camelCase variables/functions, kebab-case filenames when practical.
- Keep runtime logic tested lightly when introduced.

## Shared types
- Use `ts-rs` via Rust source annotations.
- Do not manually edit `shared/types.ts`.
- Regeneration source entry: `crates/server/src/bin/generate_types.rs`.
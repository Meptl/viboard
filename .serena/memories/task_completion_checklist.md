# Task Completion Checklist

When finishing a change, run the smallest relevant validation set first, then broaden if needed:

1. Frontend work:
- `pnpm run check`
- `pnpm run lint`

2. Backend/Rust work:
- `pnpm run backend:check`
- `cargo test --workspace` (or targeted crate tests during iteration)

3. Shared type changes:
- `pnpm run generate-types`
- Ensure `shared/types.ts` updates are generated, not manually edited.

4. DB-related changes:
- `pnpm run prepare-db` (or `pnpm run remote:prepare-db` for remote package/postgres flows).

5. Final sanity:
- Run relevant entrypoint(s) (`pnpm run dev`, backend/frontend dev commands) when behavior needs manual verification.
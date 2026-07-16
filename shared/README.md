# Shared modules

Pure TypeScript for the Vite app and unit tests. Edge Functions keep mirrored copies under
`supabase/functions/_shared/` (Supabase deploy only bundles that tree).

| Shared file | Edge mirror |
|-------------|-------------|
| `shiftHours.ts` | `_shared/shiftHours.ts` |
| `rootStateValidation.ts` | `_shared/rootStateValidation.ts` |

When editing either side, update both. `dayLogExtract` remains Deno-self-contained under `_shared/`
(parallel to `src/lib/dayLogExtract.ts`).

<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- App data/auth use `src/integrations/external-supabase/client.ts` (the owner's existing database), never `@/integrations/supabase/client` — the owner keeps their own backend.
- Ported screens use `@/lib/router-compat` for navigation helpers — keeps original code close to the GitHub source.
- All app pages render client-only (providers wrapped in ClientOnly in `__root.tsx`, routes `ssr: false`) — sign-in state lives in browser storage.

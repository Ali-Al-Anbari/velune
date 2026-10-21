# Velune project notes

- Keep TypeScript strict and the `src/` structure small.
- Preserve the honest coming-soon state until real shift and earnings features are requested.
- Authentication uses the single browser Supabase client in `src/lib/supabase.ts`.
- Never put service-role or secret keys in Vite environment variables. Do not cache auth API responses or private user data.
- Review SQL migrations and apply them manually; never auto-apply production schema changes.
- Do not add financial calculations or offline data synchronization without a separate request.
- Cache only static application assets in the service worker. Never cache private user data.
- Do not force a service worker update or reload during an active session.
- Run lint, typecheck, tests, and build before handing off changes.

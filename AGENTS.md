# Velune project notes

- Keep TypeScript strict and the `src/` structure small.
- Preserve the honest coming-soon state until real shift and earnings features are requested.
- Do not add authentication, Supabase integration, financial calculations, or offline data synchronization as part of foundation work.
- Cache only static application assets in the service worker. Never cache private user data.
- Do not force a service worker update or reload during an active session.
- Run lint, typecheck, tests, and build before handing off changes.

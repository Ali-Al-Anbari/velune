# Velune

A mobile-first React, TypeScript, and Vite PWA. Supabase Auth protects a shift logger with paid and unpaid breaks and persistent history. Earnings features have not been implemented.

## Local setup

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
cp .env.example .env.local
npm run dev
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local`. Restart Vite after changing them. Development shows a setup message if either value is missing or invalid. Use only a publishable or legacy anon key; `VITE_` values are embedded in the browser bundle. Never use a secret or service-role key. Set these two variables separately in Vercel for the intended environment; this repository does not configure deployment.

## Supabase Auth URL setup

Email/password and email confirmation must be enabled in Supabase. In **Authentication → URL Configuration**, set the Site URL to the exact production origin. Add these exact redirect URLs to the allow list:

- `https://YOUR-DOMAIN/auth/callback`
- `https://YOUR-DOMAIN/auth/recovery`
- `http://localhost:5173/auth/callback`
- `http://localhost:5173/auth/recovery`

Add exact preview URLs only when testing a trusted Vercel preview. The app generates redirect URLs from its current origin and never accepts an arbitrary return URL. If email templates have been customized, make sure their destination uses `{{ .RedirectTo }}` so signup and recovery links reach the appropriate path. `vercel.json` supplies the SPA rewrite needed for direct links to those paths. Test the URLs in a deployed preview before relying on them.

The Supabase browser client handles auth tokens in the redirect fragment. The UI waits for `getUser()` to validate restored sessions before showing the protected screen, then removes redirect fragments from browser history. A reset session is signed out after the password changes so the user signs in with the new password. Supabase stores the browser session locally for reopening the PWA; avoid using this app on a shared device without signing out.

## Profiles migration

Review [`supabase/migrations/20261020220000_create_profiles.sql`](supabase/migrations/20261020220000_create_profiles.sql), then apply its contents manually in the SQL Editor for the intended Supabase project. Confirm the selected project before running it. **This app does not apply migrations automatically.** The migration creates an optional `public.profiles` table with an `auth.users` primary-key reference, cascade delete, RLS, and owner-only SELECT, INSERT, and UPDATE policies. It does not create profile rows automatically. No anonymous grants or DELETE policy are provided.

### Manual RLS verification

Create two confirmed test users, copy their UUIDs from Auth, and replace `USER_A_UUID` and `USER_B_UUID` below. Run this in the SQL Editor **after applying the migration**. The transaction rolls back its test rows.

```sql
begin;
insert into public.profiles (id, display_name)
values ('USER_A_UUID', 'Test A'), ('USER_B_UUID', 'Test B')
on conflict (id) do nothing;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'USER_A_UUID', true);
select id from public.profiles; -- must contain A only
select count(*) from public.profiles where id = 'USER_B_UUID'; -- must be 0
update public.profiles set display_name = 'Should not change'
where id = 'USER_B_UUID' returning id; -- must return 0 rows
update public.profiles set display_name = 'Updated by A'
where id = 'USER_A_UUID' returning id; -- must return A
rollback;
```

In a separate transaction, `set local role anon; select * from public.profiles;` must fail with permission denied. Attempting `UPDATE public.profiles SET id = 'USER_B_UUID'` as `authenticated` must fail because the role has no UPDATE grant on `id`. Confirm those failures are expected before rolling back. Repeat the first transaction with A and B reversed. These checks exercise database permissions and RLS independently of the frontend.

## Shift logger migration

Review [`supabase/migrations/20261020230000_shift_logger.sql`](supabase/migrations/20261020230000_shift_logger.sql). Apply it manually in the SQL Editor of the intended Supabase project **after** the profiles migration. Do not apply it automatically to production. The migration creates `public.shifts` and `public.breaks`, enables RLS, and grants authenticated users read access only to their own records. All writes use four authenticated RPCs: `start_shift`, `begin_break`, `end_break`, and `end_shift`. Direct table writes are denied. The RPCs use database timestamps and a per-user transaction advisory lock; unique partial indexes enforce one active shift per user and one active break per shift. Start requests and begin-break requests carry client-generated UUIDs so repeating an uncertain request returns its original row. Ending a shift closes its active break at the same timestamp.

The app reads saved timestamps to calculate elapsed, paid break, unpaid break, and worked time. Paid breaks remain in worked time; unpaid breaks are subtracted. Durations use absolute instants, including across midnight and daylight saving changes. The browser displays dates and times in its local timezone. The app never queues offline writes: an unreachable save reports an error, and users can refresh state and retry. Keep the same request ID when retrying an uncertain start or break request.

### Shift RLS and concurrency checks

Use two confirmed test accounts in a **nonproduction** Supabase project. Obtain their UUIDs, then test each account through its own authenticated browser session or API JWT. As A, start a shift and a break. Verify A can read both, B sees zero rows in `shifts` and `breaks`, and B cannot call `begin_break`, `end_break`, or `end_shift` with A's IDs. Verify an anonymous request cannot read either table or execute the RPCs. Verify direct INSERT, UPDATE, and DELETE requests to both tables fail for an authenticated account. Repeat with A and B reversed.

For a SQL Editor check, use separate rolled-back transactions for each identity, replacing the UUIDs with real confirmed users. For example, after creating A's shift through its client, run:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'USER_B_UUID', true);
select count(*) from public.shifts where user_id = 'USER_A_UUID'; -- 0
select count(*) from public.breaks where shift_id = 'A_SHIFT_UUID'; -- 0
select public.end_shift('A_SHIFT_UUID'); -- must fail: Shift not found
rollback;
```

Use separate transactions for expected failures because a PostgreSQL error aborts its transaction. In two simultaneous A sessions, call `start_shift` with **different** UUIDs and verify exactly one active row exists. Do the same with `begin_break` on the same shift and different break UUIDs. Repeat each successful call with its **same** UUID and verify the row count stays one. Check that a later break cannot overlap the earlier one, and that ending during a break saves equal `ended_at` values on the shift and active break. These checks exercise the deployed database policies and concurrency; frontend unit tests alone cannot prove them.

## Checks

```sh
npm run lint
npm run typecheck
npm run test:run
npm run build
```

Preview with `npm run preview`. PWA installation and offline loading require localhost or HTTPS. The service worker precaches generated static application assets only; Supabase requests and private data are not cached. A new worker waits for a later session and never forces an active page to reload.

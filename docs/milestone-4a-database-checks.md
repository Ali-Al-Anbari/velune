# Milestone 4A database review and verification

Review `supabase/migrations/20261021000000_wage_profiles_and_tips.sql` and apply it manually in the intended Supabase project before deploying the new UI. Do not run it through an automatic GitHub deployment. It leaves old shifts without profiles intact, replaces only `start_shift`, and keeps its one-argument call valid through default parameters. Refresh the PostgREST schema cache if the new RPC signature is not visible immediately.

Use a local or staging database with two disposable, confirmed Auth users (`USER_A`, `USER_B`). Run each group below in a transaction and `rollback` it. Put expected failures behind a savepoint, then `rollback to savepoint` before continuing, or use a separate transaction for each failure. Use real UUIDs and a fresh UUID for each test row. Run the authenticated checks with the same database role and JWT claim context that PostgREST uses:

```sql
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'USER_A';
select auth.uid(); -- must equal USER_A
-- test statements here
rollback;
```

1. **Profiles and defaults.** As A, insert two `wage_profiles` with `user_id = USER_A`, positive integer `hourly_wage_cents`, and one `is_default = true`. Verify both are visible. Attempt to set the second default directly without clearing the first: `wage_profiles_one_active_default` must reject it. Call `set_default_wage_profile` for the second and verify exactly one active default. Attempt blank names, zero or oversized wages, withholding outside 0–10000 basis points, and `is_archived = true` with `is_default = true`; each must fail its constraint. Archive a profile referenced by a shift; the shift and its snapshot must remain.
2. **Profile ownership.** As B, `select`, `update`, and `delete` A's profile ID. Select and update must affect no rows; delete is not granted. Attempt to insert a profile with `user_id = USER_A`; RLS must reject it. Attempt to update the `user_id` column; the column privilege must reject it.
3. **Shift snapshots and concurrency.** As A, call `start_shift(SHIFT_ID, PROFILE_ID, null)` and inspect the returned profile name, wage, tip settings, and withholding snapshots. End the shift, edit the profile, and verify the shift snapshot is unchanged. Retry `start_shift` with the same `SHIFT_ID` but a different profile or override; the original row and snapshot must be returned. Start a new shift with an override in integer cents and verify both `hourly_wage_override_cents` and the effective `hourly_wage_cents_snapshot`. Attempt an active second shift and verify rejection. As B, attempt `start_shift` using A's profile and verify rejection. Verify an old shift with `wage_profile_id is null` remains readable.
4. **Tips.** As A, insert two tips in integer cents on an active shift; verify both rows and their sum. End the shift; insert, update, and delete a tip afterwards. Attempt zero, negative, or more than 1,000,000 cents and an invalid label; constraints must reject them. Retry inserting the same tip UUID; the primary key must prevent a duplicate. As B, try to read or update A's tips, add a tip to A's shift, and change a tip's `shift_id`; RLS or column privileges must reject these. Verify A can still read the original tips.
5. **Lifecycle regression.** As A, start and end multiple paid and unpaid breaks, then end the shift. Verify worked time in the app is unchanged: unpaid break duration is excluded and paid break duration remains included. Verify the one-active-shift and one-active-break constraints still reject duplicates.

The browser API uses a stable client-generated UUID for a tip create retry. On a duplicate-key response it reads the existing owned row and accepts the retry only if shift, amount, and label match. This behavior should also be checked by interrupting the network after a successful insert and retrying from the UI.

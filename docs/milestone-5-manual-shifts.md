# Milestone 5: manual shift verification

Review `supabase/migrations/20261022100000_manual_shift_management.sql` and apply it manually to the intended local or staging Supabase project before deploying this UI. Do not apply it automatically to production. It adds nullable creation request IDs and a version counter; existing shifts remain readable and start/end RPC behavior is unchanged.

The executable database checks are in `supabase/tests/manual_shift_management.test.sql`. With Supabase CLI and a local database running, apply the migration locally and run:

```sh
supabase test db
```

The SQL checks use throwaway Auth users inside a transaction and roll back. For concurrency, use two authenticated sessions editing the same completed shift: save in session A, then submit the stale editor from session B. The second save should report that the shift changed elsewhere. Also retry a create request after a simulated lost response and confirm it returns the original row without applying changed fields.

## Manual UI checks

1. Add a historical shift with an overnight range, an active wage profile, and an hourly override. Confirm the card displays the saved profile, worked time, wage rows, and calculated gross/after-withholding values.
2. Add a shift with no breaks, then add a shift with paid and unpaid breaks. Confirm breaks count in/out of worked duration according to their paid status.
3. Edit a completed shift’s times only after changing the wage profile settings. Confirm the original snapshot remains. Then select a different active profile and confirm the new current profile settings are saved as the shift snapshot.
4. Add, edit, and remove breaks. Confirm zero breaks are valid, adjacent breaks are accepted, overlapping breaks and breaks outside the shift are rejected, and invalid date ranges show an error.
5. Try a spring DST gap time in the device timezone; it should be rejected. For a repeated fall-back hour, unchanged stored values preserve the original timestamp; newly entered ambiguous local times resolve to the earlier occurrence and the editor states this behavior.
6. Edit a tip and tip-tax-withheld amount before and after shift edits. Confirm both values remain and wages refresh from the updated worked duration.
7. Edit the same shift in two tabs. The stale save should fail and require a reload.

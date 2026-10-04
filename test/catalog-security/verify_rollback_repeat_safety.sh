#!/bin/bash
# Proves the full-rollback self-backup's stop-if-exists behavior for real:
# running supabase/rollback/20261001000000_catalog_foundation_down.sql a
# SECOND time (e.g. an accidental re-run, or a retry after some unrelated
# step failed) must NOT silently overwrite the original backup tables with
# whatever super_vouchers/catalog_* look like at that later point (by then
# missing the very columns/tables the first backup existed to preserve) — it
# must fail loudly instead, leaving the original backup completely untouched.
#
# Usage: run from the repo root against a disposable Postgres instance:
#   bash test/catalog-security/verify_rollback_repeat_safety.sh
#
# Exits non-zero and prints which assertion failed if the property doesn't
# hold. Exits 0 and prints "REPEAT-RUN SAFETY: PASS" if it does.

set -u
# harness.sql hardcodes "giftsmart_test" (DROP/CREATE DATABASE + \c inside
# the file itself) — it must be run with this exact name, from a DIFFERENT
# starting database, or its own \c redirects the session away from whatever
# -d was passed.
DB=giftsmart_test
PSQL="sudo -u postgres psql"

fail() { echo "FAIL: $1"; exit 1; }

$PSQL -d postgres -f test/catalog-security/harness.sql >/dev/null 2>&1
$PSQL -d "$DB" -f supabase/migrations/20261001000000_catalog_foundation.sql >/tmp/rrs_mig1.log 2>&1
grep -qi error /tmp/rrs_mig1.log && fail "migration 1 did not apply cleanly, see /tmp/rrs_mig1.log"
$PSQL -d "$DB" -f supabase/migrations/20261002000000_catalog_cache_unification.sql >/tmp/rrs_mig2.log 2>&1
grep -qi error /tmp/rrs_mig2.log && fail "migration 2 did not apply cleanly, see /tmp/rrs_mig2.log"

echo "--- first run: full rollback (expected to succeed) ---"
$PSQL -v ON_ERROR_STOP=1 -d "$DB" -f supabase/rollback/20261001000000_catalog_foundation_down.sql > /tmp/rrs_first_run.log 2>&1
FIRST_EXIT=$?
if [ "$FIRST_EXIT" -ne 0 ]; then
  cat /tmp/rrs_first_run.log
  fail "first rollback run should have succeeded (exit 0) but exited $FIRST_EXIT"
fi
echo "first run exit code: $FIRST_EXIT (expected 0) - OK"

ORIGINAL_BACKUP_DUMP=$($PSQL -d "$DB" -t -A -c "SELECT md5(string_agg(t::text, '|' ORDER BY id)) FROM super_vouchers_rollback_backup t;")
ORIGINAL_BACKUP_COUNT=$($PSQL -d "$DB" -t -A -c "SELECT count(*) FROM super_vouchers_rollback_backup;")
echo "original backup: $ORIGINAL_BACKUP_COUNT row(s), content hash $ORIGINAL_BACKUP_DUMP"
[ "$ORIGINAL_BACKUP_COUNT" = "2" ] || fail "expected 2 rows in the original backup (harness seeds 2 super_vouchers), got $ORIGINAL_BACKUP_COUNT"

echo "--- second run: full rollback again (expected to FAIL, not overwrite) ---"
$PSQL -v ON_ERROR_STOP=1 -d "$DB" -f supabase/rollback/20261001000000_catalog_foundation_down.sql > /tmp/rrs_second_run.log 2>&1
SECOND_EXIT=$?
if [ "$SECOND_EXIT" -eq 0 ]; then
  cat /tmp/rrs_second_run.log
  fail "second rollback run should have FAILED (backup already exists) but exited 0"
fi
echo "second run exit code: $SECOND_EXIT (expected non-zero) - OK"

grep -q "super_vouchers_rollback_backup already exists" /tmp/rrs_second_run.log \
  || fail "second run's error did not mention the expected stop-if-exists message; see /tmp/rrs_second_run.log"
echo "second run correctly reported: already-exists stop message found - OK"

AFTER_BACKUP_DUMP=$($PSQL -d "$DB" -t -A -c "SELECT md5(string_agg(t::text, '|' ORDER BY id)) FROM super_vouchers_rollback_backup t;")
AFTER_BACKUP_COUNT=$($PSQL -d "$DB" -t -A -c "SELECT count(*) FROM super_vouchers_rollback_backup;")
[ "$AFTER_BACKUP_COUNT" = "$ORIGINAL_BACKUP_COUNT" ] || fail "backup row count changed after the failed second run: $ORIGINAL_BACKUP_COUNT -> $AFTER_BACKUP_COUNT"
[ "$AFTER_BACKUP_DUMP" = "$ORIGINAL_BACKUP_DUMP" ] || fail "backup content hash changed after the failed second run (it was overwritten): $ORIGINAL_BACKUP_DUMP -> $AFTER_BACKUP_DUMP"
echo "backup content and row count byte-identical after the failed second run - OK"

echo "--- private-permissions check on the backup table ---"
NOACCESS=$($PSQL -d "$DB" -t -A -c "
SET ROLE anon;
DO \$\$
BEGIN
  PERFORM 1 FROM super_vouchers_rollback_backup LIMIT 1;
  RAISE EXCEPTION 'anon_could_select';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'anon_correctly_denied';
END \$\$;
RESET ROLE;
" 2>&1)
echo "$NOACCESS" | grep -q "anon_correctly_denied" || fail "anon role could read super_vouchers_rollback_backup (private-permissions check failed): $NOACCESS"
echo "anon correctly denied SELECT on the backup table - OK"

$PSQL -d postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null

echo
echo "REPEAT-RUN SAFETY: PASS"
exit 0

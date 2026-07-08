DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT lower(btrim("email")) AS normalized_email
      FROM "employees_other_references"
      WHERE "email" IS NOT NULL
        AND "deleted_at" IS NULL
      GROUP BY lower(btrim("email"))
      HAVING count(*) > 1
    ) duplicate_emails
  ) THEN
    RAISE EXCEPTION 'Duplicate active employee emails exist after lowercase normalization. Resolve them before applying migration 0066.';
  END IF;
END
$$;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT lower(btrim("email")) AS normalized_email
      FROM "auth_accounts"
      GROUP BY lower(btrim("email"))
      HAVING count(*) > 1
    ) duplicate_accounts
  ) THEN
    RAISE EXCEPTION 'Duplicate auth account emails exist after lowercase normalization. Resolve them before applying migration 0066.';
  END IF;
END
$$;--> statement-breakpoint

UPDATE "employees_other_references"
SET "email" = lower(btrim("email"))
WHERE "email" IS NOT NULL;--> statement-breakpoint

UPDATE "auth_accounts"
SET "email" = lower(btrim("email"))
WHERE "email" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "auth_accounts" DROP CONSTRAINT "auth_accounts_email_unique";--> statement-breakpoint
DROP INDEX "uq_employee_reference_email_active";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_auth_accounts_email_lower" ON "auth_accounts" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "uq_employee_reference_email_active" ON "employees_other_references" USING btree (lower("email")) WHERE "employees_other_references"."email" is not null and "employees_other_references"."deleted_at" is null;

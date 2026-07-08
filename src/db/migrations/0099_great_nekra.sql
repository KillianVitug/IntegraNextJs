DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'attendance_dtr_correction_type'
      AND e.enumlabel = 'Same-Direction Duplicate'
  ) THEN
    ALTER TYPE "public"."attendance_dtr_correction_type" ADD VALUE 'Same-Direction Duplicate';
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'attendance_dtr_manual_status'
      AND e.enumlabel = 'Hold'
  ) THEN
    ALTER TYPE "public"."attendance_dtr_manual_status" ADD VALUE 'Hold';
  END IF;
END $$;

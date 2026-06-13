-- Add sale_amount to leads for tracking closed deal values
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sale_amount numeric;

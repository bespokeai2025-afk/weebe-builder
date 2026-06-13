-- Add pipeline_stage column to leads table for Sales Pipeline drag-and-drop
-- If not set, the app derives the stage from the lead's status field.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS pipeline_stage TEXT;

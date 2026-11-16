-- Migration 006: Add course thumbnail support
-- Safe: Additive change, nullable column, no disruption to existing records

ALTER TABLE courses ADD COLUMN IF NOT EXISTS thumbnail_key TEXT;

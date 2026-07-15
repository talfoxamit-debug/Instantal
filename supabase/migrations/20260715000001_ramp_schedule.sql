-- Configurable per-inbox ramp schedule. Previously the ramp thresholds/caps
-- were hardcoded in lib/sending/ramp.ts. This column lets an operator
-- customize the day thresholds and the three ramp-up caps per inbox from
-- Settings -> Inboxes -> Ramp schedule. Null = use the platform default
-- (unchanged behavior, fully backward compatible). Shape validated at the app
-- layer (lib/sending/ramp.ts RampConfig + validateRampConfig) since it's an
-- editor convenience column, not a compliance-critical one.
alter table public.inboxes
  add column if not exists ramp_schedule jsonb;

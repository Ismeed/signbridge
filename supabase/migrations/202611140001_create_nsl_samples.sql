-- SignBridge AI — Nigerian Sign Language Team Dataset Schema
-- Security model:
--   * Row-Level Security enabled with NO permissive anon/authenticated policies.
--   * Public browser clients never hold write/read credentials for this table.
--   * Next.js server routes & CLI training scripts access it strictly via service_role
--     after enforcing team/admin passcode and shape validation.

create table if not exists public.nsl_samples (
  id bigint generated always as identity primary key,
  sample_uid text not null,
  label_id text not null,
  label_name text not null,
  category text not null default 'NSL',
  signer_tag text not null default 'anonymous',
  feature_version text not null,
  feature_dim integer not null check (feature_dim = 145),
  sequence_length integer not null check (sequence_length = 30),
  sequence jsonb not null,
  raw_frame_count integer not null check (raw_frame_count >= 1),
  duration_ms integer not null check (duration_ms >= 0),
  fps_estimate real not null check (fps_estimate >= 0),
  hand_coverage_ratio real not null check (hand_coverage_ratio >= 0 and hand_coverage_ratio <= 1),
  handedness text not null check (handedness in ('left', 'right', 'both', 'none')),
  camera_facing text not null check (camera_facing in ('user', 'environment')),
  recorded_at timestamptz not null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'nsl_samples_sample_uid_unique'
      and conrelid = 'public.nsl_samples'::regclass
  ) then
    alter table public.nsl_samples
      add constraint nsl_samples_sample_uid_unique unique (sample_uid);
  end if;
end $$;

create index if not exists nsl_samples_label_id_idx
  on public.nsl_samples (label_id);

create index if not exists nsl_samples_signer_tag_idx
  on public.nsl_samples (signer_tag);

create index if not exists nsl_samples_created_at_idx
  on public.nsl_samples (created_at desc);

alter table public.nsl_samples enable row level security;
revoke all on table public.nsl_samples from anon, authenticated;

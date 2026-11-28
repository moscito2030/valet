// New tables only. Never alter or drop bridge_events, bridge_login_limits, or bridge_discussions.
// Schema migration never changes the storage switch state.
export const normalizedSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS bridge_storage_switch (
    id integer PRIMARY KEY CHECK (id = 1),
    mode text NOT NULL CHECK (mode IN ('legacy', 'normalized')),
    verified_at timestamptz,
    legacy_watermark timestamptz,
    event_count integer,
    note text NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS bridge_competitions (
    id text PRIMARY KEY,
    revision integer NOT NULL CHECK (revision > 0),
    document jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS bridge_competition_audit (
    competition_id text NOT NULL,
    seq integer NOT NULL,
    document jsonb NOT NULL,
    PRIMARY KEY (competition_id, seq)
  )`,
  `CREATE TABLE IF NOT EXISTS bridge_competition_requests (
    competition_id text NOT NULL,
    request_id text NOT NULL,
    ordinal integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (competition_id, request_id)
  )`,
  `CREATE TABLE IF NOT EXISTS bridge_stages (
    id text PRIMARY KEY,
    revision integer NOT NULL CHECK (revision > 0),
    competition_id text NOT NULL,
    settings jsonb NOT NULL,
    projection jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS bridge_participants (
    event_id text NOT NULL,
    participant_id text NOT NULL,
    ordinal integer NOT NULL,
    document jsonb NOT NULL,
    PRIMARY KEY (event_id, participant_id)
  )`,
  `CREATE TABLE IF NOT EXISTS bridge_assignments (
    event_id text NOT NULL,
    assignment_id text NOT NULL,
    ordinal integer NOT NULL,
    document jsonb NOT NULL,
    PRIMARY KEY (event_id, assignment_id)
  )`,
  `CREATE TABLE IF NOT EXISTS bridge_boards (
    event_id text NOT NULL,
    board_number integer NOT NULL,
    ordinal integer NOT NULL,
    document_json text NOT NULL,
    PRIMARY KEY (event_id, board_number)
  )`,
  `CREATE TABLE IF NOT EXISTS bridge_results (
    event_id text NOT NULL,
    assignment_id text NOT NULL,
    board integer NOT NULL,
    revision integer NOT NULL CHECK (revision > 0),
    written_at_event_revision integer NOT NULL,
    document jsonb NOT NULL,
    PRIMARY KEY (event_id, assignment_id, board)
  )`,
  `CREATE TABLE IF NOT EXISTS bridge_penalties (
    event_id text NOT NULL,
    participant_id text NOT NULL,
    amount jsonb NOT NULL,
    PRIMARY KEY (event_id, participant_id)
  )`,
  `CREATE TABLE IF NOT EXISTS bridge_audit (
    event_id text NOT NULL,
    seq integer NOT NULL,
    document jsonb NOT NULL,
    PRIMARY KEY (event_id, seq)
  )`,
  `CREATE TABLE IF NOT EXISTS bridge_requests (
    event_id text NOT NULL,
    request_id text NOT NULL,
    ordinal integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, request_id)
  )`,
  `ALTER TABLE bridge_requests ADD COLUMN IF NOT EXISTS ordinal integer NOT NULL DEFAULT 0`,
  `ALTER TABLE bridge_competition_requests ADD COLUMN IF NOT EXISTS ordinal integer NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS bridge_competition_redirects (
    from_id text PRIMARY KEY,
    to_id text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS bridge_discussion_threads (
    key text PRIMARY KEY,
    revision integer NOT NULL,
    closed boolean,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS bridge_discussion_comments (
    thread_key text NOT NULL,
    comment_id text NOT NULL,
    ordinal integer NOT NULL,
    document jsonb NOT NULL,
    PRIMARY KEY (thread_key, comment_id)
  )`,
  `CREATE TABLE IF NOT EXISTS bridge_organizers (
    id text PRIMARY KEY,
    document jsonb NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS bridge_access_codes (
    id text PRIMARY KEY,
    document jsonb NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS bridge_access_audit (
    id text PRIMARY KEY,
    document jsonb NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS bridge_agent_mutations (
    event_id text NOT NULL,
    actor_id text NOT NULL,
    key text NOT NULL,
    request_id text NOT NULL,
    body_hash text NOT NULL,
    response jsonb NOT NULL,
    PRIMARY KEY (event_id, actor_id, key),
    UNIQUE (event_id, actor_id, request_id)
  )`,
  `CREATE TABLE IF NOT EXISTS bridge_players (
    id text PRIMARY KEY,
    email_key text NOT NULL,
    document jsonb NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS bridge_pair_bindings (
    player_id text NOT NULL,
    event_id text NOT NULL,
    participant_id text NOT NULL,
    status text NOT NULL,
    PRIMARY KEY (player_id, event_id, participant_id)
  )`,
  `CREATE TABLE IF NOT EXISTS bridge_partner_notices (
    player_id text NOT NULL,
    event_id text NOT NULL,
    participant_id text NOT NULL,
    status text NOT NULL,
    PRIMARY KEY (player_id, event_id, participant_id)
  )`,
];

export const perTableSchemaStatements = [
  `CREATE SEQUENCE IF NOT EXISTS bridge_data_version`,
  `ALTER TABLE bridge_stages
     ADD COLUMN IF NOT EXISTS public_version bigint,
     ADD COLUMN IF NOT EXISTS organizer_id text GENERATED ALWAYS AS (settings->>'organizerId') STORED,
     ADD COLUMN IF NOT EXISTS current_round int GENERATED ALWAYS AS (coalesce((settings->>'currentRound')::int,0)) STORED,
     ADD COLUMN IF NOT EXISTS club_enabled boolean GENERATED ALWAYS AS ((settings->'club'->>'enabled')::boolean) STORED,
     ADD COLUMN IF NOT EXISTS table_mode boolean GENERATED ALWAYS AS (coalesce(settings->'club'->>'mode' = 'table',false)) STORED,
     ADD COLUMN IF NOT EXISTS archived boolean GENERATED ALWAYS AS ((settings->>'stageArchived')::boolean) STORED`,
  `ALTER TABLE bridge_competitions ADD COLUMN IF NOT EXISTS organizer_id text,
     ADD COLUMN IF NOT EXISTS archived boolean
     GENERATED ALWAYS AS ((document->>'archived')::boolean) STORED`,
  `ALTER TABLE bridge_assignments
    ADD COLUMN IF NOT EXISTS round integer,
    ADD COLUMN IF NOT EXISTS table_label text,
    ADD COLUMN IF NOT EXISTS room text,
    ADD COLUMN IF NOT EXISTS ns text,
    ADD COLUMN IF NOT EXISTS ew text,
    ADD COLUMN IF NOT EXISTS device_key text,
    ADD COLUMN IF NOT EXISTS version bigint,
    ADD COLUMN IF NOT EXISTS input_pair text,
    ADD COLUMN IF NOT EXISTS boards jsonb GENERATED ALWAYS AS (document->'boards') STORED,
    ADD COLUMN IF NOT EXISTS match_id text GENERATED ALWAYS AS (document->>'matchId') STORED,
    ADD COLUMN IF NOT EXISTS table_number boolean GENERATED ALWAYS AS (jsonb_typeof(document->'table') = 'number') STORED,
    ADD COLUMN IF NOT EXISTS player_names jsonb GENERATED ALWAYS AS (document->'playerNames') STORED,
    ADD COLUMN IF NOT EXISTS exempt boolean,
    ADD COLUMN IF NOT EXISTS provisional boolean,
    ADD COLUMN IF NOT EXISTS confirmation jsonb`,
  `CREATE INDEX IF NOT EXISTS bridge_assignments_round ON bridge_assignments(event_id, round)`,
  `CREATE INDEX IF NOT EXISTS bridge_assignments_version ON bridge_assignments(event_id, version)`,
  `CREATE TABLE IF NOT EXISTS bridge_club_tokens (
     event_id text NOT NULL, device_key text NOT NULL, token_hash text NOT NULL, movement_size int NOT NULL, device_label text,
     PRIMARY KEY(event_id, device_key), UNIQUE(event_id, token_hash)
   )`,
  `ALTER TABLE bridge_results ADD COLUMN IF NOT EXISTS status text GENERATED ALWAYS AS (coalesce(document->>'status','played')) STORED`,
  `ALTER TABLE bridge_penalties ADD COLUMN IF NOT EXISTS version bigint`,
  `CREATE INDEX IF NOT EXISTS bridge_penalties_version ON bridge_penalties(event_id, version)`,
  `CREATE TABLE IF NOT EXISTS bridge_projection_cache (
     event_id text NOT NULL, audience text NOT NULL CHECK (audience IN ('full','public','progress')),
     data_version bigint NOT NULL, projection jsonb NOT NULL, PRIMARY KEY(event_id, audience)
   )`,
  `ALTER TABLE bridge_storage_switch ADD COLUMN IF NOT EXISTS per_table_at timestamptz`,
];

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

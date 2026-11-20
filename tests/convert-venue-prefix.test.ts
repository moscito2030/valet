import assert from 'node:assert/strict';
import test from 'node:test';
import { convertVenuePrefix, formatVenueConversion } from '../lib/storage/convert-venue-prefix';
import { createTestDb } from './helpers/sql';

const competition = '8b01f0c3-dc13-4a5f-9178-cae97fdf5b44';
const final = '55178a2a-1a1e-4106-b525-dc3fe9ae9f50';
const november = '58f461bf-e3df-4dab-b5ac-88ba69025f2d';

test('venue conversion previews, updates known fields only, and preserves exact board bytes', async () => {
  const { sql, close } = await createTestDb();
  try {
    const metadata = { name: '社內賽', prefix: '臺灣大學橋藝社 115-1', venue: '臺灣大學 二活', revision: 4, hasStages: true };
    const unknown = { name: '老少盃', prefix: '臺灣大學橋藝社 114-1', venue: '台灣大學 第二學生活動中心 603' };
    await sql`UPDATE bridge_storage_switch SET mode = 'normalized' WHERE id = 1`;
    await sql`INSERT INTO bridge_competitions (id, revision, document) VALUES
      (${competition}, 4, ${JSON.stringify(metadata)}::jsonb),
      ('unknown', 4, ${JSON.stringify(unknown)}::jsonb),
      ('venue-only', 1, '{"name":"Venue only","venue":"Hall 3"}'::jsonb),
      ('empty', 1, '{"name":"Empty"}'::jsonb)`;
    await sql`INSERT INTO bridge_organizers (id, document) VALUES ('ntu-bridge-club', '{"name":"台大橋藝社"}')`;
    const fixtures = [
      [final, competition, { name: '老少盃', venueOverride: '704' }],
      [november, competition, { name: '11月社內賽', venue: '臺灣大學 二活705', venueOverride: '臺灣大學 二活705' }],
      ['rehearsal', competition, { name: '預演', venue: '704', stageArchived: true }],
      ['renamed-room', competition, { name: '正賽', venueOverride: '裁判另訂' }],
      ['extra', competition, { name: '決賽', venueOverride: '704' }],
      ['other', 'unknown', { name: '單場', venue: unknown.venue }],
    ] as const;
    for (const [id, parent, settings] of fixtures) {
      await sql`INSERT INTO bridge_stages (id, competition_id, revision, settings, projection)
        VALUES (${id}, ${parent}, 9, ${JSON.stringify({ ...settings, revision: 9, ...(id === 'extra' ? {} : { organizerId: 'ntu-bridge-club' }) })}::jsonb, '{"received":1}'::jsonb)`;
      const board = '{ "number":1, "deal":{ "N":["SA"], "E":["SK"], "S":["SQ"], "W":["SJ"] } }';
      await sql`INSERT INTO bridge_boards (event_id, board_number, ordinal, document_json)
        VALUES (${id}, 1, 0, ${board})`;
    }
    const boards = () => sql`SELECT * FROM bridge_boards ORDER BY event_id, board_number`;
    const competitions = () => sql`SELECT * FROM bridge_competitions ORDER BY id`;
    const stages = () => sql`SELECT * FROM bridge_stages ORDER BY id`;
    const before = { boards: await boards(), competitions: await competitions(), stages: await stages() };

    const preview = await convertVenuePrefix(sql, { dryRun: true });
    assert.deepEqual([preview.competitionsChanged, preview.competitionsSkipped, preview.competitionsUnchanged, preview.stagesChanged], [1, 2, 1, 2]);
    const output = formatVenueConversion(preview);
    assert.match(output, /organizer: "台大橋藝社" \(organizerId: "ntu-bridge-club"\)/);
    assert.match(output, /needs a human decision[\s\S]*stage extra "決賽" organizerId: null/);
    assert.match(output, /name: "社內賽" → "115-1 社內賽"/);
    assert.match(output, /Skipped – needs a human decision[\s\S]*裁判另訂[\s\S]*unknown name="老少盃" prefix="臺灣大學橋藝社 114-1"[\s\S]*台灣大學 第二學生活動中心 603/);
    assert.match(output, /stage extra "決賽": no approved room mapping/);
    assert.deepEqual({ boards: await boards(), competitions: await competitions(), stages: await stages() }, before);

    const applied = await convertVenuePrefix(sql, { dryRun: false });
    assert.equal(applied.competitionsChanged, 1);
    const after = { boards: await boards(), competitions: await competitions(), stages: await stages() };
    assert.deepEqual(after.boards, before.boards);
    const saved = after.competitions.find(row => row.id === competition)!;
    const document = saved.document as Record<string, unknown>;
    assert.equal(saved.revision, 5);
    assert.equal(document.revision, 5);
    assert.equal(document.name, '115-1 社內賽');
    assert.ok(!('organizer' in document));
    assert.ok(!('organizerId' in document));
    assert.match(formatVenueConversion(applied), /organizer: "台大橋藝社"/);
    assert.equal(document.venue, '臺灣大學 第二學生活動中心');
    assert.ok(!('prefix' in document));
    assert.deepEqual(after.competitions.filter(row => row.id !== competition), before.competitions.filter(row => row.id !== competition));
    for (const [id, room] of [[november, '705'], ['rehearsal', '704']]) {
      const row = after.stages.find(stage => stage.id === id)!;
      assert.equal(row.revision, 10);
      assert.equal((row.settings as Record<string, unknown>).venueOverride, room);
      assert.equal((row.settings as Record<string, unknown>).organizerId, 'ntu-bridge-club');
      assert.deepEqual(row.projection, { received: 1 });
    }
    const unchangedStage = (row: Record<string, unknown>) => row.id !== november && row.id !== 'rehearsal';
    assert.deepEqual(after.stages.filter(unchangedStage), before.stages.filter(unchangedStage));
    const repeated = await convertVenuePrefix(sql, { dryRun: false });
    assert.equal(repeated.competitionsChanged, 0);
    assert.equal(repeated.stagesChanged, 0);
    assert.deepEqual({ boards: await boards(), competitions: await competitions(), stages: await stages() }, after);
  } finally {
    await close();
  }
});

test('venue conversion rolls back the entire batch when a stage changes concurrently', async () => {
  const { sql, close } = await createTestDb();
  try {
    await sql`UPDATE bridge_storage_switch SET mode = 'normalized' WHERE id = 1`;
    await sql`INSERT INTO bridge_competitions (id, revision, document)
      VALUES (${competition}, 1, '{"name":"社內賽","venue":"裁判另訂","organizer":"另一主辦","prefix":"另一前綴"}')`;
    await sql`INSERT INTO bridge_stages (id, competition_id, revision, settings, projection)
      VALUES (${november}, ${competition}, 1, '{"name":"11月社內賽","venueOverride":"臺灣大學 二活705"}', '{}')`;
    const transaction = sql.transaction!;
    sql.transaction = async (batch) => {
      sql.transaction = transaction;
      await sql`UPDATE bridge_stages SET revision = 2, settings = settings || '{"venueOverride":"別間"}'::jsonb WHERE id = ${november}`;
      return transaction(batch);
    };
    await assert.rejects(convertVenuePrefix(sql, { dryRun: false }), /division by zero/);
    const [root] = await sql`SELECT revision, document FROM bridge_competitions WHERE id = ${competition}`;
    assert.equal(root.revision, 1);
    assert.deepEqual(root.document, { name: '社內賽', venue: '裁判另訂', organizer: '另一主辦', prefix: '另一前綴' });
    const report = await convertVenuePrefix(sql, { dryRun: false });
    assert.match(formatVenueConversion(report), /needs a human decision[\s\S]*Organizer: expected 台大橋藝社/);
    assert.match(formatVenueConversion(report), /venue: current "裁判另訂"/);
    assert.match(formatVenueConversion(report), /room: current "別間"/);
    assert.deepEqual((await sql`SELECT document FROM bridge_competitions WHERE id = ${competition}`)[0].document,
      { ...(root.document as object), name: '115-1 社內賽', revision: 2, updatedAt: (await sql`SELECT document->>'updatedAt' AS at FROM bridge_competitions WHERE id = ${competition}`)[0].at });
  } finally {
    await close();
  }
});

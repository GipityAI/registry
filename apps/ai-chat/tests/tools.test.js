// The functions the assistant calls as tools.

test('query_data answers a real analysis question over the seeded shop', async (ctx) => {
  const out = await ctx.fn.callAs(ctx.users.alice, 'query-data', {
    sql: `SELECT p.category, sum(oi.quantity * oi.unit_price)::numeric(12,2) AS revenue
          FROM order_items oi JOIN products p ON p.short_guid = oi.product_guid
          JOIN orders o ON o.short_guid = oi.order_guid
          WHERE o.status IN ('delivered','shipped','processing')
          GROUP BY p.category ORDER BY revenue DESC`,
  });
  assert.equal(out.error, undefined, out.error);
  assert.deepEqual(out.columns, ['category', 'revenue']);
  assert.equal(out.rowCount, 4);
  assert.ok(Number(out.rows[0].revenue) > 0);
});

test('query_data refuses anything but one SELECT', async (ctx) => {
  const q = (sql) => ctx.fn.callAs(ctx.users.alice, 'query-data', { sql });
  assert.match((await q('DELETE FROM orders')).error, /Only SELECT/);
  assert.match((await q('SELECT 1; DELETE FROM orders')).error, /one statement/);
  assert.match((await q('')).error, /Pass sql/);
});

test('query_data cannot write, even through a SELECT', async (ctx) => {
  const q = (sql) => ctx.fn.callAs(ctx.users.alice, 'query-data', { sql });
  const out = await q("WITH gone AS (DELETE FROM order_items RETURNING 1) SELECT count(*) FROM gone");
  assert.ok(out.error, 'a data-modifying CTE must fail');
  const still = await q('SELECT count(*)::int AS n FROM order_items');
  assert.ok(still.rows[0].n > 0);
});

test("query_data can't reach tables it isn't granted (chats, notes)", async (ctx) => {
  await ctx.fn.callAs(ctx.users.alice, 'save-note', { title: 'private', body: 'mine' });
  const out = await ctx.fn.callAs(ctx.users.bob, 'query-data', { sql: 'SELECT * FROM notes' });
  assert.ok(out.error || out.rowCount === 0, 'notes must not be readable through query_data');
});

test('query_data caps big results and says so', async (ctx) => {
  const out = await ctx.fn.callAs(ctx.users.alice, 'query-data', { sql: 'SELECT short_guid FROM orders' });
  assert.equal(out.rows.length, 200);
  assert.ok(out.rowCount > 200);
  assert.match(out.note, /first 200/);
});

test('save_note and list_notes are per user', async (ctx) => {
  const saved = await ctx.fn.callAs(ctx.users.alice, 'save-note', { title: 'Top customer', body: 'Grace Chen, $4,210' });
  assert.equal(saved.saved, true);
  const mine = await ctx.fn.callAs(ctx.users.alice, 'list-notes', {});
  assert.equal(mine.notes[0].title, 'Top customer'); // newest first
  // Bob sees none of Alice's notes (this file's earlier test saved one for her too).
  const theirs = await ctx.fn.callAs(ctx.users.bob, 'list-notes', {});
  assert.deepEqual(theirs.notes, []);
  assert.match((await ctx.fn.callAs(ctx.users.alice, 'save-note', { title: '' })).error, /title and a body/);
});

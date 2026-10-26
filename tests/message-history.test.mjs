import test from "node:test";
import assert from "node:assert/strict";
import {
  messagePage,
  mergeMessages,
  refreshMessageHistory,
  messageCursorSchema,
  olderMessageFilter,
} from "../src/lib/message-history.ts";
const row = (n) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  created_at: "2026-10-25T10:00:00.123456Z",
  body: String(n),
});
const source = Array.from({ length: 1200 }, (_, i) => row(i + 1));
for (const size of [200, 300])
  test(`newest ${size} and older pages retain tied-timestamp history`, async () => {
    const fetch = async (cursor) =>
      messagePage(
        source
          .filter((r) => !cursor || r.id < cursor.id)
          .slice()
          .reverse()
          .slice(0, size + 1),
        size,
      );
    let page = await fetch();
    assert.equal(page.items.at(-1).body, "1200");
    assert.equal(page.items.length, size);
    while (page.nextOlderCursor) {
      const older = await fetch(page.nextOlderCursor);
      page = {
        items: mergeMessages(page.items, older.items),
        nextOlderCursor: older.nextOlderCursor,
      };
    }
    assert.equal(page.items.length, 1200);
    assert.equal(page.items[0].body, "1");
  });
test("poll fills a gap longer than one page without discarding loaded history", async () => {
  const previous = { items: source.slice(0, 10), nextOlderCursor: null };
  let calls = 0;
  const result = await refreshMessageHistory(previous, async (cursor) => {
    calls++;
    return messagePage(
      source
        .filter((r) => !cursor || r.id < cursor.id)
        .slice()
        .reverse()
        .slice(0, 201),
      200,
    );
  });
  assert.equal(result.items.length, 1200);
  assert.equal(calls, 6);
  assert.equal(result.nextOlderCursor, null);
});
test("a previously empty conversation gets an older cursor; updates deduplicate by ID", async () => {
  const latest = messagePage(source.slice().reverse().slice(0, 201), 200);
  const page = await refreshMessageHistory(
    { items: [], nextOlderCursor: null },
    async () => latest,
  );
  assert.deepEqual(page.nextOlderCursor, latest.nextOlderCursor);
  const merged = mergeMessages([row(1), row(2)], [{ ...row(2), body: "updated" }, row(3)]);
  assert.equal(merged.length, 3);
  assert.equal(merged[1].body, "updated");
  assert.equal(messageCursorSchema.safeParse({ createdAt: "invalid", id: "x" }).success, false);
  assert.match(
    olderMessageFilter({ createdAt: row(1).created_at, id: row(1).id }),
    /and\(created_at.eq/,
  );
});
test("sub-millisecond ordering is retained", () => {
  assert.equal(
    mergeMessages([{ ...row(2), created_at: "2026-10-25T10:00:00.123455Z" }], [row(1)])[0].id,
    row(2).id,
  );
});

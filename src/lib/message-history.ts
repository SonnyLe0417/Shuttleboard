import { z } from "zod";
export const messageCursorSchema = z
  .object({ createdAt: z.string().datetime({ offset: true }), id: z.string().uuid() })
  .strict();
export type MessageCursor = z.infer<typeof messageCursorSchema>;
export type MessageRow = { id: string; created_at: string; [key: string]: any };
export type MessagePage<T extends MessageRow = MessageRow> = {
  items: T[];
  nextOlderCursor: MessageCursor | null;
};
export function olderMessageFilter(cursor: MessageCursor) {
  return `or(created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id}))`;
}
export function messagePage<T extends MessageRow>(rows: T[], size: number): MessagePage<T> {
  const items = rows.slice(0, size).reverse();
  return {
    items,
    nextOlderCursor:
      rows.length > size && items.length
        ? { createdAt: items[0].created_at, id: items[0].id }
        : null,
  };
}
function compare(a: MessageRow, b: MessageRow) {
  const ms = Date.parse(a.created_at) - Date.parse(b.created_at);
  if (ms) return ms;
  const extra = (value: string) => (value.match(/\.(\d+)/)?.[1] ?? "").padEnd(9, "0").slice(3, 9);
  const fraction = extra(a.created_at).localeCompare(extra(b.created_at));
  return fraction || a.id.localeCompare(b.id);
}
export function mergeMessages<T extends MessageRow>(previous: T[], incoming: T[]) {
  const byId = new Map(previous.map((row) => [row.id, row]));
  for (const row of incoming) byId.set(row.id, row);
  return [...byId.values()].sort(compare);
}
export async function refreshMessageHistory<T extends MessageRow>(
  previous: MessagePage<T> | undefined,
  fetchPage: (before?: MessageCursor) => Promise<MessagePage<T>>,
) {
  const latest = await fetchPage();
  let incoming = latest.items,
    cursor = latest.nextOlderCursor;
  const known = new Set(previous?.items.map((row) => row.id));
  const visited = new Set<string>();
  while (known.size && incoming.length && !incoming.some((row) => known.has(row.id)) && cursor) {
    const key = cursor.createdAt + cursor.id;
    if (visited.has(key)) throw Error("Chat pagination did not advance.");
    visited.add(key);
    const older = await fetchPage(cursor);
    incoming = mergeMessages(incoming, older.items);
    cursor = older.nextOlderCursor;
  }
  return {
    items: mergeMessages(previous?.items ?? [], incoming),
    nextOlderCursor: previous?.items.length ? previous.nextOlderCursor : latest.nextOlderCursor,
  };
}

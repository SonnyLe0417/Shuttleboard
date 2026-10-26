import type { MatchState, Snapshot } from "./match-controller";

export type OfflineAccount = { id: string; prepared: boolean; enabled: boolean };
export type LocalDraft = {
  owner: string;
  id: string;
  state: MatchState;
  history?: Snapshot[];
  updatedAt: number;
  meta?: { title?: string; court?: string };
};
export type QueuedMatch = {
  id: string;
  owner: string;
  payload: Record<string, unknown>;
  status: "pending" | "syncing" | "auth" | "error" | "synced";
  attempts: number;
  nextAttempt: number;
  error?: string;
  receipt?: { id: string; progressPending: boolean };
};
type Lease = { key: string; holder: string; fence: number; expires: number };
export const OFFLINE_DB = "shuttleboard-offline-v1";
let pendingWrites: Promise<unknown> = Promise.resolve();
export async function settleOfflineWrites() {
  let current;
  do {
    current = pendingWrites;
    await current.catch(() => {});
  } while (current !== pendingWrites);
}
const request = <T>(value: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
export function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const opening = indexedDB.open(OFFLINE_DB, 1);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      db.createObjectStore("accounts", { keyPath: "id" });
      db.createObjectStore("meta");
      db.createObjectStore("drafts", { keyPath: "owner" });
      const queue = db.createObjectStore("queue", { keyPath: "id" });
      queue.createIndex("owner", "owner");
      db.createObjectStore("leases", { keyPath: "key" });
    };
    opening.onsuccess = () => {
      if (blocked) {
        opening.result.close();
        return;
      }
      opening.result.onversionchange = () => opening.result.close();
      resolve(opening.result);
    };
    opening.onerror = () => reject(opening.error);
    opening.onblocked = () => {
      blocked = true;
      reject(Error("Close older ShuttleBoard tabs to open offline storage."));
    };
  });
}
export async function offlineTransaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const db = await openOfflineDb();
  try {
    const tx = db.transaction(stores, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? Error("Local save was interrupted."));
    });
    // Attach immediately: an aborted work request may reject before its transaction.
    void done.catch(() => {});
    let result: T;
    try {
      result = await work(tx);
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* already closed */
      }
      await done.catch(() => {});
      throw error;
    }
    await done;
    return result;
  } finally {
    db.close();
  }
}
export async function offlineAccount() {
  return offlineTransaction(["meta", "accounts"], "readonly", async (tx) => {
    const id = await request(tx.objectStore("meta").get("active"));
    return id
      ? await request<OfflineAccount | undefined>(tx.objectStore("accounts").get(id))
      : undefined;
  });
}
export async function selectOfflineAccount(
  id: string,
  prepared = false,
  guard: () => boolean = () => true,
) {
  return offlineTransaction(["meta", "accounts"], "readwrite", async (tx) => {
    const store = tx.objectStore("accounts"),
      old = await request<OfflineAccount | undefined>(store.get(id));
    if (!guard()) throw Error("The account changed before local access could be updated.");
    const account = { id, prepared: prepared || old?.prepared === true, enabled: true };
    store.put(account);
    tx.objectStore("meta").put(id, "active");
    return account;
  });
}
export async function disableOfflineAccount() {
  return offlineTransaction(["meta", "accounts"], "readwrite", async (tx) => {
    const id = await request(tx.objectStore("meta").get("active"));
    if (id) {
      const store = tx.objectStore("accounts"),
        old = await request<OfflineAccount | undefined>(store.get(id));
      if (old) store.put({ ...old, enabled: false });
    }
    tx.objectStore("meta").delete("active");
  });
}
export const readDraft = (owner: string) =>
  offlineTransaction(["drafts"], "readonly", (tx) =>
    request<LocalDraft | undefined>(tx.objectStore("drafts").get(owner)),
  );
export const readQueue = (owner: string) =>
  offlineTransaction(["queue"], "readonly", (tx) =>
    request<QueuedMatch[]>(tx.objectStore("queue").index("owner").getAll(owner)),
  );
export async function acquireEditor(
  owner: string,
  holder: string,
  takeover = false,
  now = Date.now(),
) {
  return offlineTransaction(["leases"], "readwrite", async (tx) => {
    const store = tx.objectStore("leases"),
      key = `edit:${owner}`,
      old = await request<Lease | undefined>(store.get(key));
    if (old && old.holder !== holder && old.expires > now && !takeover) return null;
    const lease = {
      key,
      holder,
      fence: (old?.fence ?? 0) + (old?.holder === holder ? 0 : 1),
      expires: now + 12000,
    };
    store.put(lease);
    return lease;
  });
}
export async function renewEditor(lease: Lease, now = Date.now()) {
  return offlineTransaction(["leases"], "readwrite", async (tx) => {
    const store = tx.objectStore("leases"),
      current = await request<Lease | undefined>(store.get(lease.key));
    if (current?.holder !== lease.holder || current.fence !== lease.fence) return null;
    const next = { ...current, expires: now + 12000 };
    store.put(next);
    return next;
  });
}
export async function releaseEditor(lease: Lease) {
  return offlineTransaction(["leases"], "readwrite", async (tx) => {
    const store = tx.objectStore("leases"),
      current = await request<Lease | undefined>(store.get(lease.key));
    if (current?.holder === lease.holder && current.fence === lease.fence)
      store.put({ ...current, expires: 0 });
  });
}
export async function saveLocalDraft(draft: LocalDraft, lease: Lease, completed?: QueuedMatch) {
  const operation = pendingWrites
    .catch(() => {})
    .then(() =>
      offlineTransaction(
        ["drafts", "leases", "queue", "accounts", "meta"],
        "readwrite",
        async (tx) => {
          const account = await request<OfflineAccount | undefined>(
            tx.objectStore("accounts").get(draft.owner),
          );
          const active = await request(tx.objectStore("meta").get("active"));
          const current = await request<Lease | undefined>(tx.objectStore("leases").get(lease.key));
          if (
            active !== draft.owner ||
            !account?.enabled ||
            current?.holder !== lease.holder ||
            current.fence !== lease.fence ||
            current.expires <= Date.now()
          )
            throw Error("This scoreboard is read-only. Take over to continue scoring.");
          tx.objectStore("drafts").put(draft);
          if (completed) {
            const queue = tx.objectStore("queue");
            const existing = await request<QueuedMatch | undefined>(queue.get(completed.id));
            if (existing && existing.owner !== draft.owner)
              throw Error(
                "Local match ID is unavailable. Keep this match open and download a backup.",
              );
            if (!existing) queue.add(completed);
          }
        },
      ),
    );
  pendingWrites = operation;
  return operation;
}
export async function updateQueued(
  owner: string,
  id: string,
  change: Partial<Pick<QueuedMatch, "status" | "attempts" | "nextAttempt" | "error" | "receipt">>,
) {
  return offlineTransaction(["queue"], "readwrite", async (tx) => {
    const store = tx.objectStore("queue"),
      row = await request<QueuedMatch | undefined>(store.get(id));
    if (!row || row.owner !== owner) throw Error("Local match not available.");
    store.put({ ...row, ...change });
  });
}

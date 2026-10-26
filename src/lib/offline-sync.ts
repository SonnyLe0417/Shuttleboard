import { offlineAccount, readQueue, updateQueued, type QueuedMatch } from "./offline-db";
export type SyncReply = { id: string; progressPending: boolean };
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}
export function syncFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = Number(
    (error as { status?: number; statusCode?: number })?.status ??
      (error as { statusCode?: number })?.statusCode,
  );
  if (
    status === 401 ||
    status === 403 ||
    /unauthorized|invalid token|sign in|jwt expired/i.test(message)
  )
    return {
      status: "auth" as const,
      message: "Sign in to the same account to sync these matches.",
    };
  if (
    (status >= 400 && status < 500 && status !== 408 && status !== 429) ||
    /validation|invalid input|match id is unavailable|ZodError/i.test(message)
  )
    return { status: "error" as const, message };
  return {
    status: "pending" as const,
    message: "Sync is temporarily unavailable. Your match is saved on this device.",
  };
}
export async function syncOfflineQueue(
  owner: string,
  options: {
    upload: (payload: Record<string, unknown>, signal: AbortSignal) => Promise<SyncReply>;
    currentUser: () => Promise<string | null>;
    changed: () => void;
    manual?: boolean;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
) {
  if (!navigator.onLine || !navigator.locks) return;
  if (options.signal?.aborted) return;
  await navigator.locks.request(
    `shuttleboard-sync:${owner}`,
    { ifAvailable: true },
    async (lock) => {
      if (!lock) return;
      const rows = (await readQueue(owner)).sort((a, b) =>
        String(a.payload.finished_at).localeCompare(String(b.payload.finished_at)),
      );
      if (!options.manual && rows.some((row) => row.status === "auth")) return;
      for (const row of rows) {
        if (options.signal?.aborted) return;
        const account = await offlineAccount();
        if (
          account?.id !== owner ||
          !account.enabled ||
          localStorage.getItem("shuttleboard.offline-signed-out.v1")
        )
          return;
        if (
          row.status === "synced" ||
          row.status === "error" ||
          (!options.manual && row.status === "auth") ||
          (!options.manual && row.nextAttempt > Date.now())
        )
          continue;
        try {
          const signal = AbortSignal.any([
            AbortSignal.timeout(options.timeoutMs ?? 20000),
            ...(options.signal ? [options.signal] : []),
          ]);
          if ((await abortable(options.currentUser(), signal)) !== owner) {
            await updateQueued(owner, row.id, {
              status: "auth",
              error: "Sign in to the same account to sync.",
            });
            options.changed();
            return;
          }
          await updateQueued(owner, row.id, { status: "syncing" });
          options.changed();
          signal.throwIfAborted();
          const receipt = await abortable(options.upload(row.payload, signal), signal);
          if (receipt.id !== row.id) throw Error("Match receipt did not match the local result.");
          await updateQueued(owner, row.id, {
            status: "synced",
            receipt,
            error: undefined,
            nextAttempt: 0,
          });
          options.changed();
        } catch (error) {
          const failure = syncFailure(error);
          await updateQueued(owner, row.id, {
            ...failure,
            error: failure.message,
            attempts: row.attempts + 1,
            nextAttempt: Date.now() + Math.min(300000, 5000 * 2 ** Math.min(row.attempts, 6)),
          } as Partial<QueuedMatch>);
          options.changed();
          if (failure.status !== "error") return;
        }
      }
    },
  );
}

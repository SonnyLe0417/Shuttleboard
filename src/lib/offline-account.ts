import { useEffect, useSyncExternalStore } from "react";
import {
  offlineAccount,
  selectOfflineAccount,
  disableOfflineAccount,
  offlineTransaction,
  settleOfflineWrites,
  type OfflineAccount,
} from "./offline-db";
type Snapshot = { loading: boolean; account: OfflineAccount | null; error: string | null };
const initial: Snapshot = { loading: true, account: null, error: null };
let snapshot = initial,
  started = false,
  generation = 0;
const listeners = new Set<() => void>();
let channel: BroadcastChannel | undefined;
function publish(next: Snapshot) {
  snapshot = next;
  listeners.forEach((fn) => fn());
}
export function notifyOfflineChange() {
  channel?.postMessage("changed");
  window.dispatchEvent(new Event("shuttleboard-offline-change"));
}
export async function refreshOfflineAccount() {
  const token = ++generation;
  try {
    const account = await offlineAccount();
    if (token === generation)
      publish({ loading: false, account: account?.enabled ? account : null, error: null });
  } catch {
    if (token === generation)
      publish({
        loading: false,
        account: null,
        error: "Device storage is unavailable. Offline scoring cannot be prepared.",
      });
  }
}
function start() {
  if (started) return;
  started = true;
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel("shuttleboard-offline");
    channel.onmessage = () => {
      void refreshOfflineAccount();
      window.dispatchEvent(new Event("shuttleboard-offline-change"));
    };
  }
  void refreshOfflineAccount();
}
export function useOfflineAccount() {
  useEffect(start, []);
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => snapshot,
    () => initial,
  );
}
export async function signOutOfflineAccount(signOut: () => Promise<unknown> = async () => {}) {
  const epoch = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}:${Math.random()}`;
  ++generation;
  publish({ loading: false, account: null, error: null });
  try {
    localStorage.setItem("shuttleboard.offline-signout-epoch.v1", epoch);
    localStorage.setItem("shuttleboard.offline-signout-pending.v1", epoch);
    // Local access is disabled before the async write, including in other tabs.
    localStorage.setItem("shuttleboard.offline-signed-out.v1", "1");
    await settleOfflineWrites();
    await disableOfflineAccount().catch(() => {});
    notifyOfflineChange();
  } catch {
    /* Offline storage failure must not block the existing SDK sign-out. */
  }
  try {
    await signOut();
  } finally {
    try {
      localStorage.setItem("shuttleboard.offline-signed-out.v1", "1");
      await disableOfflineAccount().catch(() => {});
      if (localStorage.getItem("shuttleboard.offline-signout-pending.v1") === epoch)
        localStorage.removeItem("shuttleboard.offline-signout-pending.v1");
      await refreshOfflineAccount();
      notifyOfflineChange();
    } catch {
      publish({
        loading: false,
        account: null,
        error: "Signed out. Offline storage could not be updated on this device.",
      });
    }
  }
}
export async function offlineAuthChanged(event: string, userId: string | null) {
  // SDK session expiry/revocation is not an explicit device sign-out. Retain
  // prepared local scoring; the upload endpoint still requires fresh auth.
  if (event === "SIGNED_OUT") return;
  if (userId) {
    const epoch = localStorage.getItem("shuttleboard.offline-signout-epoch.v1");
    const allowed = () =>
      !localStorage.getItem("shuttleboard.offline-signout-pending.v1") &&
      epoch === localStorage.getItem("shuttleboard.offline-signout-epoch.v1") &&
      (!localStorage.getItem("shuttleboard.offline-signed-out.v1") || event === "SIGNED_IN");
    if (!allowed()) return;
    await settleOfflineWrites();
    await selectOfflineAccount(userId, false, allowed);
    if (!allowed()) return;
    localStorage.removeItem("shuttleboard.offline-signed-out.v1");
    await refreshOfflineAccount();
    notifyOfflineChange();
    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED")
      window.dispatchEvent(new Event("shuttleboard-offline-auth-ready"));
  }
}
export async function markOfflinePrepared(userId: string) {
  if (localStorage.getItem("shuttleboard.offline-signed-out.v1"))
    throw Error("Sign in again before preparing offline scoring.");
  await offlineTransaction(["accounts", "meta"], "readwrite", async (tx) => {
    const get = <T>(value: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        value.onsuccess = () => resolve(value.result);
        value.onerror = () => reject(value.error);
      });
    const account = await get<OfflineAccount | undefined>(tx.objectStore("accounts").get(userId)),
      active = await get(tx.objectStore("meta").get("active"));
    if (active !== userId || !account?.enabled)
      throw Error("The account changed during offline preparation. Sign in and try again.");
    tx.objectStore("accounts").put({ ...account, prepared: true });
  });
  await refreshOfflineAccount();
  notifyOfflineChange();
}
export function localOfflineAccess(account: OfflineAccount | null) {
  try {
    return Boolean(
      account?.enabled &&
      account.prepared &&
      typeof localStorage !== "undefined" &&
      !localStorage.getItem("shuttleboard.offline-signed-out.v1"),
    );
  } catch {
    return false;
  }
}

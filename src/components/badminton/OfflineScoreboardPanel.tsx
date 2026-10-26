import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { prepareOfflineScoring } from "@/lib/offline-prepare.functions";
import { prepareOfflineAssets, offlineAssetsReady } from "@/lib/offline-prepare";
import { markOfflinePrepared, useOfflineAccount, localOfflineAccess } from "@/lib/offline-account";
import type { useDurableScoreboard } from "@/hooks/useDurableScoreboard";
export function OfflineScoreboardPanel({
  owner,
  signedIn,
  session,
}: {
  owner: string | null;
  signedIn: boolean;
  session: ReturnType<typeof useDurableScoreboard>;
}) {
  const [online, setOnline] = useState(() => navigator.onLine),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const { account } = useOfflineAccount(),
    verify = useServerFn(prepareOfflineScoring);
  const [cachedReady, setCachedReady] = useState(false);
  useEffect(() => {
    let active = true;
    void offlineAssetsReady().then((ready) => {
      if (active) setCachedReady(ready);
    });
    return () => {
      active = false;
    };
  }, [account, busy]);
  useEffect(() => {
    const changed = () => setOnline(navigator.onLine);
    window.addEventListener("online", changed);
    window.addEventListener("offline", changed);
    return () => {
      window.removeEventListener("online", changed);
      window.removeEventListener("offline", changed);
    };
  }, []);
  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      const first = await verify();
      if (first.userId !== owner)
        throw Error("Sign in to this account before preparing offline scoring.");
      await prepareOfflineAssets();
      const final = await verify();
      if (final.userId !== owner) throw Error("The account changed while preparing. Try again.");
      await markOfflinePrepared(final.userId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Offline preparation failed.");
    } finally {
      setBusy(false);
    }
  };
  const backup = (legacy = false) => {
    const data = legacy
      ? session.legacy
      : JSON.stringify(
          {
            version: 1,
            owner,
            exportedAt: new Date().toISOString(),
            matches: session.queue.filter((row) => row.status !== "synced"),
            activeDraft: session.currentDraft,
          },
          null,
          2,
        );
    const url = URL.createObjectURL(new Blob([data ?? ""], { type: "application/json" })),
      link = document.createElement("a");
    link.href = url;
    link.download = legacy
      ? "shuttleboard-unowned-draft.json"
      : "shuttleboard-unsynced-matches.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const labels = {
    pending: "Saved on device",
    syncing: "Syncing",
    auth: "Sign in to sync",
    error: "Needs attention",
    synced: "Synced",
  };
  return (
    <section
      className="mb-4 rounded-xl border border-border bg-card p-4"
      aria-label="Offline scoring"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status">
          {online ? "Online" : "Offline"} ·{" "}
          {account?.id === owner && localOfflineAccess(account) && cachedReady
            ? "Ready for offline scoring"
            : "Offline scoring not prepared"}
        </p>
        {signedIn && owner && (
          <button
            type="button"
            className="button-secondary"
            disabled={busy || !online}
            onClick={() => void enable()}
          >
            {busy ? "Preparing offline scoring…" : "Enable offline scoring"}
          </button>
        )}
      </div>
      {!owner && (
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in online to prepare offline scoring on this device.
        </p>
      )}
      {!online && owner && (
        <p className="mt-2 text-sm">
          Manual scoring works here. History, AI, invitations and voice recognition may need
          internet.
        </p>
      )}
      {(error || session.error) && (
        <p role="alert" className="mt-2 text-sm">
          {error || session.error}
        </p>
      )}
      {session.error && owner && (
        <button type="button" className="button-secondary mt-2" onClick={session.retrySave}>
          Retry local save
        </button>
      )}
      {session.readOnly && (
        <div className="mt-2">
          <p>This match is open in another tab. This tab is read-only.</p>
          <button
            type="button"
            className="button-secondary mt-2"
            onClick={() => void session.takeover()}
          >
            Take over scoring
          </button>
        </div>
      )}
      {session.legacy && (
        <div className="mt-3 space-y-2">
          <p>
            A previous draft has no account owner. Keep it under this account, or start a separate
            match. The original draft will be retained.
          </p>
          <button
            type="button"
            className="button-secondary mr-2"
            disabled={session.readOnly}
            onClick={() => session.migrate(true)}
          >
            Keep previous draft
          </button>
          <button
            type="button"
            className="button-secondary mr-2"
            disabled={session.readOnly}
            onClick={() => session.migrate(false)}
          >
            Start separate match
          </button>
          <button type="button" className="button-secondary" onClick={() => backup(true)}>
            Download previous draft
          </button>
        </div>
      )}
      {owner && (
        <details className="mt-3">
          <summary>
            {session.queue.filter((row) => row.status !== "synced").length} pending matches
          </summary>
          <div className="my-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="button-secondary"
              disabled={!online}
              onClick={() => void session.sync()}
            >
              Sync now
            </button>
            <button type="button" className="button-secondary" onClick={() => backup()}>
              Download unsynced matches
            </button>
          </div>
          <p className="mb-2 text-sm text-muted-foreground">
            Clearing this browser’s data can remove device-only matches. Download a backup before
            clearing data.
          </p>
          <ul className="space-y-2">
            {session.queue.map((row) => (
              <li key={row.id} className="rounded border p-2 text-sm">
                <span>
                  {String((row.payload.team_a_names as string[])?.join(" / "))} vs{" "}
                  {String((row.payload.team_b_names as string[])?.join(" / "))} ·{" "}
                  {new Date(String(row.payload.finished_at)).toLocaleString()} ·{" "}
                  {labels[row.status]}
                </span>
                <p>
                  {(row.payload.games as { a: number; b: number }[])
                    ?.map((game) => `${game.a}–${game.b}`)
                    .join(", ")}
                </p>
                {row.error && <p>{row.error}</p>}
                {row.receipt?.progressPending && (
                  <p>
                    Your match is synced. Open Progress online and choose Sync saved progress to
                    refresh rewards.
                  </p>
                )}
                {row.status === "auth" && <Link to="/auth">Sign in to sync</Link>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { saveMatch } from "@/lib/matches.functions";
import { loadBrowserSupabase } from "@/lib/browser-supabase";
import {
  acquireEditor,
  renewEditor,
  releaseEditor,
  settleOfflineWrites,
  readDraft,
  readQueue,
  saveLocalDraft,
  stashUnsavedDraft,
  type LocalDraft,
  type QueuedMatch,
} from "@/lib/offline-db";
import { completedOfflineMatch, restoreLegacyOfflineDraft } from "@/lib/offline-result";
import { completionTime } from "@/lib/durable-match-controller";
import { notifyOfflineChange } from "@/lib/offline-account";
import { syncOfflineQueue } from "@/lib/offline-sync";
import { MATCH_DRAFT_KEY, initialState } from "@/lib/match-controller";
import { PRESETS } from "@/lib/badminton-rules";
import { invalidateDashboard, MATCHES_QUERY_KEY, PROGRESS_QUERY_KEY } from "@/lib/query-keys";
import type { UseBadmintonMatch } from "./useBadmintonMatch";

export function useDurableScoreboard(owner: string | null, match: UseBadmintonMatch) {
  const [ready, setReady] = useState(!owner),
    [readOnly, setReadOnly] = useState(false),
    [error, setError] = useState<string | null>(null),
    [legacy, setLegacy] = useState<string | null>(null),
    [queue, setQueue] = useState<QueuedMatch[]>([]),
    [retry, setRetry] = useState(0),
    [initRetry, setInitRetry] = useState(0);
  const holder = useRef(owner ? crypto.randomUUID() : "guest");
  const lease = useRef<Awaited<ReturnType<typeof acquireEditor>>>(null),
    draft = useRef<LocalDraft | null>(null);
  const latest = useRef(match);
  latest.current = match;
  const qc = useQueryClient(),
    upload = useServerFn(saveMatch);
  const uploadRef = useRef(upload);
  uploadRef.current = upload;
  const refresh = useCallback(async () => {
    if (owner) setQueue(await readQueue(owner));
  }, [owner]);
  const sync = useCallback(
    async (manual = false, signal?: AbortSignal) => {
      if (!owner) return;
      try {
        await syncOfflineQueue(owner, {
          manual,
          signal,
          currentUser: async () => {
            const client = await loadBrowserSupabase();
            const { data } = await client.auth.getSession();
            return data.session?.user.id ?? null;
          },
          upload: async (payload, requestSignal) => {
            const receipt = await uploadRef.current({
              data: payload as any,
              signal: requestSignal,
            });
            void Promise.all([
              qc.invalidateQueries({ queryKey: MATCHES_QUERY_KEY }),
              qc.invalidateQueries({ queryKey: PROGRESS_QUERY_KEY }),
              invalidateDashboard(qc),
            ]).catch(() => {});
            return receipt;
          },
          changed: () => {
            void refresh().catch(() => {});
            notifyOfflineChange();
          },
        });
      } catch (failure) {
        if (!signal?.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "Sync could not start. Your local records are retained.",
          );
      }
    },
    [owner, qc, refresh],
  );
  useEffect(() => {
    if (!owner) return;
    let active = true;
    const editorId = crypto.randomUUID();
    holder.current = editorId;
    void (async () => {
      const owned = await acquireEditor(owner, editorId);
      if (!active) {
        if (owned) await releaseEditor(owned);
        return;
      }
      lease.current = owned;
      const saved = await readDraft(owner);
      if (!active) {
        if (owned) await releaseEditor(owned);
        return;
      }
      setReadOnly(!lease.current);
      if (saved) {
        draft.current = saved;
        latest.current.restoreDraft(saved.state, saved.history);
      } else {
        const raw = localStorage.getItem(MATCH_DRAFT_KEY);
        if (raw) {
          setLegacy(raw);
          await refresh();
          return;
        }
        draft.current = {
          owner,
          id: crypto.randomUUID(),
          state: latest.current.state,
          updatedAt: Date.now(),
        };
      }
      setReady(true);
      await refresh();
    })().catch((failure) => {
      if (active) setError(failure instanceof Error ? failure.message : "Device storage failed.");
    });
    const interval = setInterval(() => {
      if (!active) return;
      const current = lease.current;
      void (current ? renewEditor(current) : acquireEditor(owner, editorId))
        .then(async (next) => {
          if (!active) {
            if (next) await releaseEditor(next);
            return;
          }
          if (!current) {
            const saved = await readDraft(owner);
            if (!active) return;
            if (saved && saved.updatedAt !== draft.current?.updatedAt) {
              draft.current = saved;
              latest.current.restoreDraft(saved.state, saved.history);
            }
          }
          lease.current = next;
          setReadOnly(!next);
        })
        .catch(() => {
          if (active) {
            lease.current = null;
            setReadOnly(true);
            setError("Device storage failed. Scoring is paused to protect this match.");
          }
        });
    }, 3000);
    return () => {
      active = false;
      clearInterval(interval);
      const current = lease.current;
      lease.current = null;
      if (current)
        void settleOfflineWrites()
          .then(() => releaseEditor(current))
          .catch(() => {});
    };
  }, [owner, refresh, initRetry]);
  useEffect(() => {
    if (!owner || !ready || readOnly || !draft.current || !lease.current) return;
    const current = draft.current;
    const state = match.state;
    if (current.state.matchOver && !state.matchOver) {
      current.id = crypto.randomUUID();
      current.meta = {};
    }
    // Strictly increasing, so a replayed save never ties with the one before it.
    const updatedAt = Math.max(Date.now(), current.updatedAt + 1);
    const next = { ...current, state, history: match.undoHistory, updatedAt };
    draft.current = next;
    let active = true;
    void (async () => {
      const completed = state.matchOver
        ? completedOfflineMatch(owner, next.id, state, next.meta)
        : undefined;
      await saveLocalDraft(next, lease.current!, completed);
      if (!active) return;
      setError(null);
      if (completed) {
        latest.current.markDeviceSaved(completionTime(state));
        await refresh();
        notifyOfflineChange();
        void sync();
      }
    })().catch((failure) => {
      if (active) {
        setError(
          failure instanceof Error
            ? failure.message
            : "The local save failed. Do not close or reset this match.",
        );
        if (String(failure).includes("read-only")) setReadOnly(true);
      }
    });
    return () => {
      active = false;
    };
  }, [owner, ready, readOnly, match.state, match.undoHistory, retry, refresh, sync]);
  useEffect(() => {
    if (!owner) return;
    // A reload or closed tab can cut off the IndexedDB save of the last point.
    const hidden = () => {
      if (document.visibilityState === "hidden") stashUnsavedDraft();
    };
    window.addEventListener("pagehide", stashUnsavedDraft);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", stashUnsavedDraft);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [owner]);
  useEffect(() => {
    if (!owner || !ready) return;
    const controller = new AbortController();
    const kick = () => void sync(false, controller.signal);
    const authenticated = () => void sync(true, controller.signal);
    const changed = () => {
      void refresh().catch(() => {});
      if (lease.current)
        void renewEditor(lease.current)
          .then((next) => {
            lease.current = next;
            setReadOnly(!next);
          })
          .catch(() => {});
    };
    window.addEventListener("online", kick);
    window.addEventListener("shuttleboard-offline-auth-ready", authenticated);
    window.addEventListener("focus", kick);
    window.addEventListener("shuttleboard-offline-change", changed);
    const interval = setInterval(kick, 5000);
    kick();
    return () => {
      controller.abort();
      clearInterval(interval);
      window.removeEventListener("online", kick);
      window.removeEventListener("shuttleboard-offline-auth-ready", authenticated);
      window.removeEventListener("focus", kick);
      window.removeEventListener("shuttleboard-offline-change", changed);
    };
  }, [owner, ready, refresh, sync]);
  const takeover = async () => {
    if (!owner) return;
    try {
      const next = await acquireEditor(owner, holder.current, true);
      const saved = await readDraft(owner);
      lease.current = next;
      if (saved) {
        draft.current = saved;
        latest.current.restoreDraft(saved.state, saved.history);
      }
      setReadOnly(!next);
      setError(null);
      notifyOfflineChange();
    } catch {
      setError("Could not take over this scoreboard. The existing draft was retained.");
    }
  };
  const migrating = useRef(false);
  const migrate = async (keep: boolean) => {
    if (!owner || !lease.current || migrating.current) return;
    migrating.current = true;
    try {
      const state = keep ? restoreLegacyOfflineDraft(legacy!) : initialState(PRESETS[0]);
      const adopted = { owner, id: crypto.randomUUID(), state, updatedAt: Date.now() };
      await saveLocalDraft(
        adopted,
        lease.current,
        state.matchOver ? completedOfflineMatch(owner, adopted.id, state) : undefined,
      );
      draft.current = adopted;
      latest.current.restoreDraft(state);
      setLegacy(null);
      setReady(true);
      setError(null);
      await refresh();
      // The original unowned key is deliberately retained after the committed adoption.
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Draft migration failed.");
    } finally {
      migrating.current = false;
    }
  };
  const receipt = queue.find((row) => row.id === draft.current?.id)?.receipt;
  const setMeta = useCallback((meta: { title?: string; court?: string }) => {
    if (draft.current) {
      draft.current.meta = meta;
      setRetry((n) => n + 1);
    }
  }, []);
  return {
    ready,
    readOnly,
    error,
    legacy,
    queue,
    sync: () => sync(true),
    takeover,
    migrate,
    setMeta,
    retrySave: () => (ready ? setRetry((n) => n + 1) : setInitRetry((n) => n + 1)),
    savedId: receipt?.id ?? null,
    currentDraft: draft.current,
    canEdit:
      ready &&
      !readOnly &&
      (!owner || Boolean(lease.current && lease.current.expires > Date.now())),
  };
}

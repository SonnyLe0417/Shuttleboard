import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  mergeMessages,
  refreshMessageHistory,
  type MessageCursor,
  type MessagePage,
  type MessageRow,
} from "@/lib/message-history";

export function useMessageHistory(
  key: readonly string[],
  fetchPage: (before?: MessageCursor, signal?: AbortSignal) => Promise<MessagePage>,
  scroll: RefObject<HTMLDivElement | null>,
) {
  const qc = useQueryClient();
  const [loadingOlder, setLoadingOlder] = useState(false),
    [olderError, setOlderError] = useState<string | null>(null);
  const restoring = useRef<{
    top: number;
    height: number;
    prepend: boolean;
    follow: boolean;
  } | null>(null);
  const forceFollow = useRef(false),
    generation = useRef(0);
  const olderController = useRef<AbortController | null>(null);
  const lifecycle = useRef({ active: true });
  const keyString = JSON.stringify(key),
    activeKey = useRef(keyString);
  if (activeKey.current !== keyString) {
    activeKey.current = keyString;
    generation.current++;
  }
  useEffect(() => {
    setLoadingOlder(false);
    setOlderError(null);
    const lifetime = { active: true };
    lifecycle.current = lifetime;
    return () => {
      lifetime.active = false;
      olderController.current?.abort();
      olderController.current = null;
    };
  }, [keyString]);
  const capture = (prepend: boolean) => {
    const node = scroll.current;
    if (!node) return;
    restoring.current = {
      top: node.scrollTop,
      height: node.scrollHeight,
      prepend,
      follow: forceFollow.current || node.scrollHeight - node.clientHeight - node.scrollTop < 32,
    };
    forceFollow.current = false;
  };
  const query = useQuery({
    queryKey: key,
    enabled: Boolean(key.at(-1)),
    refetchInterval: 8000,
    queryFn: async ({ signal }) => {
      const snapshot = qc.getQueryData<MessagePage>(key);
      const next = await refreshMessageHistory(snapshot, (before) => fetchPage(before, signal));
      signal.throwIfAborted();
      // An older-page fetch may have completed while the newest page was polling.
      const current = qc.getQueryData<MessagePage>(key);
      const merged = {
        items: mergeMessages(current?.items ?? [], next.items),
        nextOlderCursor: current?.items.length ? current.nextOlderCursor : next.nextOlderCursor,
      };
      capture(Boolean(current?.items.length && merged.items[0]?.id !== current.items[0]?.id));
      return merged;
    },
  });
  useLayoutEffect(() => {
    const saved = restoring.current,
      node = scroll.current;
    if (!saved || !node) return;
    node.scrollTop = saved.prepend
      ? saved.top + node.scrollHeight - saved.height
      : saved.follow
        ? node.scrollHeight
        : saved.top;
    restoring.current = null;
  }, [query.data, scroll]);
  const loadOlder = async () => {
    const before = qc.getQueryData<MessagePage>(key)?.nextOlderCursor;
    if (!before || olderController.current) return;
    const controller = new AbortController();
    olderController.current = controller;
    const token = generation.current,
      lifetime = lifecycle.current;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const older = await fetchPage(before, controller.signal);
      if (token !== generation.current || !lifetime.active) return;
      capture(true);
      qc.setQueryData<MessagePage>(key, (current) => ({
        items: mergeMessages(current?.items ?? [], older.items),
        nextOlderCursor: older.nextOlderCursor,
      }));
    } catch (error) {
      if (token === generation.current && lifetime.active)
        setOlderError(error instanceof Error ? error.message : "Could not load older messages.");
    } finally {
      if (olderController.current === controller) olderController.current = null;
      if (token === generation.current && lifetime.active) setLoadingOlder(false);
    }
  };
  return {
    data: query.data?.items as MessageRow[] | undefined,
    isLoading: query.isLoading,
    error: query.error,
    hasOlder: Boolean(query.data?.nextOlderCursor),
    loadOlder,
    loadingOlder,
    olderError,
    followLatest: () => {
      forceFollow.current = true;
    },
  };
}

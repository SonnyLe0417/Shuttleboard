/** One browser subscription shared by all mounted session consumers. */
export function createSessionStore<T extends { user: unknown }>(
  connect: (publish: (session: T | null) => void, fail: (error: unknown) => void) => () => void,
) {
  const initial = {
    session: null as T | null,
    user: null as T["user"] | null,
    loading: true,
    error: null as Error | null,
  };
  let snapshot = initial;
  let disconnect: (() => void) | undefined;
  let generation = 0;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        const currentGeneration = ++generation;
        const fail = (error: unknown) => {
          if (generation !== currentGeneration) return;
          snapshot = {
            ...snapshot,
            loading: false,
            error: error instanceof Error ? error : new Error("Session could not load"),
          };
          listeners.forEach((notify) => notify());
        };
        try {
          disconnect = connect((session) => {
            if (generation !== currentGeneration) return;
            if (!snapshot.loading && !snapshot.error && snapshot.session === session) return;
            snapshot = { session, user: session?.user ?? null, loading: false, error: null };
            listeners.forEach((notify) => notify());
          }, fail);
        } catch (error) {
          fail(error);
        }
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          generation++;
          disconnect?.();
          disconnect = undefined;
          snapshot = initial;
        }
      };
    },
  };
}

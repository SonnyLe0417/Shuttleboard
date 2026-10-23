/** One browser subscription shared by all mounted session consumers. */
export function createSessionStore<T extends { user: unknown }>(
  connect: (publish: (session: T | null) => void) => () => void,
) {
  const initial = { session: null as T | null, user: null as T["user"] | null, loading: true };
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
        disconnect = connect((session) => {
          if (generation !== currentGeneration) return;
          if (!snapshot.loading && snapshot.session === session) return;
          snapshot = { session, user: session?.user ?? null, loading: false };
          listeners.forEach((notify) => notify());
        });
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

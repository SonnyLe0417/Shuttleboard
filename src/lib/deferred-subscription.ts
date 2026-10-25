/** Cancels an asynchronous subscription setup safely, including React's development remounts. */
export function deferredSubscription<T>(
  ready: Promise<T>,
  connect: (value: T) => () => void,
  onError: (error: unknown) => void,
) {
  let disposed = false;
  let disconnect: (() => void) | undefined;
  void ready
    .then((value) => {
      if (!disposed) disconnect = connect(value);
    })
    .catch((error) => {
      if (!disposed) onError(error);
    });
  return () => {
    if (disposed) return;
    disposed = true;
    disconnect?.();
  };
}

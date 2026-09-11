import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { subscribePush, unsubscribePush, getPushPublicKey } from "@/lib/push.functions";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bufToBase64Url(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type PushStatus =
  "unsupported" | "unregistered" | "denied" | "prompt" | "subscribed" | "loading";

export function usePushSubscription() {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [busy, setBusy] = useState(false);
  const subscribe = useServerFn(subscribePush);
  const unsubscribe = useServerFn(unsubscribePush);
  const getPublicKey = useServerFn(getPushPublicKey);

  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  const refresh = useCallback(async () => {
    if (!supported) return setStatus("unsupported");
    if (Notification.permission === "denied") return setStatus("denied");
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    if (!reg) return setStatus("unregistered");
    const existing = await reg.pushManager.getSubscription();
    if (existing) return setStatus("subscribed");
    setStatus(Notification.permission === "granted" ? "unregistered" : "prompt");
  }, [supported]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    if (!supported) return;
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setStatus("denied");
        return;
      }
      const reg =
        (await navigator.serviceWorker.getRegistration("/sw.js")) ??
        (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const { publicKey } = await getPublicKey();
      let sub = await reg.pushManager.getSubscription();
      const expectedKey = urlBase64ToUint8Array(publicKey);
      if (
        sub &&
        sub.options.applicationServerKey &&
        bufToBase64Url(sub.options.applicationServerKey) !== publicKey
      ) {
        await sub.unsubscribe();
        sub = null;
      }
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: expectedKey.buffer as ArrayBuffer,
        });
      }
      const p256dh = bufToBase64Url(sub.getKey("p256dh"));
      const auth = bufToBase64Url(sub.getKey("auth"));
      await subscribe({
        data: {
          endpoint: sub.endpoint,
          p256dh,
          auth,
          user_agent: navigator.userAgent.slice(0, 300),
        },
      });
      setStatus("subscribed");
    } finally {
      setBusy(false);
    }
  }, [subscribe, supported, getPublicKey]);

  const disable = useCallback(async () => {
    if (!supported) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await unsubscribe({ data: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      setStatus("unregistered");
    } finally {
      setBusy(false);
    }
  }, [unsubscribe, supported]);

  return { status, busy, enable, disable, refresh };
}

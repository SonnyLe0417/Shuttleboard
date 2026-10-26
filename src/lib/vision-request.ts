import { loadBrowserSupabase } from "./browser-supabase";

export function createVisionRequester(
  getSession: () => Promise<{ userId: string; token: string } | null>,
  send: typeof fetch = fetch,
  now: () => number = Date.now,
) {
  let owner: string | undefined,
    until = 0;
  let paused: { error: string; code: string; status: number } | undefined;
  const request = async (body: unknown, signal?: AbortSignal) => {
    const session = await getSession();
    if (!session) {
      until = Infinity;
      paused = {
        error:
          "Sign in to use paid AI analysis. Local tracking and manual scoring remain available.",
        code: "sign_in_required",
        status: 401,
      };
      return Response.json(paused, { status: 401 });
    }
    if (owner !== session.userId) {
      owner = session.userId;
      until = 0;
      paused = undefined;
    }
    if (paused && now() < until)
      return Response.json(paused, {
        status: paused.status,
        headers: {
          "retry-after": String(
            Number.isFinite(until) ? Math.max(1, Math.ceil((until - now()) / 1000)) : 86400,
          ),
        },
      });
    const response = await send("/api/ai-vision", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session.token}` },
      body: JSON.stringify(body),
      signal,
    });
    if (response.status === 401 || response.status === 429 || response.status === 503) {
      const failure = await response
        .clone()
        .json()
        .catch(() => ({ error: "Paid AI is temporarily unavailable.", code: "unavailable" }));
      const seconds = Number(response.headers.get("retry-after") ?? 30);
      until =
        response.status === 401 || ["day_limit", "global_limit"].includes(failure.code)
          ? Infinity
          : now() + Math.max(1, Number.isFinite(seconds) ? seconds : 30) * 1000;
      paused = { error: failure.error, code: failure.code, status: response.status };
    }
    return response;
  };
  return Object.assign(request, {
    canSample: () => !paused || now() >= until,
    // Starting another explicit analysis can recheck auth/quota; frame loops cannot.
    resume: () => {
      until = 0;
      paused = undefined;
    },
  });
}
export const requestVision = createVisionRequester(async () => {
  const client = await loadBrowserSupabase();
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) return null;
  return { userId: data.session.user.id, token: data.session.access_token };
});

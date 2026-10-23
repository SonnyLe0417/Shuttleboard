const params = new URLSearchParams(window.location.search);
const count = params.get("count") ?? "20";
export async function request(name: string, input?: unknown) {
  window.dispatchEvent(new CustomEvent("benchmark-request-start", { detail: name }));
  const response = await fetch(`/__fixture/${name}?count=${count}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input ?? {}),
  });
  if (!response.ok) throw new Error(`Fixture ${name} unavailable`);
  return response.json();
}
export const getDashboardCore = () => request("core");
export const getDashboardSummary = (input?: unknown) => request("summary", input);
export const listMyMatches = () => request("matches");
export const getMyPreferences = () => request("preferences");
export const updateMyPreferences = (input?: unknown) => request("save", input);
export const getProgressSummary = () => request("progress");
export const useServerFn = <T>(fn: T): T => fn;

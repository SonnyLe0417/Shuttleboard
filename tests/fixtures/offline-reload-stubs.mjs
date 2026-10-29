// Server functions and the sign-in client are out of scope for the local draft fixture.
export const useServerFn = (fn) => fn;
export const saveMatch = async () => {
  throw Error("The reload fixture never uploads");
};
export const loadBrowserSupabase = async () => ({
  auth: { getSession: async () => ({ data: { session: null } }) },
});

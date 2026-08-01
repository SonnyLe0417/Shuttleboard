import { createContext, useContext, type ReactNode } from "react";
import { useBadmintonMatch, type UseBadmintonMatch } from "@/hooks/useBadmintonMatch";

const BadmintonMatchContext = createContext<UseBadmintonMatch | null>(null);

/** Owns one durable match controller shared by every tracker route. */
export function BadmintonMatchProvider({ children }: { children: ReactNode }) {
  const match = useBadmintonMatch();
  return <BadmintonMatchContext.Provider value={match}>{children}</BadmintonMatchContext.Provider>;
}

export function useSharedBadmintonMatch(): UseBadmintonMatch {
  const match = useContext(BadmintonMatchContext);
  if (!match) {
    throw new Error("useSharedBadmintonMatch must be used inside BadmintonMatchProvider");
  }
  return match;
}

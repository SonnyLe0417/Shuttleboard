import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useBadmintonMatch } from "../../src/hooks/useBadmintonMatch";
import { useDurableScoreboard } from "../../src/hooks/useDurableScoreboard";
import * as db from "../../src/lib/offline-db";
const owner = "20000000-0000-4000-8000-000000000001";
window.offline = { ...db, owner };
// Keep a readwrite transaction on drafts busy so later saves queue behind it and never land.
window.holdDraftSaves = () =>
  new Promise((held, failed) => {
    const open = indexedDB.open(db.OFFLINE_DB);
    open.onsuccess = () => {
      const drafts = open.result.transaction("drafts", "readwrite").objectStore("drafts");
      const spin = () => {
        drafts.count().onsuccess = spin;
      };
      spin();
      held();
    };
    open.onerror = () => failed(open.error);
  });
function Scoreboard() {
  const match = useBadmintonMatch(true);
  const durable = useDurableScoreboard(owner, match);
  return React.createElement(
    "main",
    null,
    React.createElement(
      "button",
      { disabled: !durable.canEdit, onClick: () => match.addPoint(0) },
      "Point to Team A",
    ),
    React.createElement(
      "output",
      null,
      durable.ready ? `${match.state.score.join("-")} undo ${match.undoHistory.length}` : "",
    ),
  );
}
if (location.search !== "?storage")
  void db
    .selectOfflineAccount(owner, true)
    .then(() =>
      createRoot(document.getElementById("root")).render(
        React.createElement(
          QueryClientProvider,
          { client: new QueryClient() },
          React.createElement(Scoreboard),
        ),
      ),
    );

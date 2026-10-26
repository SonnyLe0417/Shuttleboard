import * as db from "../../src/lib/offline-db";
import * as accounts from "../../src/lib/offline-account";
import { syncOfflineQueue, syncFailure } from "../../src/lib/offline-sync";
window.offlineFixture = { ...db, ...accounts, syncOfflineQueue, syncFailure };

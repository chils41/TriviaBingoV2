import { initTriviaModule } from "./trivia.js";
import { initBingoModule } from "./bingo.js";
import { getExportCapabilities } from "./export.js";

export function initHostPage({ firebase, state, renderStatus }) {
  initTriviaModule({ firebase, state, role: "host" });
  initBingoModule({ firebase, state, role: "host" });

  const exportCapabilities = getExportCapabilities("host");
  const firebaseMessage = firebase.isConfigured ? "ready for shared event data" : "running with safe Firebase fallbacks";
  const statusMessage = `Host shell loaded. Firebase is ${firebaseMessage}. Export access: ${exportCapabilities.allowed ? "enabled" : "disabled"}.`;

  renderStatus(statusMessage, firebase.isConfigured ? "info" : "warning");

  return {
    statusMessage,
  };
}

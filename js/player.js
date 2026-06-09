import { initTriviaModule } from "./trivia.js";
import { initBingoModule } from "./bingo.js";

export function initPlayerPage({ firebase, state, renderStatus }) {
  initTriviaModule({ firebase, state, role: "player" });
  initBingoModule({ firebase, state, role: "player" });

  const firebaseMessage = firebase.isConfigured
    ? "Player shell is ready for data-backed features."
    : "Player shell loaded safely with Firebase fallbacks active.";

  renderStatus(firebaseMessage, firebase.isConfigured ? "info" : "warning");

  return {
    statusMessage: firebaseMessage,
  };
}

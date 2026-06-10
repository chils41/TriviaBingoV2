import { initTriviaModule } from "./trivia.js";
import { initBingoModule } from "./bingo.js";
import { initRoleProtectedPage } from "./role-access.js";

const HOST_PLACEHOLDER_CARDS = [
  {
    title: "Trivia Controls",
    description: "Future live trivia controls will be added here without exposing Admin-only tools.",
  },
  {
    title: "Bingo Controls",
    description: "Future bingo flow controls will stay inside the Host console.",
  },
  {
    title: "Display Screen",
    description: "Future display coordination shortcuts will appear here for live event use.",
  },
  {
    title: "Announcements",
    description: "Future host-only announcement tools will be added in a later slice.",
  },
];

export function initHostPage({ firebase, state, renderStatus }) {
  return initRoleProtectedPage({
    role: "host",
    rootSelector: "#host-app",
    state,
    firebase,
    renderStatus,
    pinFieldName: "hostPin",
    lockedIntroCopy: "Enter the Host PIN to unlock live event and display controls for this browser session.",
    shellTitle: "Host Console",
    shellCopy: "Host access is limited to live event operations and display coordination. Admin-only settings, exports, and destructive tools stay locked out.",
    setupCopy: "Host PIN setup is required before this page can be unlocked.",
    placeholderCards: HOST_PLACEHOLDER_CARDS,
    onUnlock() {
      initTriviaModule({ firebase, state, role: "host" });
      initBingoModule({ firebase, state, role: "host" });
    },
  });
}

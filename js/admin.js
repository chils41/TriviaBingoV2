import { initRoleProtectedPage } from "./role-access.js";

const ADMIN_PLACEHOLDER_CARDS = [
  {
    title: "Event Settings",
    description: "Future event-level settings and scheduling controls will live here.",
  },
  {
    title: "Player Management",
    description: "Future player lookup and record maintenance tools will stay in the Admin area.",
  },
  {
    title: "Question Pools",
    description: "Future trivia question management will appear here in a later slice.",
  },
  {
    title: "Bottle Lists",
    description: "Future bottle list setup and maintenance tools will stay in this console.",
  },
  {
    title: "Static Pages",
    description: "Future player-facing content editing will be added here later.",
  },
  {
    title: "Exports",
    description: "Future export tools remain reserved for Admin-only access.",
  },
];

export function initAdminPage({ firebase, state, renderStatus }) {
  return initRoleProtectedPage({
    role: "admin",
    rootSelector: "#admin-app",
    state,
    firebase,
    renderStatus,
    pinFieldName: "adminPin",
    lockedIntroCopy: "Enter the Admin PIN to unlock high-privilege event tools for this browser session.",
    shellTitle: "Admin Console",
    shellCopy: "Admin keeps the full event-management surface, including future settings, exports, and data controls.",
    setupCopy: "Admin PIN setup is required before this page can be unlocked.",
    placeholderCards: ADMIN_PLACEHOLDER_CARDS,
  });
}

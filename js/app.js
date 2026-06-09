import { initializeFirebase } from "./firebase.js";
import { createState } from "./state.js";
import { resolveAppContext } from "./router.js";
import { initPlayerPage } from "./player.js";
import { initAdminPage } from "./admin.js";
import { initHostPage } from "./host.js";
import { initDisplayPage } from "./display.js";

const appInitializers = {
  player: initPlayerPage,
  admin: initAdminPage,
  host: initHostPage,
  display: initDisplayPage,
};

function renderStatus(message, tone = "info") {
  const statusNode = document.querySelector("#app-status");

  if (statusNode) {
    statusNode.textContent = message;
    statusNode.dataset.statusTone = tone;
  }
}

function buildStatusMessage({ context, state, pageMessage }) {
  const currentState = state.getState();
  const { eventConfig, configSource, firebase } = currentState;
  const connectionLabel = firebase.status === "connected"
    ? "Connected"
    : firebase.status === "error"
      ? "Error"
      : firebase.isConfigured
        ? "Fallback"
        : "Not Configured";
  const configLabel = configSource === "firebase" ? "Firebase config loaded" : "Fallback config in use";
  const statusDetail = firebase.message ? ` ${firebase.message}` : "";

  return `${context.title} | Event: ${eventConfig.eventName} | Connection: ${connectionLabel} | ${configLabel}. ${pageMessage}${statusDetail}`;
}

async function boot() {
  const context = resolveAppContext(document.body.dataset.app);
  const firebase = await initializeFirebase(window.EVENT_ENGINE_FIREBASE_CONFIG);
  const state = createState({ appName: context.appName });
  const initPage = appInitializers[context.appName];

  if (!initPage) {
    renderStatus("No page initializer is assigned for this route yet.");
    return;
  }

  state.patch({
    eventId: firebase.getEventId(),
    firebase: firebase.getStatus(),
  });

  renderStatus(`Loading event config for "${firebase.getEventId()}"...`);

  const pageResult = initPage({ context, firebase, state, renderStatus }) || {};
  const configResult = await firebase.loadEventConfig();
  const firebaseStatus = firebase.getStatus();

  if (configResult.warning) {
    console.warn(`[Event Engine] ${configResult.warning}`);
  }

  state.patch({
    eventId: configResult.config.eventId,
    eventConfig: configResult.config,
    configSource: configResult.source,
    firebase: {
      ...firebaseStatus,
      message: configResult.warning || firebaseStatus.message,
    },
  });

  renderStatus(
    buildStatusMessage({
      context,
      state,
      pageMessage: pageResult.statusMessage || "Shared shell is ready for future event slices.",
    }),
    firebaseStatus.isConnected && configResult.source === "firebase" ? "success" : "warning"
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}

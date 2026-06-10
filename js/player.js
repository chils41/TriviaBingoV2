import { initTriviaModule } from "./trivia.js";
import { initBingoModule } from "./bingo.js";
import {
  escapeHtml,
  getOrCreateDeviceId,
  getPreferredName,
  isValidEmail,
  normalizeEmailInput,
  normalizeTextInput,
} from "./utils.js";

const PLAYER_ROOT_SELECTOR = "#player-app";

const HUB_PANELS = [
  {
    id: "trivia",
    label: "Trivia",
    title: "Trivia",
    message: "Trivia is coming in the next slice.",
  },
  {
    id: "bingo",
    label: "Bingo",
    title: "Bingo",
    message: "Bingo is coming in the next slice.",
  },
  {
    id: "bottle-list",
    label: "Bottle List",
    title: "Bottle List",
    message: "Bottle List is coming in the next slice.",
  },
  {
    id: "faq",
    label: "FAQ",
    title: "FAQ",
    message: "FAQ details are coming in the next slice.",
  },
  {
    id: "mystery-info",
    label: "Mystery Info",
    title: "Mystery Info",
    message: "Mystery Info is coming in the next slice.",
  },
  {
    id: "rules-alerts",
    label: "Rules & Alerts",
    title: "Rules & Alerts",
    message: "Rules and alerts are coming in the next slice.",
  },
  {
    id: "leave-review",
    label: "Leave Review",
    title: "Leave Review",
    message: "Review links are coming in a later slice.",
  },
];

function getPlayerRecordPath(playerId) {
  return `players/${playerId}`;
}

function normalizePlayerRecord(playerRecord, fallbackValues) {
  return {
    playerId: normalizeTextInput(playerRecord?.playerId || fallbackValues.playerId),
    name: normalizeTextInput(playerRecord?.name),
    zip: normalizeTextInput(playerRecord?.zip),
    email: normalizeEmailInput(playerRecord?.email),
    checkedInAt: normalizeTextInput(playerRecord?.checkedInAt),
    deviceId: normalizeTextInput(playerRecord?.deviceId || fallbackValues.deviceId),
    eventId: normalizeTextInput(playerRecord?.eventId || fallbackValues.eventId),
  };
}

function getHubPanel(panelId) {
  return HUB_PANELS.find((panel) => panel.id === panelId) || HUB_PANELS[0];
}

function renderPlayerMessage(playerMessage) {
  if (!playerMessage.text) {
    return "";
  }

  return `
    <div class="player-message" data-tone="${playerMessage.tone}" aria-live="polite">
      ${escapeHtml(playerMessage.text)}
    </div>
  `;
}

function renderAgeGate() {
  return `
    <section class="player-section">
      <p class="eyebrow">Player Check-In</p>
      <h2>Age Gate</h2>
      <p class="player-copy">Please confirm that you are 21 or older before continuing to event check-in.</p>
      <div class="player-action-stack">
        <button type="button" class="primary-button" data-action="accept-age-gate">I Am 21+</button>
        <button type="button" class="secondary-button" data-action="decline-age-gate">I Am Under 21</button>
      </div>
    </section>
  `;
}

function renderAgeGateBlocked() {
  return `
    <section class="player-section">
      <p class="eyebrow">Player Check-In</p>
      <h2>Thanks for checking</h2>
      <p class="player-copy">This event experience is only available to guests who are 21 or older. Please see event staff if you have questions.</p>
      <button type="button" class="secondary-button" data-action="reset-age-gate">Go Back</button>
    </section>
  `;
}

function renderCheckInForm({ canSave, isEditing }) {
  const heading = isEditing ? "Edit Check-In" : "Check In";
  const submitLabel = isEditing ? "Save Changes" : "Check In";
  const helperCopy = isEditing
    ? "Update your details below. Saving will update the same Firebase player record."
    : "Enter your details to save your check-in and enter the Event Hub.";
  const connectionMessage = canSave
    ? ""
    : `
      <div class="player-note" data-tone="warning">
        Check-in needs a live Firebase connection before it can save.
      </div>
    `;
  const cancelAction = isEditing
    ? `<button type="button" class="secondary-button" data-action="cancel-edit-check-in">Cancel</button>`
    : "";

  return `
    <section class="player-section">
      <p class="eyebrow">Player Check-In</p>
      <h2>${heading}</h2>
      <p class="player-copy">${helperCopy}</p>
      ${connectionMessage}
      <form id="player-checkin-form" class="player-form" novalidate>
        <label class="form-field" for="player-name">
          <span>Name</span>
          <input id="player-name" name="name" class="form-input" type="text" autocomplete="name" required>
        </label>
        <label class="form-field" for="player-zip">
          <span>ZIP Code</span>
          <input id="player-zip" name="zip" class="form-input" type="text" inputmode="numeric" autocomplete="postal-code" required>
        </label>
        <label class="form-field" for="player-email">
          <span>Email <small>(Optional)</small></span>
          <input id="player-email" name="email" class="form-input" type="email" autocomplete="email">
        </label>
        <div class="player-form-actions">
          <button type="submit" class="primary-button" ${canSave ? "" : "disabled"}>${submitLabel}</button>
          ${cancelAction}
        </div>
      </form>
    </section>
  `;
}

function renderHub(playerState) {
  const currentState = playerState.getState();
  const currentPlayer = currentState.currentPlayer;
  const activePanel = getHubPanel(currentState.activeHubPanel);
  const hubButtonsMarkup = HUB_PANELS
    .filter((panel) => panel.id !== "leave-review" || currentState.reviewVisible)
    .map((panel) => `
      <button
        type="button"
        class="hub-button"
        data-action="open-hub-panel"
        data-panel-id="${panel.id}"
        aria-pressed="${panel.id === activePanel.id ? "true" : "false"}"
      >
        ${panel.label}
      </button>
    `)
    .join("");

  return `
    <section class="player-section">
      <div class="player-section-header">
        <div>
          <p class="eyebrow">Event Hub</p>
          <h2 data-player-welcome>Welcome, ${escapeHtml(getPreferredName(currentPlayer?.name))}.</h2>
        </div>
        <button type="button" class="text-link-button" data-action="edit-check-in">Edit Check-In</button>
      </div>
      <p class="player-copy">Choose a section below. More gameplay and live event features will be added in the next slices.</p>
      <div class="hub-grid">
        ${hubButtonsMarkup}
      </div>
      <section class="hub-panel" aria-live="polite">
        <h3>${activePanel.title}</h3>
        <p>${activePanel.message}</p>
      </section>
    </section>
  `;
}

export async function initPlayerPage({ firebase, state, renderStatus }) {
  initTriviaModule({ firebase, state, role: "player" });
  initBingoModule({ firebase, state, role: "player" });

  const playerRoot = document.querySelector(PLAYER_ROOT_SELECTOR);

  if (!playerRoot) {
    const missingRootMessage = "Player app container is missing from index.html.";
    renderStatus(missingRootMessage, "warning");

    return {
      statusMessage: missingRootMessage,
    };
  }

  const playerUiState = {
    ageGateDeclined: false,
    isEditingCheckIn: false,
    isSubmitting: false,
    playerMessage: {
      text: "",
      tone: "info",
    },
  };

  function setPlayerMessage(text = "", tone = "info") {
    playerUiState.playerMessage = { text, tone };
  }

  function renderPlayerView() {
    const currentState = state.getState();
    const currentPlayer = currentState.currentPlayer;
    let viewMarkup = "";

    if (currentPlayer && !playerUiState.isEditingCheckIn) {
      viewMarkup = renderHub(state);
    } else if (currentState.hasPassedAgeGate) {
      viewMarkup = renderCheckInForm({
        canSave: firebase.getStatus().isConnected && !playerUiState.isSubmitting,
        isEditing: playerUiState.isEditingCheckIn,
      });
    } else if (playerUiState.ageGateDeclined) {
      viewMarkup = renderAgeGateBlocked();
    } else {
      viewMarkup = renderAgeGate();
    }

    playerRoot.innerHTML = `
      <div class="player-flow">
        ${renderPlayerMessage(playerUiState.playerMessage)}
        ${viewMarkup}
      </div>
    `;

    const checkInForm = playerRoot.querySelector("#player-checkin-form");

    if (checkInForm) {
      const nameField = checkInForm.elements.namedItem("name");
      const zipField = checkInForm.elements.namedItem("zip");
      const emailField = checkInForm.elements.namedItem("email");
      const playerRecord = currentPlayer || {};

      if (nameField instanceof HTMLInputElement) {
        nameField.value = playerRecord.name || "";
      }

      if (zipField instanceof HTMLInputElement) {
        zipField.value = playerRecord.zip || "";
      }

      if (emailField instanceof HTMLInputElement) {
        emailField.value = playerRecord.email || "";
      }
    }
  }

  async function restoreExistingPlayer() {
    const deviceId = getOrCreateDeviceId();

    state.patch({ deviceId });

    if (!firebase.getStatus().isConnected) {
      return;
    }

    const existingPlayerRecord = await firebase.readEventData(getPlayerRecordPath(deviceId));

    if (!existingPlayerRecord || typeof existingPlayerRecord !== "object") {
      return;
    }

    state.patch({
      currentPlayer: normalizePlayerRecord(existingPlayerRecord, {
        playerId: deviceId,
        deviceId,
        eventId: state.getState().eventId,
      }),
      hasPassedAgeGate: true,
      activeHubPanel: state.getState().activeHubPanel || HUB_PANELS[0].id,
    });
  }

  function getCheckInValidationMessage({ name, zip, email }) {
    if (!name) {
      return "Please enter your name to check in.";
    }

    if (!zip) {
      return "Please enter your ZIP code to check in.";
    }

    if (email && !isValidEmail(email)) {
      return "Please enter a valid email address or leave the email field blank.";
    }

    return "";
  }

  playerRoot.addEventListener("click", (event) => {
    const actionNode = event.target.closest("[data-action]");

    if (!actionNode) {
      return;
    }

    const action = actionNode.dataset.action;

    if (action === "accept-age-gate") {
      playerUiState.ageGateDeclined = false;
      playerUiState.isEditingCheckIn = false;
      setPlayerMessage();
      state.patch({ hasPassedAgeGate: true });
      renderPlayerView();
      return;
    }

    if (action === "decline-age-gate") {
      playerUiState.ageGateDeclined = true;
      setPlayerMessage();
      renderPlayerView();
      return;
    }

    if (action === "reset-age-gate") {
      playerUiState.ageGateDeclined = false;
      setPlayerMessage();
      renderPlayerView();
      return;
    }

    if (action === "open-hub-panel") {
      state.patch({ activeHubPanel: actionNode.dataset.panelId || HUB_PANELS[0].id });
      renderPlayerView();
      return;
    }

    if (action === "edit-check-in") {
      playerUiState.isEditingCheckIn = true;
      setPlayerMessage();
      renderPlayerView();
      return;
    }

    if (action === "cancel-edit-check-in") {
      playerUiState.isEditingCheckIn = false;
      setPlayerMessage();
      renderPlayerView();
    }
  });

  playerRoot.addEventListener("submit", async (event) => {
    const formNode = event.target;

    if (!(formNode instanceof HTMLFormElement) || formNode.id !== "player-checkin-form") {
      return;
    }

    event.preventDefault();

    if (!firebase.getStatus().isConnected) {
      setPlayerMessage("Check-in is temporarily unavailable because the event connection is not ready.", "warning");
      renderPlayerView();
      return;
    }

    const formData = new FormData(formNode);
    const name = normalizeTextInput(formData.get("name"));
    const zip = normalizeTextInput(formData.get("zip"));
    const email = normalizeEmailInput(formData.get("email"));
    const validationMessage = getCheckInValidationMessage({ name, zip, email });

    if (validationMessage) {
      setPlayerMessage(validationMessage, "warning");
      renderPlayerView();
      return;
    }

    playerUiState.isSubmitting = true;
    setPlayerMessage();
    renderPlayerView();

    const currentState = state.getState();
    const playerId = currentState.deviceId || getOrCreateDeviceId();
    const playerPayload = {
      playerId,
      name,
      zip,
      email,
      checkedInAt: new Date().toISOString(),
      deviceId: playerId,
      eventId: currentState.eventId,
    };
    const saveSucceeded = await firebase.writeEventData(getPlayerRecordPath(playerId), playerPayload);

    playerUiState.isSubmitting = false;

    if (!saveSucceeded) {
      const saveErrorMessage = firebase.getStatus().message || "We could not save your check-in right now. Please try again.";
      setPlayerMessage(saveErrorMessage, "error");
      renderPlayerView();
      return;
    }

    state.patch({
      currentPlayer: playerPayload,
      deviceId: playerId,
      hasPassedAgeGate: true,
      activeHubPanel: currentState.activeHubPanel || HUB_PANELS[0].id,
    });

    playerUiState.ageGateDeclined = false;
    playerUiState.isEditingCheckIn = false;
    setPlayerMessage(
      currentState.currentPlayer ? "Your check-in details were updated." : "You are checked in and ready for the Event Hub.",
      "success"
    );
    renderPlayerView();
  });

  renderPlayerView();
  const restorePlayerPromise = restoreExistingPlayer()
    .then(() => {
      renderPlayerView();
    })
    .catch(() => {
      setPlayerMessage("We could not reload your saved check-in right now. You can still check in again.", "warning");
      renderPlayerView();
    });

  await Promise.race([
    restorePlayerPromise,
    new Promise((resolve) => {
      window.setTimeout(resolve, 1500);
    }),
  ]);

  const firebaseMessage = firebase.isConfigured
    ? "Player check-in flow is ready for Firebase-backed attendance."
    : "Player check-in is loaded, but a live Firebase connection is required before guests can save check-in.";

  renderStatus(firebaseMessage, firebase.isConfigured ? "info" : "warning");

  return {
    statusMessage: firebaseMessage,
  };
}

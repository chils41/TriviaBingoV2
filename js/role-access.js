import {
  clearRoleUnlockSession,
  escapeHtml,
  formatRoleLabel,
  hasRoleUnlockSession,
  normalizeTextInput,
  setRoleUnlockSession,
} from "./utils.js";

function renderNotice(message) {
  if (!message.text) {
    return "";
  }

  return `
    <div class="notice-panel" data-tone="${message.tone}" aria-live="polite">
      ${escapeHtml(message.text)}
    </div>
  `;
}

function renderPlaceholderCards(cards) {
  return cards
    .map((card) => `
      <article class="placeholder-card">
        <h3>${escapeHtml(card.title)}</h3>
        <p>${escapeHtml(card.description)}</p>
      </article>
    `)
    .join("");
}

function renderLockedState({ role, roleLabel, introCopy, message, isSubmitting }) {
  const submitLabel = isSubmitting ? `Checking ${roleLabel} PIN...` : `Unlock ${roleLabel}`;

  return `
    <section class="role-gate" data-role-state="locked">
      <div class="role-gate-header">
        <p class="eyebrow">${escapeHtml(roleLabel)} Access</p>
        <h2>Enter ${escapeHtml(roleLabel)} PIN</h2>
        <p class="page-copy role-copy">${escapeHtml(introCopy)}</p>
      </div>
      ${renderNotice(message)}
      <form class="pin-form" data-role-pin-form="${escapeHtml(role)}" novalidate>
        <label class="form-field" for="${escapeHtml(role)}-pin-input">
          <span>${escapeHtml(roleLabel)} PIN</span>
          <input
            id="${escapeHtml(role)}-pin-input"
            name="pin"
            class="form-input"
            type="password"
            inputmode="numeric"
            autocomplete="one-time-code"
            ${isSubmitting ? "disabled" : ""}
          >
        </label>
        <div class="role-form-actions">
          <button type="submit" class="primary-button" ${isSubmitting ? "disabled" : ""}>${escapeHtml(submitLabel)}</button>
        </div>
      </form>
    </section>
  `;
}

function renderSetupState({ roleLabel, setupMessage }) {
  return `
    <section class="role-gate" data-role-state="setup">
      <div class="role-gate-header">
        <p class="eyebrow">${escapeHtml(roleLabel)} Access</p>
        <h2>${escapeHtml(roleLabel)} PIN Setup Needed</h2>
        <p class="page-copy role-copy">This page stays locked until the event security config is ready.</p>
      </div>
      <div class="notice-panel" data-tone="warning" aria-live="polite">
        ${escapeHtml(setupMessage)}
      </div>
    </section>
  `;
}

function renderLoadingState({ roleLabel }) {
  return `
    <section class="role-gate" data-role-state="loading">
      <div class="role-gate-header">
        <p class="eyebrow">${escapeHtml(roleLabel)} Access</p>
        <h2>Checking ${escapeHtml(roleLabel)} Access</h2>
        <p class="page-copy role-copy">Verifying the event security settings for this page.</p>
      </div>
      <div class="notice-panel" data-tone="info" aria-live="polite">
        Loading the current event security config...
      </div>
    </section>
  `;
}

function renderUnlockedState({ roleLabel, shellTitle, shellCopy, lockLabel, message, cards }) {
  return `
    <section class="role-gate" data-role-state="unlocked">
      <div class="role-shell-header">
        <div>
          <p class="eyebrow">${escapeHtml(roleLabel)} Console</p>
          <h2>${escapeHtml(shellTitle)}</h2>
          <p class="page-copy role-copy">${escapeHtml(shellCopy)}</p>
        </div>
        <button type="button" class="secondary-button role-lock-button" data-action="lock-role">
          ${escapeHtml(lockLabel)}
        </button>
      </div>
      ${renderNotice(message)}
      <div class="placeholder-grid">
        ${renderPlaceholderCards(cards)}
      </div>
    </section>
  `;
}

export async function initRoleProtectedPage({
  role,
  rootSelector,
  state,
  firebase,
  renderStatus,
  pinFieldName,
  lockedIntroCopy,
  shellTitle,
  shellCopy,
  setupCopy,
  placeholderCards,
  onUnlock,
}) {
  const rootNode = document.querySelector(rootSelector);
  const roleLabel = formatRoleLabel(role);

  if (!rootNode) {
    const missingRootMessage = `${roleLabel} app container is missing from the page shell.`;
    renderStatus(missingRootMessage, "warning");

    return {
      statusMessage: missingRootMessage,
    };
  }

  const eventId = state.getState().eventId || firebase.getEventId();
  const securityPath = `config/security/${pinFieldName}`;
  const securityDisplayPath = `/events/${eventId}/${securityPath}`;
  const uiState = {
    expectedPin: "",
    isSubmitting: false,
    isUnlocked: false,
    hasInitializedUnlockShell: false,
    setupMessage: "",
    mode: "loading",
    message: {
      text: "",
      tone: "info",
    },
  };

  function setMessage(text = "", tone = "info") {
    uiState.message = { text, tone };
  }

  async function ensureUnlockedShell() {
    if (uiState.hasInitializedUnlockShell || typeof onUnlock !== "function") {
      return;
    }

    uiState.hasInitializedUnlockShell = true;
    await Promise.resolve(onUnlock({ firebase, state }));
  }

  function renderRoleView() {
    if (uiState.mode === "loading") {
      rootNode.innerHTML = renderLoadingState({ roleLabel });
      return;
    }

    if (uiState.mode === "setup") {
      rootNode.innerHTML = renderSetupState({
        roleLabel,
        setupMessage: uiState.setupMessage,
      });
      return;
    }

    if (uiState.isUnlocked) {
      rootNode.innerHTML = renderUnlockedState({
        roleLabel,
        shellTitle,
        shellCopy,
        lockLabel: `Lock ${roleLabel}`,
        message: uiState.message,
        cards: placeholderCards,
      });
      return;
    }

    rootNode.innerHTML = renderLockedState({
      role,
      roleLabel,
      introCopy: lockedIntroCopy,
      message: uiState.message,
      isSubmitting: uiState.isSubmitting,
    });
  }

  function getInitialStatusMessage() {
    if (uiState.mode === "setup") {
      return uiState.setupMessage;
    }

    if (uiState.isUnlocked) {
      return `${roleLabel} access is unlocked for this browser session.`;
    }

    return `${roleLabel} access is locked and waiting for a valid ${roleLabel} PIN.`;
  }

  function lockRole() {
    clearRoleUnlockSession(role, eventId);
    uiState.isUnlocked = false;
    uiState.isSubmitting = false;
    setMessage(`${roleLabel} access locked.`, "info");
    renderRoleView();
  }

  async function unlockRole(pinValue) {
    const normalizedPin = normalizeTextInput(pinValue);

    if (!normalizedPin) {
      setMessage(`Enter the ${roleLabel.toLowerCase()} PIN to continue.`, "warning");
      renderRoleView();
      return;
    }

    uiState.isSubmitting = true;
    setMessage();
    renderRoleView();

    if (normalizedPin !== uiState.expectedPin) {
      uiState.isSubmitting = false;
      setMessage("That PIN did not match. Please try again.", "error");
      renderRoleView();
      return;
    }

    const persisted = setRoleUnlockSession(role, eventId);
    uiState.isSubmitting = false;
    uiState.isUnlocked = true;

    if (persisted) {
      setMessage(`${roleLabel} access unlocked for this browser session.`, "success");
    } else {
      setMessage(`${roleLabel} access unlocked. Refresh will require the PIN again because session storage is unavailable.`, "warning");
    }

    await ensureUnlockedShell();
    renderRoleView();
  }

  rootNode.addEventListener("click", (event) => {
    const actionNode = event.target.closest("[data-action]");

    if (!actionNode || actionNode.dataset.action !== "lock-role") {
      return;
    }

    lockRole();
  });

  rootNode.addEventListener("submit", async (event) => {
    const formNode = event.target;

    if (!(formNode instanceof HTMLFormElement) || formNode.dataset.rolePinForm !== role) {
      return;
    }

    event.preventDefault();
    const formData = new FormData(formNode);
    await unlockRole(formData.get("pin"));
  });

  renderRoleView();

  const firebaseStatus = firebase.getStatus();

  if (!firebaseStatus.isConnected) {
    uiState.mode = "setup";
    uiState.setupMessage = `${setupCopy} A live Firebase connection is also required before ${escapeHtml(securityDisplayPath)} can be verified.`;
    renderRoleView();
    return {
      statusMessage: getInitialStatusMessage(),
    };
  }

  const securityConfig = await firebase.readEventData("config/security");
  const updatedStatus = firebase.getStatus();

  if (!securityConfig || updatedStatus.error) {
    uiState.mode = "setup";
    uiState.setupMessage = `${setupCopy} Check ${securityDisplayPath} and the Firebase connection, then reload.`;
    renderRoleView();
    return {
      statusMessage: getInitialStatusMessage(),
    };
  }

  const expectedPin = normalizeTextInput(securityConfig?.[pinFieldName]);

  if (!expectedPin) {
    uiState.mode = "setup";
    uiState.setupMessage = `${setupCopy} Add ${securityDisplayPath} in Firebase, then reload this page.`;
    renderRoleView();
    return {
      statusMessage: getInitialStatusMessage(),
    };
  }

  uiState.expectedPin = expectedPin;
  uiState.mode = "ready";
  uiState.isUnlocked = hasRoleUnlockSession(role, eventId);

  if (uiState.isUnlocked) {
    setMessage(`${roleLabel} access is unlocked for this browser session.`, "success");
    await ensureUnlockedShell();
  }

  renderRoleView();

  return {
    statusMessage: getInitialStatusMessage(),
  };
}

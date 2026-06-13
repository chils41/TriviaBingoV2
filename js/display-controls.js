import {
  TRIVIA_CURRENT_ROUND_PATH,
  normalizeTriviaCurrentRound,
} from "./trivia-live.js";
import {
  DISPLAY_MODE_ANNOUNCEMENT,
  DISPLAY_MODE_BINGO,
  DISPLAY_MODE_TRIVIA,
  DISPLAY_MODE_TRIVIA_REVEAL,
  DISPLAY_MODE_WAITING,
  DISPLAY_MODE_WINNER,
  DISPLAY_PATH,
  buildAnnouncementDisplayPatch,
  buildDisplayModePatch,
  buildWaitingDisplayPatch,
  buildWinnerDisplayPatch,
  canDisplayTriviaRevealRound,
  canDisplayTriviaRound,
  formatDisplayModeLabel,
  getDisplayMessageTitle,
  getWaitingStatusFallback,
  hasAnnouncementDisplayMessage,
  hasWinnerDisplayMessage,
  normalizeDisplayState,
  validateAnnouncementDraft,
  validateWinnerDraft,
} from "./display-state.js";
import { escapeHtml, normalizeTextInput } from "./utils.js";

function formatUpdatedAt(updatedAt) {
  const normalizedUpdatedAt = normalizeTextInput(updatedAt);

  if (!normalizedUpdatedAt) {
    return "Not saved yet.";
  }

  const parsedDate = new Date(normalizedUpdatedAt);

  if (Number.isNaN(parsedDate.getTime())) {
    return normalizedUpdatedAt;
  }

  return parsedDate.toLocaleString();
}

function renderNoticeMarkup(message) {
  if (!message.text) {
    return "";
  }

  return `
    <div class="notice-panel" data-tone="${escapeHtml(message.tone)}" aria-live="polite">
      ${escapeHtml(message.text)}
    </div>
  `;
}

function createDisplayControlsState(eventConfig = null) {
  return {
    displayState: normalizeDisplayState(null, eventConfig),
    hasLoadedDisplay: false,
    isDisplayLoading: true,
    displayUnavailableMessage: "",
    displayWarning: "",
    triviaRound: normalizeTriviaCurrentRound(null),
    hasLoadedTriviaRound: false,
    isTriviaRoundLoading: true,
    triviaUnavailableMessage: "",
    triviaWarning: "",
    actionMessage: {
      text: "",
      tone: "info",
    },
    isBusy: false,
    waitingStatusDraft: getWaitingStatusFallback(eventConfig),
    announcementTitleDraft: "",
    announcementMessageDraft: "",
    winnerTitleDraft: "",
    winnerMessageDraft: "",
    isWaitingDirty: false,
    isAnnouncementDirty: false,
    isWinnerDirty: false,
  };
}

export function createDisplayControlsManager({
  firebase,
  state,
  role,
} = {}) {
  let activeContainerNode = null;
  let unsubscribeDisplayListener = null;
  let unsubscribeTriviaRoundListener = null;
  let uiState = createDisplayControlsState(state?.getState()?.eventConfig);

  function getEventConfig() {
    return state?.getState()?.eventConfig || null;
  }

  function setActionMessage(text = "", tone = "info") {
    uiState.actionMessage = { text, tone };
  }

  function syncDraftsFromDisplay(displayState, { force = false } = {}) {
    if (force || !uiState.isWaitingDirty) {
      uiState.waitingStatusDraft = displayState.statusMessage || getWaitingStatusFallback(getEventConfig());
    }

    if (force || !uiState.isAnnouncementDirty) {
      uiState.announcementTitleDraft = displayState.announcement.title;
      uiState.announcementMessageDraft = displayState.announcement.message;
    }

    if (force || !uiState.isWinnerDirty) {
      uiState.winnerTitleDraft = displayState.winner.title;
      uiState.winnerMessageDraft = displayState.winner.message;
    }
  }

  function renderNoticesMarkup() {
    const notices = [];

    if (uiState.actionMessage.text) {
      notices.push(renderNoticeMarkup(uiState.actionMessage));
    }

    if (uiState.isDisplayLoading) {
      notices.push(renderNoticeMarkup({
        text: "Loading the saved Display state...",
        tone: "info",
      }));
    } else if (uiState.displayUnavailableMessage) {
      notices.push(renderNoticeMarkup({
        text: uiState.displayUnavailableMessage,
        tone: "warning",
      }));
    } else if (uiState.displayWarning) {
      notices.push(renderNoticeMarkup({
        text: uiState.displayWarning,
        tone: "warning",
      }));
    }

    if (uiState.isTriviaRoundLoading) {
      notices.push(renderNoticeMarkup({
        text: "Loading the current Live Trivia round for Display controls...",
        tone: "info",
      }));
    } else if (uiState.triviaUnavailableMessage) {
      notices.push(renderNoticeMarkup({
        text: uiState.triviaUnavailableMessage,
        tone: "warning",
      }));
    } else if (uiState.triviaWarning) {
      notices.push(renderNoticeMarkup({
        text: uiState.triviaWarning,
        tone: "warning",
      }));
    }

    if (uiState.displayState.isMissing && !uiState.isDisplayLoading) {
      notices.push(renderNoticeMarkup({
        text: "No saved Display state exists yet. Waiting mode is using the local event-status fallback until you save a Display update.",
        tone: "info",
      }));
    }

    return notices.join("");
  }

  function renderSummaryMarkup() {
    return `
      <div class="display-control-summary-grid">
        <article class="trivia-count-card">
          <strong>${escapeHtml(formatDisplayModeLabel(uiState.displayState.mode))}</strong>
          <span>Current Mode</span>
        </article>
        <article class="trivia-count-card">
          <strong>${escapeHtml(uiState.displayState.triviaRoundId || "None")}</strong>
          <span>Bound Trivia Round</span>
        </article>
        <article class="trivia-count-card">
          <strong>${escapeHtml(uiState.displayState.updatedByRole || "Unknown")}</strong>
          <span>Updated By</span>
        </article>
        <article class="trivia-count-card">
          <strong>${escapeHtml(formatUpdatedAt(uiState.displayState.updatedAt))}</strong>
          <span>Last Updated</span>
        </article>
      </div>
    `;
  }

  function renderQuickModeMarkup() {
    const canSwitchToTrivia = !uiState.isBusy && uiState.hasLoadedTriviaRound;
    const canSwitchToReveal = !uiState.isBusy && canDisplayTriviaRevealRound(uiState.triviaRound);

    return `
      <div class="display-control-modes">
        <button
          type="button"
          class="hub-button"
          data-display-action="switch-display-mode"
          data-display-mode="${DISPLAY_MODE_WAITING}"
          aria-pressed="${uiState.displayState.mode === DISPLAY_MODE_WAITING ? "true" : "false"}"
          ${uiState.isBusy ? "disabled" : ""}
        >
          Waiting
        </button>
        <button
          type="button"
          class="hub-button"
          data-display-action="switch-display-mode"
          data-display-mode="${DISPLAY_MODE_TRIVIA}"
          aria-pressed="${uiState.displayState.mode === DISPLAY_MODE_TRIVIA ? "true" : "false"}"
          ${canSwitchToTrivia ? "" : "disabled"}
        >
          Trivia
        </button>
        <button
          type="button"
          class="hub-button"
          data-display-action="switch-display-mode"
          data-display-mode="${DISPLAY_MODE_TRIVIA_REVEAL}"
          aria-pressed="${uiState.displayState.mode === DISPLAY_MODE_TRIVIA_REVEAL ? "true" : "false"}"
          ${canSwitchToReveal ? "" : "disabled"}
        >
          Trivia Reveal
        </button>
        <button
          type="button"
          class="hub-button"
          data-display-action="switch-display-mode"
          data-display-mode="${DISPLAY_MODE_BINGO}"
          aria-pressed="${uiState.displayState.mode === DISPLAY_MODE_BINGO ? "true" : "false"}"
          ${uiState.isBusy ? "disabled" : ""}
        >
          Bingo
        </button>
        <button
          type="button"
          class="hub-button"
          data-display-action="switch-display-mode"
          data-display-mode="${DISPLAY_MODE_WINNER}"
          aria-pressed="${uiState.displayState.mode === DISPLAY_MODE_WINNER ? "true" : "false"}"
          ${uiState.isBusy ? "disabled" : ""}
        >
          Winner
        </button>
        <button
          type="button"
          class="hub-button"
          data-display-action="switch-display-mode"
          data-display-mode="${DISPLAY_MODE_ANNOUNCEMENT}"
          aria-pressed="${uiState.displayState.mode === DISPLAY_MODE_ANNOUNCEMENT ? "true" : "false"}"
          ${uiState.isBusy ? "disabled" : ""}
        >
          Announcement
        </button>
      </div>
    `;
  }

  function renderControlsMarkup() {
    const waitingFallback = getWaitingStatusFallback(getEventConfig());

    return `
      <section class="player-section admin-section display-control-section" data-display-controls-root>
        <div class="player-section-header">
          <div>
            <p class="eyebrow">Display Control</p>
            <h3>Control the Public Display Screen</h3>
            <p class="player-copy">Switch the public display without touching Trivia or Bingo gameplay paths. Trivia display commands stay bound to a specific Trivia round ID until you switch away.</p>
          </div>
        </div>
        ${renderNoticesMarkup()}
        ${renderSummaryMarkup()}
        <section class="display-control-panel">
          <div class="display-control-panel-header">
            <div>
              <p class="eyebrow">Quick Modes</p>
              <h4>Show a Saved Display Mode</h4>
              <p class="player-copy">Winner and Announcement quick buttons only reuse valid saved text. Trivia buttons bind the public display to the current live Trivia round ID.</p>
            </div>
          </div>
          ${renderQuickModeMarkup()}
          <button
            type="button"
            class="secondary-button"
            data-display-action="return-to-waiting"
            ${uiState.isBusy ? "disabled" : ""}
          >
            Return to Waiting
          </button>
        </section>

        <section class="display-control-panel">
          <div class="display-control-panel-header">
            <div>
              <p class="eyebrow">Waiting Screen</p>
              <h4>Update the Waiting Message</h4>
              <p class="player-copy">Blank Waiting updates fall back to the current event status: <strong>${escapeHtml(waitingFallback)}</strong></p>
            </div>
          </div>
          <form class="player-form admin-editor-form" data-display-form="waiting" novalidate>
            <label class="form-field" for="${escapeHtml(role)}-display-waiting-status">
              <span>Status Message</span>
              <textarea
                id="${escapeHtml(role)}-display-waiting-status"
                name="statusMessage"
                class="form-input form-textarea display-control-textarea"
                rows="3"
                data-display-waiting-input
                ${uiState.isBusy ? "disabled" : ""}
              ></textarea>
            </label>
            <div class="player-form-actions">
              <button type="submit" class="primary-button" ${uiState.isBusy ? "disabled" : ""}>
                ${uiState.isBusy ? "Saving..." : "Update Waiting Screen"}
              </button>
            </div>
          </form>
        </section>

        <section class="display-control-panel">
          <div class="display-control-panel-header">
            <div>
              <p class="eyebrow">Announcement</p>
              <h4>Show a Public Announcement</h4>
              <p class="player-copy">Announcement titles are optional. Blank titles fall back to <strong>Announcement</strong>, but the message itself is required.</p>
            </div>
          </div>
          <form class="player-form admin-editor-form" data-display-form="announcement" novalidate>
            <label class="form-field" for="${escapeHtml(role)}-display-announcement-title">
              <span>Title</span>
              <input
                id="${escapeHtml(role)}-display-announcement-title"
                name="title"
                class="form-input"
                type="text"
                data-display-announcement-title-input
                ${uiState.isBusy ? "disabled" : ""}
              >
            </label>
            <label class="form-field" for="${escapeHtml(role)}-display-announcement-message">
              <span>Message</span>
              <textarea
                id="${escapeHtml(role)}-display-announcement-message"
                name="message"
                class="form-input form-textarea display-control-textarea"
                rows="4"
                data-display-announcement-message-input
                ${uiState.isBusy ? "disabled" : ""}
              ></textarea>
            </label>
            <div class="player-form-actions">
              <button type="submit" class="primary-button" ${uiState.isBusy ? "disabled" : ""}>
                ${uiState.isBusy ? "Saving..." : "Show Announcement"}
              </button>
            </div>
          </form>
        </section>

        <section class="display-control-panel">
          <div class="display-control-panel-header">
            <div>
              <p class="eyebrow">Winner</p>
              <h4>Show a Public Winner Message</h4>
              <p class="player-copy">Winner titles are optional. Blank titles fall back to <strong>Winner</strong>, but the message itself is required.</p>
            </div>
          </div>
          <form class="player-form admin-editor-form" data-display-form="winner" novalidate>
            <label class="form-field" for="${escapeHtml(role)}-display-winner-title">
              <span>Title</span>
              <input
                id="${escapeHtml(role)}-display-winner-title"
                name="title"
                class="form-input"
                type="text"
                data-display-winner-title-input
                ${uiState.isBusy ? "disabled" : ""}
              >
            </label>
            <label class="form-field" for="${escapeHtml(role)}-display-winner-message">
              <span>Message</span>
              <textarea
                id="${escapeHtml(role)}-display-winner-message"
                name="message"
                class="form-input form-textarea display-control-textarea"
                rows="4"
                data-display-winner-message-input
                ${uiState.isBusy ? "disabled" : ""}
              ></textarea>
            </label>
            <div class="player-form-actions">
              <button type="submit" class="primary-button" ${uiState.isBusy ? "disabled" : ""}>
                ${uiState.isBusy ? "Saving..." : "Show Winner"}
              </button>
            </div>
          </form>
        </section>
      </section>
    `;
  }

  function applyDraftValues() {
    if (!activeContainerNode) {
      return;
    }

    const waitingField = activeContainerNode.querySelector("[data-display-waiting-input]");
    const announcementTitleField = activeContainerNode.querySelector("[data-display-announcement-title-input]");
    const announcementMessageField = activeContainerNode.querySelector("[data-display-announcement-message-input]");
    const winnerTitleField = activeContainerNode.querySelector("[data-display-winner-title-input]");
    const winnerMessageField = activeContainerNode.querySelector("[data-display-winner-message-input]");

    if (waitingField instanceof HTMLTextAreaElement) {
      waitingField.value = uiState.waitingStatusDraft;
    }

    if (announcementTitleField instanceof HTMLInputElement) {
      announcementTitleField.value = uiState.announcementTitleDraft;
    }

    if (announcementMessageField instanceof HTMLTextAreaElement) {
      announcementMessageField.value = uiState.announcementMessageDraft;
    }

    if (winnerTitleField instanceof HTMLInputElement) {
      winnerTitleField.value = uiState.winnerTitleDraft;
    }

    if (winnerMessageField instanceof HTMLTextAreaElement) {
      winnerMessageField.value = uiState.winnerMessageDraft;
    }
  }

  function render() {
    if (!activeContainerNode) {
      return;
    }

    activeContainerNode.innerHTML = renderControlsMarkup();
    applyDraftValues();
  }

  function handleDisplayListenerUpdate(displayValue, listenerStatus) {
    if (!listenerStatus.ok) {
      uiState.isDisplayLoading = false;

      if (uiState.hasLoadedDisplay) {
        uiState.displayWarning = "Live Display updates are temporarily unavailable. Showing the last loaded Display state.";
      } else {
        uiState.displayUnavailableMessage = "The saved Display state is temporarily unavailable. Waiting-mode fallback is still available locally.";
      }

      render();
      return;
    }

    const normalizedDisplayState = normalizeDisplayState(displayValue, getEventConfig());

    uiState.displayState = normalizedDisplayState;
    uiState.hasLoadedDisplay = true;
    uiState.isDisplayLoading = false;
    uiState.displayUnavailableMessage = "";
    uiState.displayWarning = normalizedDisplayState.isValid
      ? ""
      : "Some saved Display fields were invalid. Showing the safe normalized Display state.";
    syncDraftsFromDisplay(normalizedDisplayState);
    render();
  }

  function handleTriviaRoundListenerUpdate(roundValue, listenerStatus) {
    if (!listenerStatus.ok) {
      uiState.isTriviaRoundLoading = false;

      if (uiState.hasLoadedTriviaRound) {
        uiState.triviaWarning = "Live Trivia round updates are temporarily unavailable. Trivia Display buttons will re-check Firebase before saving.";
      } else {
        uiState.triviaUnavailableMessage = "The current Live Trivia round is temporarily unavailable right now.";
      }

      render();
      return;
    }

    const normalizedRound = normalizeTriviaCurrentRound(roundValue);

    uiState.triviaRound = normalizedRound.isValid
      ? normalizedRound
      : normalizeTriviaCurrentRound(null);
    uiState.hasLoadedTriviaRound = true;
    uiState.isTriviaRoundLoading = false;
    uiState.triviaUnavailableMessage = normalizedRound.isValid
      ? ""
      : "The current Live Trivia round data is invalid right now.";
    uiState.triviaWarning = "";
    render();
  }

  function ensureListeners() {
    if (typeof unsubscribeDisplayListener !== "function") {
      uiState.isDisplayLoading = !uiState.hasLoadedDisplay;
      unsubscribeDisplayListener = firebase.listenEventData(DISPLAY_PATH, handleDisplayListenerUpdate);
    }

    if (typeof unsubscribeTriviaRoundListener !== "function") {
      uiState.isTriviaRoundLoading = !uiState.hasLoadedTriviaRound;
      unsubscribeTriviaRoundListener = firebase.listenEventData(
        TRIVIA_CURRENT_ROUND_PATH,
        handleTriviaRoundListenerUpdate
      );
    }
  }

  function detachListeners() {
    if (typeof unsubscribeDisplayListener === "function") {
      unsubscribeDisplayListener();
    }

    if (typeof unsubscribeTriviaRoundListener === "function") {
      unsubscribeTriviaRoundListener();
    }

    unsubscribeDisplayListener = null;
    unsubscribeTriviaRoundListener = null;
  }

  async function patchDisplayState(nextPatch, successMessage) {
    uiState.isBusy = true;
    setActionMessage();
    render();

    const updateSucceeded = await firebase.updateEventData(DISPLAY_PATH, nextPatch);

    uiState.isBusy = false;

    if (!updateSucceeded) {
      setActionMessage(
        firebase.getStatus().message || "The Display update could not be saved right now. Please try again.",
        "error"
      );
      render();
      return false;
    }

    setActionMessage(successMessage, "success");
    render();
    return true;
  }

  async function readLatestDisplayState() {
    const displayValue = await firebase.readEventData(DISPLAY_PATH);
    const firebaseStatus = firebase.getStatus();

    return {
      displayState: normalizeDisplayState(displayValue, getEventConfig()),
      readFailed: !firebaseStatus.isConnected,
      statusMessage: firebaseStatus.message,
    };
  }

  async function readLatestTriviaRound() {
    const roundValue = await firebase.readEventData(TRIVIA_CURRENT_ROUND_PATH);
    const firebaseStatus = firebase.getStatus();
    const normalizedRound = normalizeTriviaCurrentRound(roundValue);

    return {
      round: normalizedRound,
      readFailed: !firebaseStatus.isConnected,
      statusMessage: firebaseStatus.message,
    };
  }

  async function switchDisplayMode(mode) {
    if (mode === DISPLAY_MODE_WAITING) {
      const patch = buildDisplayModePatch({
        mode: DISPLAY_MODE_WAITING,
        updatedByRole: role,
      });

      await patchDisplayState(patch, "Display switched to Waiting mode.");
      return;
    }

    if (mode === DISPLAY_MODE_BINGO) {
      const patch = buildDisplayModePatch({
        mode: DISPLAY_MODE_BINGO,
        updatedByRole: role,
      });

      await patchDisplayState(patch, "Display switched to Bingo mode.");
      return;
    }

    if (mode === DISPLAY_MODE_WINNER || mode === DISPLAY_MODE_ANNOUNCEMENT) {
      const latestDisplayState = await readLatestDisplayState();

      if (latestDisplayState.readFailed) {
        setActionMessage(
          latestDisplayState.statusMessage || "The latest Display state could not be loaded. Please try again.",
          "error"
        );
        render();
        return;
      }

      const hasValidSavedMessage = mode === DISPLAY_MODE_WINNER
        ? hasWinnerDisplayMessage(latestDisplayState.displayState)
        : hasAnnouncementDisplayMessage(latestDisplayState.displayState);

      if (!hasValidSavedMessage) {
        setActionMessage(
          mode === DISPLAY_MODE_WINNER
            ? "A saved Winner message is required before the quick Winner mode button can be used."
            : "A saved Announcement message is required before the quick Announcement mode button can be used.",
          "warning"
        );
        render();
        return;
      }

      const patch = buildDisplayModePatch({
        mode,
        updatedByRole: role,
      });

      await patchDisplayState(
        patch,
        mode === DISPLAY_MODE_WINNER
          ? "Display switched to the saved Winner message."
          : "Display switched to the saved Announcement."
      );
      return;
    }

    if (mode === DISPLAY_MODE_TRIVIA || mode === DISPLAY_MODE_TRIVIA_REVEAL) {
      const latestTriviaRound = await readLatestTriviaRound();

      if (latestTriviaRound.readFailed) {
        setActionMessage(
          latestTriviaRound.statusMessage || "The current Live Trivia round could not be loaded. Please try again.",
          "error"
        );
        render();
        return;
      }

      const canUseTriviaMode = mode === DISPLAY_MODE_TRIVIA
        ? canDisplayTriviaRound(latestTriviaRound.round)
        : canDisplayTriviaRevealRound(latestTriviaRound.round);

      if (!canUseTriviaMode) {
        setActionMessage(
          mode === DISPLAY_MODE_TRIVIA
            ? "Trivia mode is only available when a valid Live Trivia round is active."
            : "Trivia Reveal is only available after the current Live Trivia round has been revealed.",
          "warning"
        );
        render();
        return;
      }

      const patch = buildDisplayModePatch({
        mode,
        triviaRoundId: latestTriviaRound.round.roundId,
        updatedByRole: role,
      });

      await patchDisplayState(
        patch,
        mode === DISPLAY_MODE_TRIVIA
          ? `Display switched to Trivia mode for round ${latestTriviaRound.round.roundId}.`
          : `Display switched to Trivia Reveal for round ${latestTriviaRound.round.roundId}.`
      );
    }
  }

  async function updateWaitingScreen() {
    const patch = buildWaitingDisplayPatch({
      statusMessage: uiState.waitingStatusDraft,
      eventConfig: getEventConfig(),
      updatedByRole: role,
    });
    const saveSucceeded = await patchDisplayState(patch, "Waiting screen updated.");

    if (!saveSucceeded) {
      return;
    }

    uiState.waitingStatusDraft = patch.statusMessage;
    uiState.isWaitingDirty = false;
  }

  async function showAnnouncement() {
    const validationResult = validateAnnouncementDraft({
      title: uiState.announcementTitleDraft,
      message: uiState.announcementMessageDraft,
    });

    if (!validationResult.ok) {
      setActionMessage(validationResult.message, "warning");
      render();
      return;
    }

    const patch = buildAnnouncementDisplayPatch({
      title: validationResult.title,
      message: validationResult.message,
      updatedByRole: role,
    });
    const saveSucceeded = await patchDisplayState(patch, "Announcement pushed to the public Display.");

    if (!saveSucceeded) {
      return;
    }

    uiState.announcementTitleDraft = patch.announcement.title;
    uiState.announcementMessageDraft = patch.announcement.message;
    uiState.isAnnouncementDirty = false;
  }

  async function showWinner() {
    const validationResult = validateWinnerDraft({
      title: uiState.winnerTitleDraft,
      message: uiState.winnerMessageDraft,
    });

    if (!validationResult.ok) {
      setActionMessage(validationResult.message, "warning");
      render();
      return;
    }

    const patch = buildWinnerDisplayPatch({
      title: validationResult.title,
      message: validationResult.message,
      updatedByRole: role,
    });
    const saveSucceeded = await patchDisplayState(patch, "Winner message pushed to the public Display.");

    if (!saveSucceeded) {
      return;
    }

    uiState.winnerTitleDraft = patch.winner.title;
    uiState.winnerMessageDraft = patch.winner.message;
    uiState.isWinnerDirty = false;
  }

  return {
    renderInto(containerNode) {
      activeContainerNode = containerNode || null;

      if (!activeContainerNode) {
        return;
      }

      ensureListeners();
      render();
    },
    cleanup() {
      detachListeners();
      activeContainerNode = null;
    },
    handleInput(event) {
      const inputNode = event.target;

      if (!(inputNode instanceof HTMLInputElement) && !(inputNode instanceof HTMLTextAreaElement)) {
        return false;
      }

      if (!inputNode.closest("[data-display-controls-root]")) {
        return false;
      }

      if (inputNode.dataset.displayWaitingInput !== undefined) {
        uiState.waitingStatusDraft = inputNode.value;
        uiState.isWaitingDirty = true;
        return true;
      }

      if (inputNode.dataset.displayAnnouncementTitleInput !== undefined) {
        uiState.announcementTitleDraft = inputNode.value;
        uiState.isAnnouncementDirty = true;
        return true;
      }

      if (inputNode.dataset.displayAnnouncementMessageInput !== undefined) {
        uiState.announcementMessageDraft = inputNode.value;
        uiState.isAnnouncementDirty = true;
        return true;
      }

      if (inputNode.dataset.displayWinnerTitleInput !== undefined) {
        uiState.winnerTitleDraft = inputNode.value;
        uiState.isWinnerDirty = true;
        return true;
      }

      if (inputNode.dataset.displayWinnerMessageInput === undefined) {
        return false;
      }

      uiState.winnerMessageDraft = inputNode.value;
      uiState.isWinnerDirty = true;
      return true;
    },
    async handleClick(event) {
      const actionNode = event.target.closest("[data-display-action]");

      if (!actionNode || !actionNode.closest("[data-display-controls-root]")) {
        return false;
      }

      if (uiState.isBusy) {
        return true;
      }

      const action = actionNode.dataset.displayAction;

      if (action === "switch-display-mode") {
        await switchDisplayMode(actionNode.dataset.displayMode);
        return true;
      }

      if (action === "return-to-waiting") {
        await switchDisplayMode(DISPLAY_MODE_WAITING);
        return true;
      }

      return false;
    },
    async handleSubmit(event) {
      const formNode = event.target;

      if (!(formNode instanceof HTMLFormElement) || !formNode.closest("[data-display-controls-root]")) {
        return false;
      }

      const formType = formNode.dataset.displayForm;

      if (!formType) {
        return false;
      }

      event.preventDefault();

      if (uiState.isBusy) {
        return true;
      }

      if (formType === "waiting") {
        await updateWaitingScreen();
        return true;
      }

      if (formType === "announcement") {
        await showAnnouncement();
        return true;
      }

      if (formType === "winner") {
        await showWinner();
        return true;
      }

      return false;
    },
    getState() {
      return {
        displayState: uiState.displayState,
        triviaRound: uiState.triviaRound,
        waitingStatusDraft: uiState.waitingStatusDraft,
        announcementTitleDraft: uiState.announcementTitleDraft,
        announcementMessageDraft: uiState.announcementMessageDraft,
        winnerTitleDraft: uiState.winnerTitleDraft,
        winnerMessageDraft: uiState.winnerMessageDraft,
        winnerTitle: getDisplayMessageTitle(uiState.displayState.winner, "Winner"),
        announcementTitle: getDisplayMessageTitle(uiState.displayState.announcement, "Announcement"),
      };
    },
  };
}

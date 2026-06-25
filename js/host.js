import { initTriviaModule } from "./trivia.js";
import { initBingoModule } from "./bingo.js";
import {
  BINGO_CARD_ITEM_COUNT,
  BINGO_LIVE_CARDS_PATH,
  BINGO_LIVE_CURRENT_ROUND_PATH,
  BINGO_RECOMMENDED_MINIMUM_POOL_SIZE,
  BINGO_ROUND_STATUS_CARDS_LOCKED,
  BINGO_ROUND_STATUS_ENDED,
  BINGO_ROUND_STATUS_IN_PROGRESS,
  BINGO_SOURCE_POOL_PATH,
  buildBingoCurrentRoundPayload,
  countRegisteredPlayers,
  createEmptyBingoCurrentRound,
  getBingoRoundStatusLabel,
  getBingoTargetPoolSize,
  hasPreparedBingoRound,
  normalizeBingoCurrentRound,
  normalizeBingoSourcePool,
  sampleBingoItems,
} from "./bingo-pool.js";
import {
  BINGO_DRAW_METHOD_MANUAL,
  BINGO_DRAW_METHOD_RANDOM,
  calculateBingoRoundStatistics,
  canClearBingoRound,
  canDrawBingoRound,
  canEndBingoRound,
  canLockBingoRound,
  canStartBingoRound,
  getBingoLineLabel,
  getBingoRoundDrawsPath,
  getBingoRoundWinnerPath,
  getBingoRoundWinnersPath,
  getBingoWinnerGuardKey,
  getNextBingoDrawSequence,
  getUndrawnBingoRoundItems,
  normalizeBingoRoundCards,
  selectRandomUndrawnBingoItem,
} from "./bingo-live.js";
import { initRoleProtectedPage } from "./role-access.js";
import {
  getRandomQuestion,
  normalizeTriviaQuestionPool,
  TRIVIA_QUESTION_POOL_PATH,
} from "./trivia-pool.js";
import {
  buildLiveTriviaRoundPayload,
  calculateTriviaAnswerStats,
  canEndTriviaRound,
  canLockTriviaRound,
  canRevealTriviaRound,
  createEmptyTriviaAnswerStats,
  createEmptyTriviaCurrentRound,
  getTriviaRoundAnswersPath,
  getTriviaRoundStatusLabel,
  hasActiveTriviaRound,
  normalizeTriviaCurrentRound,
  TRIVIA_CURRENT_ROUND_PATH,
} from "./trivia-live.js";
import {
  buildAnnouncementDisplayPatch,
  buildDisplayModePatch,
  buildWaitingDisplayPatch,
  buildWinnerDisplayPatch,
  canDisplayTriviaRevealRound,
  canDisplayTriviaRound,
  DISPLAY_MODE_BINGO,
  DISPLAY_MODE_ANNOUNCEMENT,
  DISPLAY_MODE_TRIVIA,
  DISPLAY_MODE_TRIVIA_REVEAL,
  DISPLAY_MODE_WAITING,
  DISPLAY_MODE_WINNER,
  DISPLAY_PATH,
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

const HOST_ROOT_SELECTOR = "#host-app";

const HOST_RESERVED_CARDS = [
  {
    title: "Operations Dashboard",
    description: "A broader host operations dashboard will be added in a later slice after the remaining core modules are complete.",
  },
  {
    title: "Expanded Host Tools",
    description: "Additional host-only coordination shortcuts will be added in a later slice.",
  },
];

const HOST_FILTER_DEFINITIONS = [
  { key: "all", label: "All" },
  { key: "easy", label: "Easy" },
  { key: "medium", label: "Medium" },
  { key: "hard", label: "Hard" },
];

const HOST_DEFAULT_TAB_KEY = "trivia";

const HOST_TAB_DEFINITIONS = [
  { key: "display", label: "Display" },
  { key: "trivia", label: "Trivia" },
  { key: "bingo", label: "Bingo" },
  { key: "advanced", label: "Advanced" },
];

let activeHostRoot = null;
let activeHostClickHandler = null;
let activeHostInputHandler = null;
let activeHostChangeHandler = null;
let activeHostSubmitHandler = null;
let unsubscribeTriviaPoolListener = null;
let unsubscribeCurrentRoundListener = null;
let unsubscribeHostAnswersListener = null;
let unsubscribeHostDisplayListener = null;
let unsubscribeBingoSourcePoolListener = null;
let unsubscribeBingoCurrentRoundListener = null;
let unsubscribeRegisteredPlayersListener = null;
let unsubscribeBingoCardsListener = null;
let unsubscribeBingoDrawsListener = null;
let unsubscribeBingoWinnersListener = null;
let hasBoundHostBeforeUnload = false;

function normalizeHostTabKey(tabKey) {
  const normalizedTabKey = normalizeTextInput(tabKey).toLowerCase();

  return HOST_TAB_DEFINITIONS.some((tabDefinition) => tabDefinition.key === normalizedTabKey)
    ? normalizedTabKey
    : HOST_DEFAULT_TAB_KEY;
}

function normalizeHostDifficultyFilter(filterValue) {
  const normalizedFilter = normalizeTextInput(filterValue).toLowerCase();

  return HOST_FILTER_DEFINITIONS.some((filterDefinition) => filterDefinition.key === normalizedFilter)
    ? normalizedFilter
    : "all";
}

function renderReservedCards(cards) {
  return cards
    .map((card) => `
      <article class="placeholder-card">
        <h3>${escapeHtml(card.title)}</h3>
        <p>${escapeHtml(card.description)}</p>
      </article>
    `)
    .join("");
}

function formatUpdatedAt(updatedAt) {
  if (!updatedAt) {
    return "Not saved yet.";
  }

  const parsedDate = new Date(updatedAt);

  if (Number.isNaN(parsedDate.getTime())) {
    return updatedAt;
  }

  return parsedDate.toLocaleString();
}

function createCountDefinition(label, value) {
  return { label, value: String(value) };
}

function formatTriviaDifficultyLabel(difficultyValue) {
  const normalizedDifficulty = normalizeTextInput(difficultyValue).toLowerCase();

  return normalizedDifficulty
    ? `${normalizedDifficulty.charAt(0).toUpperCase()}${normalizedDifficulty.slice(1)}`
    : "All";
}

function formatTriviaQuestionOptionLabel(question) {
  return `[${formatTriviaDifficultyLabel(question.difficulty)}] ${question.question}`;
}

function normalizeHostDisplayComposerType(value) {
  const normalizedValue = normalizeTextInput(value).toLowerCase();

  if (
    normalizedValue === DISPLAY_MODE_WAITING
    || normalizedValue === DISPLAY_MODE_ANNOUNCEMENT
    || normalizedValue === DISPLAY_MODE_WINNER
  ) {
    return normalizedValue;
  }

  return DISPLAY_MODE_WAITING;
}

function createNoticeNode(message, tone = "info") {
  const noticeNode = document.createElement("div");

  noticeNode.className = "notice-panel";
  noticeNode.dataset.tone = tone;
  noticeNode.textContent = message;
  return noticeNode;
}

function createTriviaQuestionMetaRow(label, value) {
  const rowNode = document.createElement("p");
  const labelNode = document.createElement("strong");

  rowNode.className = "trivia-question-meta";
  labelNode.textContent = `${label}: `;
  rowNode.append(labelNode, document.createTextNode(value));
  return rowNode;
}

function createTriviaOptionsList(question) {
  const listNode = document.createElement("ol");

  listNode.className = "trivia-options-list";
  question.options.forEach((optionValue, optionIndex) => {
    const optionNode = document.createElement("li");

    optionNode.textContent = `${optionIndex + 1}. ${optionValue}`;
    listNode.append(optionNode);
  });

  return listNode;
}

function createTriviaQuestionCard(
  question,
  {
    showHeading = true,
    showId = true,
    showAnswer = true,
    showDifficultyMeta = true,
    showSelectAction = false,
    isSelected = false,
    selectActionLabel = "Select Question",
    includePanelChrome = true,
  } = {}
) {
  const questionNode = document.createElement("article");
  const headerNode = document.createElement("div");
  const headingNode = document.createElement(showHeading ? "h4" : "h3");
  const badgeNode = document.createElement("span");
  const questionCopyNode = document.createElement("p");
  const correctAnswerIndex = Number.isInteger(question.correctAnswer)
    ? question.correctAnswer
    : question.answer;

  questionNode.className = `${includePanelChrome ? "hub-panel " : ""}trivia-question-card`;
  questionNode.dataset.questionId = question.id;
  questionNode.dataset.selected = isSelected ? "true" : "false";
  headerNode.className = "trivia-question-header";
  badgeNode.className = "trivia-difficulty-badge";
  badgeNode.dataset.difficulty = question.difficulty;
  badgeNode.textContent = question.difficulty;
  questionCopyNode.className = "trivia-question-copy";
  questionCopyNode.textContent = question.question;

  if (showId) {
    headingNode.textContent = question.id;
    headerNode.append(headingNode);
  }

  headerNode.append(badgeNode);
  questionNode.append(headerNode);

  if (showDifficultyMeta) {
    questionNode.append(createTriviaQuestionMetaRow("Difficulty", question.difficulty));
  }

  questionNode.append(questionCopyNode, createTriviaOptionsList(question));

  if (showAnswer && Number.isInteger(correctAnswerIndex) && question.options[correctAnswerIndex]) {
    const answerNode = document.createElement("p");

    answerNode.className = "trivia-answer-note";
    answerNode.textContent = `Correct answer: Choice ${correctAnswerIndex + 1} (${question.options[correctAnswerIndex]})`;
    questionNode.append(answerNode);
  }

  if (showSelectAction) {
    const actionsNode = document.createElement("div");
    const selectButton = document.createElement("button");

    actionsNode.className = "trivia-question-actions";
    selectButton.type = "button";
    selectButton.className = isSelected ? "primary-button" : "secondary-button";
    selectButton.dataset.action = "select-trivia-question";
    selectButton.dataset.questionId = question.id;
    selectButton.textContent = selectActionLabel;
    actionsNode.append(selectButton);
    questionNode.append(actionsNode);
  }

  return questionNode;
}

function createTriviaQuestionListRow(question, isSelected) {
  const rowNode = document.createElement("article");
  const copyNode = document.createElement("p");
  const badgeNode = document.createElement("span");
  const buttonNode = document.createElement("button");

  rowNode.className = "host-trivia-list-item";
  rowNode.dataset.selected = isSelected ? "true" : "false";
  badgeNode.className = "trivia-difficulty-badge";
  badgeNode.dataset.difficulty = question.difficulty;
  badgeNode.textContent = formatTriviaDifficultyLabel(question.difficulty);
  copyNode.className = "trivia-question-copy";
  copyNode.textContent = question.question;
  buttonNode.type = "button";
  buttonNode.className = isSelected ? "primary-button" : "secondary-button";
  buttonNode.dataset.action = "select-trivia-question";
  buttonNode.dataset.questionId = question.id;
  buttonNode.textContent = isSelected ? "Selected" : "Select";

  rowNode.append(badgeNode, copyNode, buttonNode);
  return rowNode;
}

function createRoundSnapshotQuestion(round) {
  return {
    id: round.questionId,
    difficulty: round.difficulty,
    question: round.question,
    options: round.options.slice(),
    correctAnswer: round.correctAnswer,
  };
}

function cleanupHostTriviaController() {
  if (typeof unsubscribeTriviaPoolListener === "function") {
    unsubscribeTriviaPoolListener();
  }

  if (typeof unsubscribeCurrentRoundListener === "function") {
    unsubscribeCurrentRoundListener();
  }

  if (typeof unsubscribeHostAnswersListener === "function") {
    unsubscribeHostAnswersListener();
  }

  if (typeof unsubscribeHostDisplayListener === "function") {
    unsubscribeHostDisplayListener();
  }

  if (typeof unsubscribeBingoSourcePoolListener === "function") {
    unsubscribeBingoSourcePoolListener();
  }

  if (typeof unsubscribeBingoCurrentRoundListener === "function") {
    unsubscribeBingoCurrentRoundListener();
  }

  if (typeof unsubscribeRegisteredPlayersListener === "function") {
    unsubscribeRegisteredPlayersListener();
  }

  if (typeof unsubscribeBingoCardsListener === "function") {
    unsubscribeBingoCardsListener();
  }

  if (typeof unsubscribeBingoDrawsListener === "function") {
    unsubscribeBingoDrawsListener();
  }

  if (typeof unsubscribeBingoWinnersListener === "function") {
    unsubscribeBingoWinnersListener();
  }

  unsubscribeTriviaPoolListener = null;
  unsubscribeCurrentRoundListener = null;
  unsubscribeHostAnswersListener = null;
  unsubscribeHostDisplayListener = null;
  unsubscribeBingoSourcePoolListener = null;
  unsubscribeBingoCurrentRoundListener = null;
  unsubscribeRegisteredPlayersListener = null;
  unsubscribeBingoCardsListener = null;
  unsubscribeBingoDrawsListener = null;
  unsubscribeBingoWinnersListener = null;

  if (activeHostRoot && activeHostClickHandler) {
    activeHostRoot.removeEventListener("click", activeHostClickHandler);
  }

  if (activeHostRoot && activeHostInputHandler) {
    activeHostRoot.removeEventListener("input", activeHostInputHandler);
  }

  if (activeHostRoot && activeHostChangeHandler) {
    activeHostRoot.removeEventListener("change", activeHostChangeHandler);
  }

  if (activeHostRoot && activeHostSubmitHandler) {
    activeHostRoot.removeEventListener("submit", activeHostSubmitHandler);
  }

  activeHostRoot = null;
  activeHostClickHandler = null;
  activeHostInputHandler = null;
  activeHostChangeHandler = null;
  activeHostSubmitHandler = null;
}

function handleHostBeforeUnload() {
  cleanupHostTriviaController();
}

export function initHostPage({ firebase, state, renderStatus }) {
  const hostRoot = document.querySelector(HOST_ROOT_SELECTOR);
  const hostUiState = {
    questionPool: normalizeTriviaQuestionPool(null),
    hasLoadedQuestionPool: false,
    isQuestionPoolLoading: true,
    questionPoolUnavailableMessage: "",
    questionPoolWarning: "",
    activeDifficultyFilter: "all",
    pushedQuestionIds: new Set(),
    randomPreviewQuestionId: "",
    selectedQuestionId: "",
    activeTab: HOST_DEFAULT_TAB_KEY,
    displayState: normalizeDisplayState(null, state.getState().eventConfig),
    hasLoadedDisplayState: false,
    isDisplayStateLoading: true,
    displayUnavailableMessage: "",
    displayWarning: "",
    displayActionMessage: {
      text: "",
      tone: "info",
    },
    displayComposerType: DISPLAY_MODE_WAITING,
    displayWaitingDraft: getWaitingStatusFallback(state.getState().eventConfig),
    displayAnnouncementTitleDraft: "",
    displayAnnouncementMessageDraft: "",
    displayWinnerTitleDraft: "",
    displayWinnerMessageDraft: "",
    isDisplayWaitingDirty: false,
    isDisplayAnnouncementDirty: false,
    isDisplayWinnerDirty: false,
    isDisplayActionBusy: false,
    controllerMessage: {
      text: "",
      tone: "info",
    },
    currentRound: normalizeTriviaCurrentRound(null),
    hasLoadedCurrentRound: false,
    isCurrentRoundLoading: true,
    currentRoundUnavailableMessage: "",
    currentRoundWarning: "",
    activeAnswersRoundId: "",
    answerStats: createEmptyTriviaAnswerStats(createEmptyTriviaCurrentRound()),
    hasLoadedAnswerStats: false,
    isAnswerStatsLoading: false,
    answersUnavailableMessage: "",
    answersWarning: "",
    isRoundActionBusy: false,
    bingoSourcePool: normalizeBingoSourcePool(null),
    hasLoadedBingoSourcePool: false,
    isBingoSourcePoolLoading: true,
    bingoSourcePoolUnavailableMessage: "",
    bingoSourcePoolWarning: "",
    registeredPlayerCount: 0,
    registeredPlayersValue: null,
    hasLoadedRegisteredPlayers: false,
    isRegisteredPlayersLoading: true,
    registeredPlayersUnavailableMessage: "",
    registeredPlayersWarning: "",
    bingoCurrentRound: normalizeBingoCurrentRound(null),
    hasLoadedBingoCurrentRound: false,
    isBingoCurrentRoundLoading: true,
    bingoCurrentRoundUnavailableMessage: "",
    bingoCurrentRoundWarning: "",
    isPreparingBingoRound: false,
    isBingoActionBusy: false,
    activeBingoStatsRoundId: "",
    bingoCardsValue: null,
    bingoDrawsValue: null,
    bingoWinnersValue: null,
    hasLoadedBingoCards: false,
    hasLoadedBingoDraws: false,
    hasLoadedBingoWinners: false,
    isBingoCardsLoading: false,
    isBingoDrawsLoading: false,
    isBingoWinnersLoading: false,
    bingoCardsUnavailableMessage: "",
    bingoDrawsUnavailableMessage: "",
    bingoWinnersUnavailableMessage: "",
    bingoCardsWarning: "",
    bingoDrawsWarning: "",
    bingoWinnersWarning: "",
    bingoWinnerPersistenceWarning: "",
    bingoStats: calculateBingoRoundStatistics({
      roundValue: createEmptyBingoCurrentRound(),
    }),
    bingoPreparationMessage: {
      text: "",
      tone: "info",
    },
  };

  cleanupHostTriviaController();

  if (!hasBoundHostBeforeUnload) {
    window.addEventListener("beforeunload", handleHostBeforeUnload);
    hasBoundHostBeforeUnload = true;
  }

  function setControllerMessage(text = "", tone = "info") {
    hostUiState.controllerMessage = { text, tone };
  }

  function setBingoPreparationMessage(text = "", tone = "info") {
    hostUiState.bingoPreparationMessage = { text, tone };
  }

  function getEventConfig() {
    return state.getState().eventConfig || null;
  }

  function setDisplayActionMessage(text = "", tone = "info") {
    hostUiState.displayActionMessage = { text, tone };
  }

  function syncHostDisplayDrafts(displayState, { force = false } = {}) {
    if (force || !hostUiState.isDisplayWaitingDirty) {
      hostUiState.displayWaitingDraft = displayState.statusMessage || getWaitingStatusFallback(getEventConfig());
    }

    if (force || !hostUiState.isDisplayAnnouncementDirty) {
      hostUiState.displayAnnouncementTitleDraft = displayState.announcement.title;
      hostUiState.displayAnnouncementMessageDraft = displayState.announcement.message;
    }

    if (force || !hostUiState.isDisplayWinnerDirty) {
      hostUiState.displayWinnerTitleDraft = displayState.winner.title;
      hostUiState.displayWinnerMessageDraft = displayState.winner.message;
    }
  }

  function getHostConnectionSummary() {
    const currentState = state.getState();
    const firebaseState = currentState.firebase || firebase.getStatus();
    const configSource = currentState.configSource;

    if (!firebaseState.isConnected) {
      return {
        label: firebaseState.isConfigured ? "Fallback" : "Offline",
        tone: "warning",
      };
    }

    if (configSource !== "firebase") {
      return {
        label: "Fallback",
        tone: "warning",
      };
    }

    return {
      label: "Connected",
      tone: "success",
    };
  }

  function getDisplayComposerDrafts() {
    if (hostUiState.displayComposerType === DISPLAY_MODE_ANNOUNCEMENT) {
      return {
        title: hostUiState.displayAnnouncementTitleDraft,
        message: hostUiState.displayAnnouncementMessageDraft,
      };
    }

    if (hostUiState.displayComposerType === DISPLAY_MODE_WINNER) {
      return {
        title: hostUiState.displayWinnerTitleDraft,
        message: hostUiState.displayWinnerMessageDraft,
      };
    }

    return {
      title: "",
      message: hostUiState.displayWaitingDraft,
    };
  }

  function buildDisplayAutoFollowWarning(actionMessage, displayModeLabel) {
    const firebaseStatusMessage = normalizeTextInput(firebase.getStatus().message);
    const fallbackGuidance = `Use the Display controls to switch to ${displayModeLabel} manually.`;

    return `${actionMessage} However, the public display could not switch to ${displayModeLabel} automatically. ${firebaseStatusMessage || fallbackGuidance}`;
  }

  async function syncHostDisplayToTriviaRound(roundId) {
    return firebase.updateEventData(
      DISPLAY_PATH,
      buildDisplayModePatch({
        mode: DISPLAY_MODE_TRIVIA,
        triviaRoundId: roundId,
        updatedByRole: "host",
      })
    );
  }

  async function syncHostDisplayToBingoMode() {
    return firebase.updateEventData(
      DISPLAY_PATH,
      buildDisplayModePatch({
        mode: DISPLAY_MODE_BINGO,
        triviaRoundId: "",
        updatedByRole: "host",
      })
    );
  }

  function attachHostDisplayListener() {
    if (typeof unsubscribeHostDisplayListener === "function") {
      return;
    }

    hostUiState.isDisplayStateLoading = !hostUiState.hasLoadedDisplayState;

    unsubscribeHostDisplayListener = firebase.listenEventData(
      DISPLAY_PATH,
      (displayValue, listenerStatus) => {
        if (!listenerStatus.ok) {
          hostUiState.isDisplayStateLoading = false;

          if (hostUiState.hasLoadedDisplayState) {
            hostUiState.displayWarning = "Live Display updates are temporarily unavailable. Showing the last loaded Display state.";
          } else {
            hostUiState.displayUnavailableMessage = "The current Display state is temporarily unavailable right now.";
          }

          renderHostTriviaController();
          return;
        }

        const normalizedDisplayState = normalizeDisplayState(displayValue, getEventConfig());

        hostUiState.displayState = normalizedDisplayState;
        hostUiState.hasLoadedDisplayState = true;
        hostUiState.isDisplayStateLoading = false;
        hostUiState.displayUnavailableMessage = "";
        hostUiState.displayWarning = normalizedDisplayState.isValid
          ? ""
          : "Some saved Display fields were invalid. Showing the safe normalized Display state.";
        syncHostDisplayDrafts(normalizedDisplayState);
        renderHostTriviaController();
      }
    );
  }

  async function patchHostDisplayState(nextPatch, successMessage) {
    hostUiState.isDisplayActionBusy = true;
    setDisplayActionMessage();
    renderHostTriviaController();

    const updateSucceeded = await firebase.updateEventData(DISPLAY_PATH, nextPatch);

    hostUiState.isDisplayActionBusy = false;

    if (!updateSucceeded) {
      setDisplayActionMessage(
        firebase.getStatus().message || "The Display update could not be saved right now. Please try again.",
        "error"
      );
      renderHostTriviaController();
      return false;
    }

    setDisplayActionMessage(successMessage, "success");
    renderHostTriviaController();
    return true;
  }

  async function switchHostDisplayMode(mode, { successMessage = "" } = {}) {
    const normalizedMode = normalizeTextInput(mode);

    if (normalizedMode === DISPLAY_MODE_WAITING) {
      await patchHostDisplayState(
        buildDisplayModePatch({
          mode: DISPLAY_MODE_WAITING,
          updatedByRole: "host",
        }),
        successMessage || "Display switched to Waiting mode."
      );
      return;
    }

    if (normalizedMode === DISPLAY_MODE_BINGO) {
      await patchHostDisplayState(
        buildDisplayModePatch({
          mode: DISPLAY_MODE_BINGO,
          updatedByRole: "host",
        }),
        successMessage || "Display switched to Bingo mode."
      );
      return;
    }

    if (normalizedMode === DISPLAY_MODE_WINNER) {
      if (!hasWinnerDisplayMessage(hostUiState.displayState)) {
        setDisplayActionMessage("A saved Winner message is required before the display can switch to Winner mode.", "warning");
        renderHostTriviaController();
        return;
      }

      await patchHostDisplayState(
        buildDisplayModePatch({
          mode: DISPLAY_MODE_WINNER,
          updatedByRole: "host",
        }),
        successMessage || "Display switched to the saved Winner message."
      );
      return;
    }

    if (normalizedMode === DISPLAY_MODE_ANNOUNCEMENT) {
      if (!hasAnnouncementDisplayMessage(hostUiState.displayState)) {
        setDisplayActionMessage("A saved Announcement message is required before the display can switch to Announcement mode.", "warning");
        renderHostTriviaController();
        return;
      }

      await patchHostDisplayState(
        buildDisplayModePatch({
          mode: DISPLAY_MODE_ANNOUNCEMENT,
          updatedByRole: "host",
        }),
        successMessage || "Display switched to the saved Announcement."
      );
      return;
    }

    if (normalizedMode === DISPLAY_MODE_TRIVIA || normalizedMode === DISPLAY_MODE_TRIVIA_REVEAL) {
      const canUseTriviaMode = normalizedMode === DISPLAY_MODE_TRIVIA
        ? canDisplayTriviaRound(hostUiState.currentRound)
        : canDisplayTriviaRevealRound(hostUiState.currentRound);

      if (!canUseTriviaMode) {
        setDisplayActionMessage(
          normalizedMode === DISPLAY_MODE_TRIVIA
            ? "Trivia mode is only available when a valid Live Trivia round is active."
            : "Trivia Reveal is only available after the current Live Trivia round has been revealed.",
          "warning"
        );
        renderHostTriviaController();
        return;
      }

      await patchHostDisplayState(
        buildDisplayModePatch({
          mode: normalizedMode,
          triviaRoundId: hostUiState.currentRound.roundId,
          updatedByRole: "host",
        }),
        successMessage || (
          normalizedMode === DISPLAY_MODE_TRIVIA
            ? `Display switched to Trivia mode for round ${hostUiState.currentRound.roundId}.`
            : `Display switched to Trivia Reveal for round ${hostUiState.currentRound.roundId}.`
        )
      );
    }
  }

  async function submitHostDisplayComposer() {
    const composerType = normalizeHostDisplayComposerType(hostUiState.displayComposerType);

    if (composerType === DISPLAY_MODE_WAITING) {
      const waitingPatch = buildWaitingDisplayPatch({
        statusMessage: hostUiState.displayWaitingDraft,
        eventConfig: getEventConfig(),
        updatedByRole: "host",
      });
      const saveSucceeded = await patchHostDisplayState(waitingPatch, "Waiting screen updated.");

      if (saveSucceeded) {
        hostUiState.displayWaitingDraft = waitingPatch.statusMessage;
        hostUiState.isDisplayWaitingDirty = false;
      }

      return;
    }

    if (composerType === DISPLAY_MODE_ANNOUNCEMENT) {
      const validationResult = validateAnnouncementDraft({
        title: hostUiState.displayAnnouncementTitleDraft,
        message: hostUiState.displayAnnouncementMessageDraft,
      });

      if (!validationResult.ok) {
        setDisplayActionMessage(validationResult.message, "warning");
        renderHostTriviaController();
        return;
      }

      const announcementPatch = buildAnnouncementDisplayPatch({
        title: validationResult.title,
        message: validationResult.message,
        updatedByRole: "host",
      });
      const saveSucceeded = await patchHostDisplayState(announcementPatch, "Announcement pushed to the public display.");

      if (saveSucceeded) {
        hostUiState.displayAnnouncementTitleDraft = announcementPatch.announcement.title;
        hostUiState.displayAnnouncementMessageDraft = announcementPatch.announcement.message;
        hostUiState.isDisplayAnnouncementDirty = false;
      }

      return;
    }

    const validationResult = validateWinnerDraft({
      title: hostUiState.displayWinnerTitleDraft,
      message: hostUiState.displayWinnerMessageDraft,
    });

    if (!validationResult.ok) {
      setDisplayActionMessage(validationResult.message, "warning");
      renderHostTriviaController();
      return;
    }

    const winnerPatch = buildWinnerDisplayPatch({
      title: validationResult.title,
      message: validationResult.message,
      updatedByRole: "host",
    });
    const saveSucceeded = await patchHostDisplayState(winnerPatch, "Winner message pushed to the public display.");

    if (saveSucceeded) {
      hostUiState.displayWinnerTitleDraft = winnerPatch.winner.title;
      hostUiState.displayWinnerMessageDraft = winnerPatch.winner.message;
      hostUiState.isDisplayWinnerDirty = false;
    }
  }

  function getActiveContentNode() {
    return hostRoot?.querySelector("[data-role-content]") || null;
  }

  function getSelectedQuestion() {
    if (!hostUiState.selectedQuestionId) {
      return null;
    }

    return hostUiState.questionPool.orderedQuestions.find(
      (question) => question.id === hostUiState.selectedQuestionId
    ) || null;
  }

  function getFilteredQuestions() {
    const difficultyFilteredQuestions = hostUiState.activeDifficultyFilter === "all"
      ? hostUiState.questionPool.orderedQuestions.slice()
      : hostUiState.questionPool.orderedQuestions.filter(
        (question) => question.difficulty === hostUiState.activeDifficultyFilter
      );

    return difficultyFilteredQuestions;
  }

  function getRandomPreviewQuestion() {
    if (!hostUiState.randomPreviewQuestionId) {
      return null;
    }

    return hostUiState.questionPool.orderedQuestions.find(
      (question) => question.id === hostUiState.randomPreviewQuestionId
    ) || null;
  }

  function getTriviaRandomCandidatePool(
    difficulty = "all",
    {
      excludePushed = true,
      excludeCurrentRound = true,
    } = {}
  ) {
    const normalizedDifficulty = normalizeHostDifficultyFilter(difficulty);
    const currentQuestionId = normalizeTextInput(hostUiState.currentRound.questionId);
    const difficultyQuestions = normalizedDifficulty === "all"
      ? hostUiState.questionPool.orderedQuestions.slice()
      : hostUiState.questionPool.orderedQuestions.filter(
        (question) => question.difficulty === normalizedDifficulty
      );

    return difficultyQuestions.filter((question) => {
      if (excludeCurrentRound && currentQuestionId && question.id === currentQuestionId) {
        return false;
      }

      if (excludePushed && hostUiState.pushedQuestionIds.has(question.id)) {
        return false;
      }

      return true;
    });
  }

  function getRandomPreviewQuestionForDifficulty(difficulty = "all") {
    const preferredCandidates = getTriviaRandomCandidatePool(difficulty, {
      excludePushed: true,
      excludeCurrentRound: true,
    });

    if (preferredCandidates.length > 0) {
      return getRandomQuestion(preferredCandidates, "all");
    }

    const nonLiveFallbackCandidates = getTriviaRandomCandidatePool(difficulty, {
      excludePushed: false,
      excludeCurrentRound: true,
    });

    if (nonLiveFallbackCandidates.length > 0) {
      return getRandomQuestion(nonLiveFallbackCandidates, "all");
    }

    return getRandomQuestion(
      getTriviaRandomCandidatePool(difficulty, {
        excludePushed: false,
        excludeCurrentRound: false,
      }),
      "all"
    );
  }

  function clearAnswerStats(round = hostUiState.currentRound) {
    hostUiState.answerStats = createEmptyTriviaAnswerStats(round);
    hostUiState.hasLoadedAnswerStats = false;
    hostUiState.isAnswerStatsLoading = false;
    hostUiState.answersUnavailableMessage = "";
    hostUiState.answersWarning = "";
  }

  function getCurrentBingoTargetPoolSize() {
    return getBingoTargetPoolSize(hostUiState.registeredPlayerCount);
  }

  function createSummaryCountCard({ label, value }) {
    const countNode = document.createElement("article");
    const valueNode = document.createElement("strong");
    const labelNode = document.createElement("span");

    countNode.className = "trivia-count-card";
    valueNode.textContent = String(value);
    labelNode.textContent = label;
    countNode.append(valueNode, labelNode);
    return countNode;
  }

  const bingoWinnerWriteGuards = new Set();

  function clearHostBingoRoundScopedState() {
    hostUiState.activeBingoStatsRoundId = "";
    hostUiState.bingoCardsValue = null;
    hostUiState.bingoDrawsValue = null;
    hostUiState.bingoWinnersValue = null;
    hostUiState.hasLoadedBingoCards = false;
    hostUiState.hasLoadedBingoDraws = false;
    hostUiState.hasLoadedBingoWinners = false;
    hostUiState.isBingoCardsLoading = false;
    hostUiState.isBingoDrawsLoading = false;
    hostUiState.isBingoWinnersLoading = false;
    hostUiState.bingoCardsUnavailableMessage = "";
    hostUiState.bingoDrawsUnavailableMessage = "";
    hostUiState.bingoWinnersUnavailableMessage = "";
    hostUiState.bingoCardsWarning = "";
    hostUiState.bingoDrawsWarning = "";
    hostUiState.bingoWinnersWarning = "";
    hostUiState.bingoWinnerPersistenceWarning = "";
    hostUiState.bingoStats = calculateBingoRoundStatistics({
      roundValue: hostUiState.bingoCurrentRound,
    });
  }

  function detachHostBingoRoundScopedListeners({ clearState = true } = {}) {
    if (typeof unsubscribeBingoCardsListener === "function") {
      unsubscribeBingoCardsListener();
    }

    if (typeof unsubscribeBingoDrawsListener === "function") {
      unsubscribeBingoDrawsListener();
    }

    if (typeof unsubscribeBingoWinnersListener === "function") {
      unsubscribeBingoWinnersListener();
    }

    unsubscribeBingoCardsListener = null;
    unsubscribeBingoDrawsListener = null;
    unsubscribeBingoWinnersListener = null;

    if (clearState) {
      clearHostBingoRoundScopedState();
    }
  }

  function recalculateHostBingoStats() {
    hostUiState.bingoStats = calculateBingoRoundStatistics({
      roundValue: hostUiState.bingoCurrentRound,
      cardsValue: hostUiState.bingoCardsValue,
      drawsValue: hostUiState.bingoDrawsValue,
      winnersValue: hostUiState.bingoWinnersValue,
      playersValue: hostUiState.registeredPlayersValue,
    });
  }

  async function reconcileHostBingoWinners() {
    const currentRound = normalizeBingoCurrentRound(hostUiState.bingoCurrentRound);

    if (
      !firebase.getStatus().isConnected
      || !hasPreparedBingoRound(currentRound)
      || hostUiState.activeBingoStatsRoundId !== currentRound.roundId
      || !hostUiState.hasLoadedBingoCards
      || !hostUiState.hasLoadedBingoDraws
      || !hostUiState.hasLoadedBingoWinners
    ) {
      return;
    }

    const pendingCandidates = hostUiState.bingoStats.derivedWinnerCandidates.filter(
      (winnerCandidate) => winnerCandidate.hasMeaningfulChange
    );

    if (pendingCandidates.length === 0) {
      if (hostUiState.bingoWinnerPersistenceWarning) {
        hostUiState.bingoWinnerPersistenceWarning = "";
        renderHostTriviaController();
      }

      return;
    }

    for (const winnerCandidate of pendingCandidates) {
      const guardKey = getBingoWinnerGuardKey(currentRound.roundId, winnerCandidate.playerId);

      if (bingoWinnerWriteGuards.has(guardKey)) {
        continue;
      }

      bingoWinnerWriteGuards.add(guardKey);

      try {
        const writeSucceeded = await firebase.writeEventData(
          getBingoRoundWinnerPath(currentRound.roundId, winnerCandidate.playerId),
          winnerCandidate.nextWinnerRecord
        );

        if (!writeSucceeded) {
          hostUiState.bingoWinnerPersistenceWarning = firebase.getStatus().message
            || "Winner history could not be saved right now. Derived winner state is still shown.";
          renderHostTriviaController();
        } else if (hostUiState.bingoWinnerPersistenceWarning) {
          hostUiState.bingoWinnersValue = {
            ...(hostUiState.bingoWinnersValue && typeof hostUiState.bingoWinnersValue === "object" && !Array.isArray(hostUiState.bingoWinnersValue)
              ? hostUiState.bingoWinnersValue
              : {}),
            [winnerCandidate.playerId]: winnerCandidate.nextWinnerRecord,
          };
          hostUiState.hasLoadedBingoWinners = true;
          recalculateHostBingoStats();
          hostUiState.bingoWinnerPersistenceWarning = "";
          renderHostTriviaController();
        } else {
          hostUiState.bingoWinnersValue = {
            ...(hostUiState.bingoWinnersValue && typeof hostUiState.bingoWinnersValue === "object" && !Array.isArray(hostUiState.bingoWinnersValue)
              ? hostUiState.bingoWinnersValue
              : {}),
            [winnerCandidate.playerId]: winnerCandidate.nextWinnerRecord,
          };
          hostUiState.hasLoadedBingoWinners = true;
          recalculateHostBingoStats();
        }
      } finally {
        bingoWinnerWriteGuards.delete(guardKey);
      }
    }
  }

  function detachHostAnswersListener({ clearStats = true, roundForStats = hostUiState.currentRound } = {}) {
    if (typeof unsubscribeHostAnswersListener === "function") {
      unsubscribeHostAnswersListener();
    }

    unsubscribeHostAnswersListener = null;
    hostUiState.activeAnswersRoundId = "";

    if (clearStats) {
      clearAnswerStats(roundForStats);
    }
  }

  function syncHostAnswersListener(round) {
    const normalizedRound = normalizeTriviaCurrentRound(round);

    if (!hasActiveTriviaRound(normalizedRound)) {
      detachHostAnswersListener({ clearStats: true, roundForStats: normalizedRound });
      return;
    }

    if (hostUiState.activeAnswersRoundId === normalizedRound.roundId && typeof unsubscribeHostAnswersListener === "function") {
      return;
    }

    detachHostAnswersListener({ clearStats: true, roundForStats: normalizedRound });
    hostUiState.activeAnswersRoundId = normalizedRound.roundId;
    hostUiState.isAnswerStatsLoading = true;

    unsubscribeHostAnswersListener = firebase.listenEventData(
      getTriviaRoundAnswersPath(normalizedRound.roundId),
      (answersValue, listenerStatus) => {
        if (hostUiState.activeAnswersRoundId !== normalizedRound.roundId) {
          return;
        }

        if (!listenerStatus.ok) {
          hostUiState.isAnswerStatsLoading = false;

          if (hostUiState.hasLoadedAnswerStats) {
            hostUiState.answersWarning = "Live answer totals are temporarily unavailable. Showing the last loaded totals.";
          } else {
            hostUiState.answersUnavailableMessage = "Live answer totals are temporarily unavailable right now.";
          }

          renderHostTriviaController();
          return;
        }

        hostUiState.answerStats = calculateTriviaAnswerStats(answersValue, normalizedRound);
        hostUiState.hasLoadedAnswerStats = true;
        hostUiState.isAnswerStatsLoading = false;
        hostUiState.answersUnavailableMessage = "";
        hostUiState.answersWarning = "";
        renderHostTriviaController();
      }
    );
  }

  function renderCounts(countsNode) {
    if (!countsNode) {
      return;
    }

    countsNode.innerHTML = "";

    const stripNode = document.createElement("p");

    stripNode.className = "host-trivia-count-strip";
    stripNode.innerHTML = `
      <span><strong>Easy:</strong> ${escapeHtml(String(hostUiState.questionPool.counts.easy))}</span>
      <span><strong>Medium:</strong> ${escapeHtml(String(hostUiState.questionPool.counts.medium))}</span>
      <span><strong>Hard:</strong> ${escapeHtml(String(hostUiState.questionPool.counts.hard))}</span>
      <span><strong>Total:</strong> ${escapeHtml(String(hostUiState.questionPool.counts.total))}</span>
    `;
    countsNode.append(stripNode);
  }

  function renderPoolStatusNotice(statusNode) {
    if (!statusNode) {
      return;
    }

    statusNode.innerHTML = "";

    if (hostUiState.isQuestionPoolLoading && !hostUiState.hasLoadedQuestionPool) {
      statusNode.append(createNoticeNode("Loading the current Trivia question pool...", "info"));
      return;
    }

    if (hostUiState.questionPoolUnavailableMessage && !hostUiState.hasLoadedQuestionPool) {
      statusNode.append(createNoticeNode(hostUiState.questionPoolUnavailableMessage, "warning"));
      return;
    }

    if (hostUiState.questionPoolWarning) {
      statusNode.append(createNoticeNode(hostUiState.questionPoolWarning, "warning"));
    }
  }

  function renderQuestionList(questionListNode) {
    if (!questionListNode) {
      return;
    }

    questionListNode.innerHTML = "";

    if (hostUiState.isQuestionPoolLoading && !hostUiState.hasLoadedQuestionPool) {
      return;
    }

    if (hostUiState.questionPoolUnavailableMessage && !hostUiState.hasLoadedQuestionPool) {
      const unavailablePanelNode = document.createElement("div");
      const unavailableCopyNode = document.createElement("p");

      unavailablePanelNode.className = "hub-panel trivia-empty-panel";
      unavailableCopyNode.textContent = hostUiState.questionPoolUnavailableMessage;
      unavailablePanelNode.append(unavailableCopyNode);
      questionListNode.append(unavailablePanelNode);
      return;
    }

    if (hostUiState.questionPool.counts.total === 0) {
      const emptyPanelNode = document.createElement("div");
      const emptyCopyNode = document.createElement("p");

      emptyPanelNode.className = "hub-panel trivia-empty-panel";
      emptyCopyNode.textContent = "No Trivia questions have been uploaded yet.";
      emptyPanelNode.append(emptyCopyNode);
      questionListNode.append(emptyPanelNode);
      return;
    }

    const filteredQuestions = getFilteredQuestions();

    if (filteredQuestions.length === 0) {
      const filterEmptyPanelNode = document.createElement("div");
      const filterEmptyCopyNode = document.createElement("p");

      filterEmptyPanelNode.className = "hub-panel trivia-empty-panel";
      filterEmptyCopyNode.textContent = `No ${hostUiState.activeDifficultyFilter} questions are in the current pool.`;
      filterEmptyPanelNode.append(filterEmptyCopyNode);
      questionListNode.append(filterEmptyPanelNode);
      return;
    }

    filteredQuestions.forEach((question) => {
      questionListNode.append(createTriviaQuestionCard(question, {
        showSelectAction: true,
        isSelected: hostUiState.selectedQuestionId === question.id,
        selectActionLabel: hostUiState.selectedQuestionId === question.id
          ? "Selected for Push"
          : "Select Question",
      }));
    });
  }

  function renderRandomPreview(previewNode) {
    if (!previewNode) {
      return;
    }

    previewNode.innerHTML = "";

    const previewQuestion = getRandomPreviewQuestion();

    if (!previewQuestion) {
      if (hostUiState.questionPool.counts.total > 0) {
        const helperNode = document.createElement("div");

        helperNode.className = "hub-panel trivia-random-panel";
        helperNode.textContent = "Use a Random Difficulty button to locally preview one question without changing Firebase, Players, or Display.";
        previewNode.append(helperNode);
      }

      return;
    }

    const previewPanelNode = document.createElement("section");
    const previewHeadingNode = document.createElement("div");
    const eyebrowNode = document.createElement("p");
    const titleNode = document.createElement("h4");

    previewPanelNode.className = "trivia-random-panel";
    previewHeadingNode.className = "player-section-header";
    eyebrowNode.className = "eyebrow";
    eyebrowNode.textContent = "Random Preview";
    titleNode.textContent = "Local Host Preview";
    previewHeadingNode.append(eyebrowNode, titleNode);
    previewPanelNode.append(previewHeadingNode, createTriviaQuestionCard(previewQuestion, { showHeading: false }));
    previewNode.append(previewPanelNode);
  }

  function renderControllerNotices(noticesNode) {
    if (!noticesNode) {
      return;
    }

    noticesNode.innerHTML = "";

    if (hostUiState.controllerMessage.text) {
      noticesNode.append(createNoticeNode(hostUiState.controllerMessage.text, hostUiState.controllerMessage.tone));
    }

    if (hostUiState.isCurrentRoundLoading && !hostUiState.hasLoadedCurrentRound) {
      noticesNode.append(createNoticeNode("Loading the current Live Trivia round...", "info"));
    } else if (hostUiState.currentRoundUnavailableMessage && !hostUiState.hasLoadedCurrentRound) {
      noticesNode.append(createNoticeNode(hostUiState.currentRoundUnavailableMessage, "warning"));
    } else if (hostUiState.currentRoundWarning) {
      noticesNode.append(createNoticeNode(hostUiState.currentRoundWarning, "warning"));
    }

    if (hostUiState.answersUnavailableMessage && !hostUiState.hasLoadedAnswerStats) {
      noticesNode.append(createNoticeNode(hostUiState.answersUnavailableMessage, "warning"));
    } else if (hostUiState.answersWarning) {
      noticesNode.append(createNoticeNode(hostUiState.answersWarning, "warning"));
    }
  }

  function renderSelectedQuestionPreview(previewNode) {
    if (!previewNode) {
      return;
    }

    previewNode.innerHTML = "";

    const selectedQuestion = getSelectedQuestion();
    const selectedPanelNode = document.createElement("div");
    const headerNode = document.createElement("div");
    const eyebrowNode = document.createElement("p");
    const titleNode = document.createElement("h4");

    selectedPanelNode.className = "trivia-selection-summary";
    headerNode.className = "player-section-header";
    eyebrowNode.className = "eyebrow";
    eyebrowNode.textContent = "Selected Question";
    titleNode.textContent = selectedQuestion ? "Ready to Push" : "No Question Selected";
    headerNode.append(eyebrowNode, titleNode);
    selectedPanelNode.append(headerNode);

    if (!selectedQuestion) {
      const helperCopyNode = document.createElement("p");

      helperCopyNode.className = "player-copy";
      helperCopyNode.textContent = "Choose one question from the saved pool before pushing a Live Trivia round.";
      selectedPanelNode.append(helperCopyNode);
      previewNode.append(selectedPanelNode);
      return;
    }

    selectedPanelNode.append(createTriviaQuestionCard(selectedQuestion, { showHeading: false }));
    previewNode.append(selectedPanelNode);
  }

  function renderActionButtons(actionsNode) {
    if (!actionsNode) {
      return;
    }

    const selectedQuestion = getSelectedQuestion();
    const cannotUseLiveRound = !hostUiState.hasLoadedCurrentRound;

    actionsNode.innerHTML = `
      <button
        type="button"
        class="primary-button"
        data-action="push-live-trivia"
        ${hostUiState.isRoundActionBusy || !selectedQuestion || cannotUseLiveRound ? "disabled" : ""}
      >
        Push Selected Question
      </button>
      <button
        type="button"
        class="secondary-button"
        data-action="lock-live-trivia"
        ${hostUiState.isRoundActionBusy || !canLockTriviaRound(hostUiState.currentRound) ? "disabled" : ""}
      >
        Lock Answers
      </button>
      <button
        type="button"
        class="secondary-button"
        data-action="reveal-live-trivia"
        ${hostUiState.isRoundActionBusy || !canRevealTriviaRound(hostUiState.currentRound) ? "disabled" : ""}
      >
        Reveal Answer
      </button>
      <button
        type="button"
        class="secondary-button"
        data-action="end-live-trivia"
        ${hostUiState.isRoundActionBusy || !canEndTriviaRound(hostUiState.currentRound) ? "disabled" : ""}
      >
        End / Clear Round
      </button>
    `;
  }

  function renderCurrentRoundPanel(roundNode) {
    if (!roundNode) {
      return;
    }

    roundNode.innerHTML = "";

    const roundPanelNode = document.createElement("section");
    const headerNode = document.createElement("div");
    const eyebrowNode = document.createElement("p");
    const titleNode = document.createElement("h4");
    const statusBadgeNode = document.createElement("span");

    roundPanelNode.className = "trivia-round-summary";
    headerNode.className = "trivia-status-row";
    eyebrowNode.className = "eyebrow";
    eyebrowNode.textContent = "Current Round";
    titleNode.textContent = hasActiveTriviaRound(hostUiState.currentRound)
      ? hostUiState.currentRound.questionId
      : "No Live Trivia Round";
    statusBadgeNode.className = "trivia-status-badge";
    statusBadgeNode.dataset.triviaStatus = hostUiState.currentRound.status;
    statusBadgeNode.textContent = getTriviaRoundStatusLabel(hostUiState.currentRound.status);

    const titleWrapNode = document.createElement("div");

    titleWrapNode.append(eyebrowNode, titleNode);
    headerNode.append(titleWrapNode, statusBadgeNode);
    roundPanelNode.append(headerNode);

    if (!hasActiveTriviaRound(hostUiState.currentRound)) {
      const helperCopyNode = document.createElement("p");

      helperCopyNode.className = "player-copy";
      helperCopyNode.textContent = "No Live Trivia round is active right now. Select a saved question and push it when you are ready.";
      roundPanelNode.append(helperCopyNode);
      roundNode.append(roundPanelNode);
      return;
    }

    roundPanelNode.append(
      createTriviaQuestionMetaRow("Round ID", hostUiState.currentRound.roundId),
      createTriviaQuestionMetaRow("Pushed", formatUpdatedAt(hostUiState.currentRound.pushedAt))
    );

    if (hostUiState.currentRound.lockedAt) {
      roundPanelNode.append(createTriviaQuestionMetaRow("Locked", formatUpdatedAt(hostUiState.currentRound.lockedAt)));
    }

    if (hostUiState.currentRound.revealedAt) {
      roundPanelNode.append(createTriviaQuestionMetaRow("Revealed", formatUpdatedAt(hostUiState.currentRound.revealedAt)));
    }

    roundPanelNode.append(createTriviaQuestionCard(createRoundSnapshotQuestion(hostUiState.currentRound), { showHeading: false }));
    roundNode.append(roundPanelNode);
  }

  function renderAnswerStats(statsNode) {
    if (!statsNode) {
      return;
    }

    statsNode.innerHTML = "";

    const statsPanelNode = document.createElement("section");
    const headerNode = document.createElement("div");
    const eyebrowNode = document.createElement("p");
    const titleNode = document.createElement("h4");

    statsPanelNode.className = "host-trivia-live-section host-trivia-answer-stats";
    headerNode.className = "host-section-heading";
    eyebrowNode.className = "eyebrow";
    eyebrowNode.textContent = "Live Answers";
    titleNode.textContent = "Realtime Totals";
    headerNode.append(eyebrowNode, titleNode);
    statsPanelNode.append(headerNode);

    if (!hasActiveTriviaRound(hostUiState.currentRound)) {
      const helperCopyNode = document.createElement("p");

      helperCopyNode.className = "player-copy";
      helperCopyNode.textContent = "Push a question to begin counting live player answers.";
      statsPanelNode.append(helperCopyNode);
      statsNode.append(statsPanelNode);
      return;
    }

    if (hostUiState.isAnswerStatsLoading && !hostUiState.hasLoadedAnswerStats) {
      const loadingCopyNode = document.createElement("p");

      loadingCopyNode.className = "player-copy";
      loadingCopyNode.textContent = "Waiting for the first answer totals for this round...";
      statsPanelNode.append(loadingCopyNode);
      statsNode.append(statsPanelNode);
      return;
    }

    const summaryNode = document.createElement("p");

    summaryNode.className = "host-trivia-answer-strip";
    summaryNode.innerHTML = `<strong>Submitted:</strong> ${escapeHtml(String(hostUiState.answerStats.totalSubmitted))}`;
    statsPanelNode.append(summaryNode);

    const optionStatsGridNode = document.createElement("div");

    optionStatsGridNode.className = "trivia-stats-grid";
    hostUiState.answerStats.optionStats.forEach((optionStat) => {
      const optionCardNode = document.createElement("article");
      const optionLabelNode = document.createElement("h5");
      const optionCountNode = document.createElement("strong");
      const optionMetaNode = document.createElement("p");

      optionCardNode.className = "trivia-stat-card";
      optionCardNode.dataset.correct = optionStat.isCorrect ? "true" : "false";
      optionLabelNode.textContent = `Choice ${optionStat.index + 1}`;
      optionCountNode.textContent = `${optionStat.count} (${optionStat.percentage}%)`;
      optionMetaNode.className = "trivia-question-meta";
      optionMetaNode.textContent = optionStat.label;
      optionCardNode.append(optionLabelNode, optionCountNode, optionMetaNode);

      if (optionStat.isCorrect) {
        const correctNoteNode = document.createElement("p");

        correctNoteNode.className = "trivia-answer-note";
        correctNoteNode.textContent = "Correct answer";
        optionCardNode.append(correctNoteNode);
      }

      optionStatsGridNode.append(optionCardNode);
    });

    statsPanelNode.append(optionStatsGridNode);
    statsNode.append(statsPanelNode);
  }

  function createBingoActionButton({
    action,
    label,
    buttonClass = "secondary-button",
    disabled = false,
  }) {
    const buttonNode = document.createElement("button");

    buttonNode.type = "button";
    buttonNode.className = buttonClass;
    buttonNode.dataset.action = action;
    buttonNode.disabled = disabled;
    buttonNode.textContent = label;
    return buttonNode;
  }

  function formatCompletedBingoLines(completedLines) {
    if (!Array.isArray(completedLines) || completedLines.length === 0) {
      return "None yet";
    }

    return completedLines.map((lineKey) => getBingoLineLabel(lineKey)).join(", ");
  }

  function renderBingoPreparationNotices(noticesNode) {
    if (!noticesNode) {
      return;
    }

    noticesNode.innerHTML = "";

    if (hostUiState.bingoPreparationMessage.text) {
      noticesNode.append(createNoticeNode(hostUiState.bingoPreparationMessage.text, hostUiState.bingoPreparationMessage.tone));
    }

    if (hostUiState.isBingoSourcePoolLoading && !hostUiState.hasLoadedBingoSourcePool) {
      noticesNode.append(createNoticeNode("Loading the Bingo bottle pool...", "info"));
    } else if (hostUiState.bingoSourcePoolUnavailableMessage && !hostUiState.hasLoadedBingoSourcePool) {
      noticesNode.append(createNoticeNode(hostUiState.bingoSourcePoolUnavailableMessage, "warning"));
    } else if (hostUiState.bingoSourcePoolWarning) {
      noticesNode.append(createNoticeNode(hostUiState.bingoSourcePoolWarning, "warning"));
    }

    if (hostUiState.isRegisteredPlayersLoading && !hostUiState.hasLoadedRegisteredPlayers) {
      noticesNode.append(createNoticeNode("Loading the current registered player count...", "info"));
    } else if (hostUiState.registeredPlayersUnavailableMessage && !hostUiState.hasLoadedRegisteredPlayers) {
      noticesNode.append(createNoticeNode(hostUiState.registeredPlayersUnavailableMessage, "warning"));
    } else if (hostUiState.registeredPlayersWarning) {
      noticesNode.append(createNoticeNode(hostUiState.registeredPlayersWarning, "warning"));
    }

    if (hostUiState.isBingoCurrentRoundLoading && !hostUiState.hasLoadedBingoCurrentRound) {
      noticesNode.append(createNoticeNode("Loading the current Bingo round...", "info"));
    } else if (hostUiState.bingoCurrentRoundUnavailableMessage && !hostUiState.hasLoadedBingoCurrentRound) {
      noticesNode.append(createNoticeNode(hostUiState.bingoCurrentRoundUnavailableMessage, "warning"));
    } else if (hostUiState.bingoCurrentRoundWarning) {
      noticesNode.append(createNoticeNode(hostUiState.bingoCurrentRoundWarning, "warning"));
    }

    if (hasPreparedBingoRound(hostUiState.bingoCurrentRound)) {
      if (hostUiState.isBingoCardsLoading && !hostUiState.hasLoadedBingoCards) {
        noticesNode.append(createNoticeNode("Loading current-round Bingo cards...", "info"));
      } else if (hostUiState.bingoCardsUnavailableMessage && !hostUiState.hasLoadedBingoCards) {
        noticesNode.append(createNoticeNode(hostUiState.bingoCardsUnavailableMessage, "warning"));
      } else if (hostUiState.bingoCardsWarning) {
        noticesNode.append(createNoticeNode(hostUiState.bingoCardsWarning, "warning"));
      }

      if (hostUiState.isBingoDrawsLoading && !hostUiState.hasLoadedBingoDraws) {
        noticesNode.append(createNoticeNode("Loading current-round Bingo draws...", "info"));
      } else if (hostUiState.bingoDrawsUnavailableMessage && !hostUiState.hasLoadedBingoDraws) {
        noticesNode.append(createNoticeNode(hostUiState.bingoDrawsUnavailableMessage, "warning"));
      } else if (hostUiState.bingoDrawsWarning) {
        noticesNode.append(createNoticeNode(hostUiState.bingoDrawsWarning, "warning"));
      }

      if (hostUiState.isBingoWinnersLoading && !hostUiState.hasLoadedBingoWinners) {
        noticesNode.append(createNoticeNode("Loading current-round Bingo winners...", "info"));
      } else if (hostUiState.bingoWinnersUnavailableMessage && !hostUiState.hasLoadedBingoWinners) {
        noticesNode.append(createNoticeNode(hostUiState.bingoWinnersUnavailableMessage, "warning"));
      } else if (hostUiState.bingoWinnersWarning) {
        noticesNode.append(createNoticeNode(hostUiState.bingoWinnersWarning, "warning"));
      }

      if (hostUiState.bingoStats.cardErrors.length > 0) {
        noticesNode.append(createNoticeNode("Some malformed Bingo cards were ignored in host statistics.", "warning"));
      }

      if (hostUiState.bingoStats.drawErrors.length > 0) {
        noticesNode.append(createNoticeNode("Some malformed Bingo draw records were ignored in host statistics.", "warning"));
      }

      if (hostUiState.bingoStats.winnerErrors.length > 0) {
        noticesNode.append(createNoticeNode("Some malformed persisted winner records were ignored.", "warning"));
      }

      if (hostUiState.bingoWinnerPersistenceWarning) {
        noticesNode.append(createNoticeNode(hostUiState.bingoWinnerPersistenceWarning, "warning"));
      }
    }

    if (hostUiState.hasLoadedBingoSourcePool) {
      const sourcePoolCount = hostUiState.bingoSourcePool.count;
      const targetPoolSize = getCurrentBingoTargetPoolSize();

      if (sourcePoolCount === 0) {
        noticesNode.append(createNoticeNode("No Bingo bottle pool has been uploaded yet.", "warning"));
      } else if (sourcePoolCount < BINGO_CARD_ITEM_COUNT) {
        noticesNode.append(createNoticeNode(`At least ${BINGO_CARD_ITEM_COUNT} unique Bingo items are required before a round can be prepared.`, "warning"));
      } else if (sourcePoolCount < targetPoolSize) {
        noticesNode.append(createNoticeNode(`The current Bingo pool has ${sourcePoolCount} items and cannot meet the current target of ${targetPoolSize}. Preparing a round will use all available items.`, "warning"));
      } else if (sourcePoolCount < BINGO_RECOMMENDED_MINIMUM_POOL_SIZE) {
        noticesNode.append(createNoticeNode(hostUiState.bingoSourcePool.warning, "warning"));
      }
    }
  }

  function renderBingoPreparationCounts(countsNode) {
    if (!countsNode) {
      return;
    }

    countsNode.innerHTML = "";

    const countDefinitions = [
      { label: "Registered Players", value: hostUiState.registeredPlayerCount },
      { label: "Source Pool", value: hostUiState.bingoSourcePool.count },
      { label: "Target Pool", value: getCurrentBingoTargetPoolSize() },
      {
        label: "Can Meet Target",
        value: hostUiState.bingoSourcePool.count >= getCurrentBingoTargetPoolSize() ? "Yes" : "No",
      },
    ];

    if (hasPreparedBingoRound(hostUiState.bingoCurrentRound)) {
      countDefinitions.push(
        { label: "Active Cards", value: hostUiState.bingoStats.activeCardCount },
        { label: "Draw Count", value: hostUiState.bingoStats.drawCount },
        { label: "Remaining Items", value: hostUiState.bingoStats.remainingUndrawnItems },
        { label: "Line Winners", value: hostUiState.bingoStats.lineWinnerCount },
        { label: "Blackout Winners", value: hostUiState.bingoStats.blackoutWinnerCount }
      );
    }

    countDefinitions.forEach((countDefinition) => {
      countsNode.append(createSummaryCountCard(countDefinition));
    });
  }

  function renderBingoCurrentRoundPanel(roundNode) {
    if (!roundNode) {
      return;
    }

    roundNode.innerHTML = "";

    const roundPanelNode = document.createElement("section");
    const headerNode = document.createElement("div");
    const eyebrowNode = document.createElement("p");
    const titleNode = document.createElement("h4");
    const statusBadgeNode = document.createElement("span");
    const titleWrapNode = document.createElement("div");

    roundPanelNode.className = "trivia-round-summary";
    headerNode.className = "trivia-status-row";
    eyebrowNode.className = "eyebrow";
    eyebrowNode.textContent = "Current Bingo Round";
    titleNode.textContent = hasPreparedBingoRound(hostUiState.bingoCurrentRound)
      ? hostUiState.bingoCurrentRound.roundId
      : "No Bingo Round Prepared";
    statusBadgeNode.className = "trivia-status-badge";
    statusBadgeNode.dataset.bingoStatus = hostUiState.bingoCurrentRound.status;
    statusBadgeNode.textContent = getBingoRoundStatusLabel(hostUiState.bingoCurrentRound.status);
    titleWrapNode.append(eyebrowNode, titleNode);
    headerNode.append(titleWrapNode, statusBadgeNode);
    roundPanelNode.append(headerNode);

    if (!hasPreparedBingoRound(hostUiState.bingoCurrentRound)) {
      const helperCopyNode = document.createElement("p");

      helperCopyNode.className = "player-copy";
      helperCopyNode.textContent = "No Bingo card round is prepared right now. Upload a Bingo pool in Admin, then prepare a shared card round here when you are ready.";
      roundPanelNode.append(helperCopyNode);
      roundNode.append(roundPanelNode);
      return;
    }

    const currentRound = hostUiState.bingoCurrentRound;
    const lastDraw = hostUiState.bingoStats.lastDraw;

    roundPanelNode.append(
      createTriviaQuestionMetaRow("Prepared", formatUpdatedAt(currentRound.preparedAt)),
      createTriviaQuestionMetaRow("Player Count", String(currentRound.playerCountAtPreparation)),
      createTriviaQuestionMetaRow("Target Pool Size", String(currentRound.targetPoolSize)),
      createTriviaQuestionMetaRow("Actual Pool Size", String(currentRound.actualPoolSize)),
      createTriviaQuestionMetaRow("Cards Locked", currentRound.cardsLocked ? "Yes" : "No"),
      createTriviaQuestionMetaRow("Cards Locked At", formatUpdatedAt(currentRound.cardsLockedAt)),
      createTriviaQuestionMetaRow("Started At", formatUpdatedAt(currentRound.startedAt)),
      createTriviaQuestionMetaRow("Ended At", formatUpdatedAt(currentRound.endedAt)),
      createTriviaQuestionMetaRow("Draw Count", String(hostUiState.bingoStats.drawCount)),
      createTriviaQuestionMetaRow(
        "Last Draw",
        lastDraw
          ? `${lastDraw.sequence}. ${lastDraw.name} (${lastDraw.method})`
          : "No items have been drawn yet."
      )
    );

    roundNode.append(roundPanelNode);
  }

  function renderBingoPreparationActions(actionsNode) {
    if (!actionsNode) {
      return;
    }

    actionsNode.innerHTML = "";

    const currentRound = hostUiState.bingoCurrentRound;
    const isBusy = hostUiState.isPreparingBingoRound || hostUiState.isBingoActionBusy;
    const hasPreparedRound = hasPreparedBingoRound(currentRound);
    const undrawnItems = hasPreparedRound
      ? hostUiState.bingoStats.undrawnItems
      : [];
    const manualDrawSelectNode = document.createElement("select");
    const prepareButton = createBingoActionButton({
      action: "prepare-bingo-round",
      label: hostUiState.isPreparingBingoRound
        ? "Preparing Bingo Round..."
        : "Prepare New Bingo Card Round",
      buttonClass: "primary-button",
      disabled: hostUiState.isPreparingBingoRound
        || hostUiState.isBingoActionBusy
        || !hostUiState.hasLoadedBingoSourcePool
        || !hostUiState.hasLoadedRegisteredPlayers
        || !hostUiState.hasLoadedBingoCurrentRound,
    });

    actionsNode.append(prepareButton);

    actionsNode.append(
      createBingoActionButton({
        action: "lock-bingo-cards",
        label: hostUiState.isBingoActionBusy ? "Working..." : "Lock Cards",
        disabled: !canLockBingoRound(currentRound) || isBusy,
      }),
      createBingoActionButton({
        action: "start-bingo-round",
        label: hostUiState.isBingoActionBusy ? "Working..." : "Start Round",
        disabled: !canStartBingoRound(currentRound) || isBusy,
      }),
      createBingoActionButton({
        action: "draw-next-bingo-item",
        label: hostUiState.isBingoActionBusy ? "Drawing..." : "Draw Next Item",
        disabled: !canDrawBingoRound(currentRound) || undrawnItems.length === 0 || isBusy,
      })
    );

    manualDrawSelectNode.id = "host-bingo-manual-draw-select";
    manualDrawSelectNode.className = "form-input";
    manualDrawSelectNode.disabled = !canDrawBingoRound(currentRound) || undrawnItems.length === 0 || isBusy;

    const placeholderOptionNode = document.createElement("option");

    placeholderOptionNode.value = "";
    placeholderOptionNode.textContent = undrawnItems.length > 0
      ? "Select an undrawn item"
      : "No undrawn items remain";
    placeholderOptionNode.selected = true;
    placeholderOptionNode.disabled = true;
    manualDrawSelectNode.append(placeholderOptionNode);

    undrawnItems.forEach((itemValue) => {
      const optionNode = document.createElement("option");

      optionNode.value = itemValue.id;
      optionNode.textContent = itemValue.name;
      manualDrawSelectNode.append(optionNode);
    });

    actionsNode.append(manualDrawSelectNode);
    actionsNode.append(
      createBingoActionButton({
        action: "draw-selected-bingo-item",
        label: hostUiState.isBingoActionBusy ? "Drawing..." : "Draw Selected Item",
        disabled: !canDrawBingoRound(currentRound) || undrawnItems.length === 0 || isBusy,
      }),
      createBingoActionButton({
        action: "end-bingo-round",
        label: hostUiState.isBingoActionBusy ? "Working..." : "End Round",
        disabled: !canEndBingoRound(currentRound) || isBusy,
      }),
      createBingoActionButton({
        action: "clear-bingo-round",
        label: hostUiState.isBingoActionBusy ? "Working..." : "Clear / Reset Current Bingo",
        disabled: !canClearBingoRound(currentRound) || isBusy,
      })
    );
  }

  function renderBingoMatchDistribution(distributionNode) {
    if (!distributionNode) {
      return;
    }

    distributionNode.innerHTML = "";

    const panelNode = document.createElement("section");
    const headerNode = document.createElement("div");
    const eyebrowNode = document.createElement("p");
    const titleNode = document.createElement("h4");
    const countsGridNode = document.createElement("div");

    panelNode.className = "hub-panel";
    headerNode.className = "player-section-header";
    eyebrowNode.className = "eyebrow";
    eyebrowNode.textContent = "Live Bingo Stats";
    titleNode.textContent = "Match Distribution";
    countsGridNode.className = "trivia-count-grid";
    headerNode.append(eyebrowNode, titleNode);
    panelNode.append(headerNode, countsGridNode);

    hostUiState.bingoStats.distribution.forEach((distributionEntry) => {
      countsGridNode.append(createSummaryCountCard({
        label: distributionEntry.label,
        value: distributionEntry.count,
      }));
    });

    distributionNode.append(panelNode);
  }

  function renderBingoDrawHistory(drawHistoryNode) {
    if (!drawHistoryNode) {
      return;
    }

    drawHistoryNode.innerHTML = "";

    const panelNode = document.createElement("section");
    const headerNode = document.createElement("div");
    const eyebrowNode = document.createElement("p");
    const titleNode = document.createElement("h4");

    panelNode.className = "hub-panel";
    headerNode.className = "player-section-header";
    eyebrowNode.className = "eyebrow";
    eyebrowNode.textContent = "Live Bingo Stats";
    titleNode.textContent = "Recent Draws";
    headerNode.append(eyebrowNode, titleNode);
    panelNode.append(headerNode);

    if (hostUiState.bingoStats.orderedDraws.length === 0) {
      const emptyCopyNode = document.createElement("p");

      emptyCopyNode.className = "player-copy";
      emptyCopyNode.textContent = "No Bingo items have been drawn yet.";
      panelNode.append(emptyCopyNode);
      drawHistoryNode.append(panelNode);
      return;
    }

    hostUiState.bingoStats.orderedDraws
      .slice()
      .sort((leftDraw, rightDraw) => rightDraw.sequence - leftDraw.sequence)
      .slice(0, 10)
      .forEach((drawRecord) => {
        panelNode.append(
          createTriviaQuestionMetaRow(
            `${drawRecord.sequence}`,
            `${drawRecord.name} (${drawRecord.method}) at ${formatUpdatedAt(drawRecord.drawnAt)}`
          )
        );
      });

    drawHistoryNode.append(panelNode);
  }

  function renderBingoWinnerList(winnersNode) {
    if (!winnersNode) {
      return;
    }

    winnersNode.innerHTML = "";

    const panelNode = document.createElement("section");
    const headerNode = document.createElement("div");
    const eyebrowNode = document.createElement("p");
    const titleNode = document.createElement("h4");

    panelNode.className = "hub-panel";
    headerNode.className = "player-section-header";
    eyebrowNode.className = "eyebrow";
    eyebrowNode.textContent = "Live Bingo Stats";
    titleNode.textContent = "Detected Winners";
    headerNode.append(eyebrowNode, titleNode);
    panelNode.append(headerNode);

    const winnerRows = hostUiState.bingoStats.winnerRows.filter(
      (winnerRow) => winnerRow.blackoutWinner === true || winnerRow.lineWinner === true
    );

    if (winnerRows.length === 0) {
      const emptyCopyNode = document.createElement("p");

      emptyCopyNode.className = "player-copy";
      emptyCopyNode.textContent = "No Bingo winners detected yet.";
      panelNode.append(emptyCopyNode);
      winnersNode.append(panelNode);
      return;
    }

    winnerRows.forEach((winnerRow) => {
      if (winnerRow.blackoutWinner !== true && winnerRow.lineWinner !== true) {
        return;
      }

      const winnerCardNode = document.createElement("article");
      const titleWrapNode = document.createElement("div");
      const winnerTitleNode = document.createElement("h4");
      const winnerBadgeNode = document.createElement("span");

      winnerCardNode.className = "trivia-question-card";
      titleWrapNode.className = "trivia-question-header";
      winnerTitleNode.textContent = winnerRow.playerName || winnerRow.playerId;
      winnerBadgeNode.className = "trivia-status-badge";
      winnerBadgeNode.dataset.bingoStatus = winnerRow.blackoutWinner === true
        ? BINGO_ROUND_STATUS_ENDED
        : BINGO_ROUND_STATUS_IN_PROGRESS;
      winnerBadgeNode.textContent = winnerRow.blackoutWinner === true
        ? "Blackout Winner"
        : "Line Winner";
      titleWrapNode.append(winnerTitleNode, winnerBadgeNode);
      winnerCardNode.append(
        titleWrapNode,
        createTriviaQuestionMetaRow("Player ID", winnerRow.playerId),
        createTriviaQuestionMetaRow("Match Count", `${winnerRow.matchCount}/${BINGO_CARD_ITEM_COUNT}`),
        createTriviaQuestionMetaRow("Completed Lines", formatCompletedBingoLines(winnerRow.completedLines)),
        createTriviaQuestionMetaRow("First Line At", formatUpdatedAt(winnerRow.firstLineAt)),
        createTriviaQuestionMetaRow("Blackout At", formatUpdatedAt(winnerRow.blackoutAt))
      );
      panelNode.append(winnerCardNode);
    });

    winnersNode.append(panelNode);
  }

  function createHostSectionHeading({ eyebrow, title, description = "" }) {
    const headingNode = document.createElement("div");
    const eyebrowNode = document.createElement("p");
    const titleNode = document.createElement("h3");

    headingNode.className = "host-section-heading";
    eyebrowNode.className = "eyebrow";
    eyebrowNode.textContent = eyebrow;
    titleNode.textContent = title;
    headingNode.append(eyebrowNode, titleNode);

    if (description) {
      const descriptionNode = document.createElement("p");

      descriptionNode.className = "player-copy";
      descriptionNode.textContent = description;
      headingNode.append(descriptionNode);
    }

    return headingNode;
  }

  function renderDisplayNotices(noticesNode) {
    if (!noticesNode) {
      return;
    }

    noticesNode.innerHTML = "";

    if (hostUiState.displayActionMessage.text) {
      noticesNode.append(createNoticeNode(hostUiState.displayActionMessage.text, hostUiState.displayActionMessage.tone));
    }

    if (hostUiState.isDisplayStateLoading && !hostUiState.hasLoadedDisplayState) {
      noticesNode.append(createNoticeNode("Loading the current Display state...", "info"));
      return;
    }

    if (hostUiState.displayUnavailableMessage && !hostUiState.hasLoadedDisplayState) {
      noticesNode.append(createNoticeNode(hostUiState.displayUnavailableMessage, "warning"));
      return;
    }

    if (hostUiState.displayWarning) {
      noticesNode.append(createNoticeNode(hostUiState.displayWarning, "warning"));
    }
  }

  function getDisplayModeSummary() {
    const currentDisplayState = hostUiState.displayState;
    const currentMode = normalizeTextInput(currentDisplayState.mode);

    if (currentMode === DISPLAY_MODE_ANNOUNCEMENT) {
      return {
        title: getDisplayMessageTitle(currentDisplayState.announcement, "Saved Announcement"),
        summary: currentDisplayState.announcement.message || "No announcement text has been saved yet.",
        source: "Saved message",
      };
    }

    if (currentMode === DISPLAY_MODE_WINNER) {
      return {
        title: getDisplayMessageTitle(currentDisplayState.winner, "Saved Winner Message"),
        summary: currentDisplayState.winner.message || "No winner message has been saved yet.",
        source: "Saved message",
      };
    }

    if (currentMode === DISPLAY_MODE_TRIVIA) {
      return {
        title: "Trivia Question Live",
        summary: "The public display is following the active Trivia question.",
        source: "Live game",
      };
    }

    if (currentMode === DISPLAY_MODE_TRIVIA_REVEAL) {
      return {
        title: "Trivia Reveal Live",
        summary: "The public display is showing the current Trivia reveal.",
        source: "Live game",
      };
    }

    if (currentMode === DISPLAY_MODE_BINGO) {
      return {
        title: "Bingo Board Live",
        summary: "The public display is following the active Bingo round.",
        source: "Live game",
      };
    }

    return {
      title: "Waiting Screen",
      summary: currentDisplayState.statusMessage || getWaitingStatusFallback(getEventConfig()),
      source: "Saved message",
    };
  }

  function renderDisplayStatus(statusNode) {
    if (!statusNode) {
      return;
    }

    statusNode.innerHTML = "";

    const summaryDefinition = getDisplayModeSummary();
    const panelNode = document.createElement("section");
    const countsGridNode = document.createElement("div");
    const copyNode = document.createElement("p");

    panelNode.className = "hub-panel host-operator-card";
    countsGridNode.className = "trivia-count-grid host-summary-grid";
    copyNode.className = "player-copy";
    copyNode.textContent = summaryDefinition.summary;

    countsGridNode.append(
      createSummaryCountCard({
        label: "Current Mode",
        value: formatDisplayModeLabel(hostUiState.displayState.mode),
      }),
      createSummaryCountCard({
        label: "Source",
        value: summaryDefinition.source,
      })
    );

    panelNode.append(
      createHostSectionHeading({
        eyebrow: "Send to Display",
        title: summaryDefinition.title,
      }),
      countsGridNode,
      copyNode
    );

    statusNode.append(panelNode);
  }

  function renderDisplayQuickModes(buttonsNode) {
    if (!buttonsNode) {
      return;
    }

    const isBusy = hostUiState.isDisplayActionBusy;
    const canSwitchToTrivia = canDisplayTriviaRound(hostUiState.currentRound);
    const canSwitchToReveal = canDisplayTriviaRevealRound(hostUiState.currentRound);

    buttonsNode.innerHTML = `
      <section class="hub-panel host-operator-card">
        ${`
          <div class="host-section-heading">
            <p class="eyebrow">Quick Modes</p>
            <h3>Display Shortcuts</h3>
          </div>
        `}
        <div class="host-quick-mode-grid" role="toolbar" aria-label="Display modes">
          ${[
            {
              mode: DISPLAY_MODE_WAITING,
              label: "Waiting",
              disabled: isBusy,
            },
            {
              mode: DISPLAY_MODE_TRIVIA,
              label: "Trivia",
              disabled: isBusy || !canSwitchToTrivia,
            },
            {
              mode: DISPLAY_MODE_TRIVIA_REVEAL,
              label: "Reveal",
              disabled: isBusy || !canSwitchToReveal,
            },
            {
              mode: DISPLAY_MODE_BINGO,
              label: "Bingo",
              disabled: isBusy,
            },
            {
              mode: DISPLAY_MODE_ANNOUNCEMENT,
              label: "Announcement",
              disabled: isBusy || !hasAnnouncementDisplayMessage(hostUiState.displayState),
            },
            {
              mode: DISPLAY_MODE_WINNER,
              label: "Winner",
              disabled: isBusy || !hasWinnerDisplayMessage(hostUiState.displayState),
            },
          ].map((buttonDefinition) => `
            <button
              type="button"
              class="hub-button host-quick-mode-button"
              data-action="switch-host-display-mode"
              data-display-mode="${buttonDefinition.mode}"
              aria-pressed="${hostUiState.displayState.mode === buttonDefinition.mode ? "true" : "false"}"
              ${buttonDefinition.disabled ? "disabled" : ""}
            >
              ${escapeHtml(buttonDefinition.label)}
            </button>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderDisplayComposer(composerNode) {
    if (!composerNode) {
      return;
    }

    const composerType = normalizeHostDisplayComposerType(hostUiState.displayComposerType);
    const composerDrafts = getDisplayComposerDrafts();
    const isWaitingComposer = composerType === DISPLAY_MODE_WAITING;
    const messageLabel = isWaitingComposer ? "Message" : "Message";

    composerNode.innerHTML = `
      <form class="hub-panel host-operator-card host-display-form" data-host-display-form novalidate>
        <div class="host-section-heading">
          <p class="eyebrow">Composer</p>
          <h3>Show on Display</h3>
          <p class="player-copy">Save the message and switch the public Display to it.</p>
        </div>
        <label class="form-field">
          <span>Message Type</span>
          <select class="form-input" data-host-display-type ${hostUiState.isDisplayActionBusy ? "disabled" : ""}>
            <option value="${DISPLAY_MODE_WAITING}" ${composerType === DISPLAY_MODE_WAITING ? "selected" : ""}>Waiting</option>
            <option value="${DISPLAY_MODE_ANNOUNCEMENT}" ${composerType === DISPLAY_MODE_ANNOUNCEMENT ? "selected" : ""}>Announcement</option>
            <option value="${DISPLAY_MODE_WINNER}" ${composerType === DISPLAY_MODE_WINNER ? "selected" : ""}>Winner</option>
          </select>
        </label>
        ${isWaitingComposer ? "" : `
          <label class="form-field">
            <span>Optional Title</span>
            <input
              type="text"
              class="form-input"
              value="${escapeHtml(composerDrafts.title)}"
              data-host-display-title
              ${hostUiState.isDisplayActionBusy ? "disabled" : ""}
            >
          </label>
        `}
        <label class="form-field">
          <span>${messageLabel}</span>
          <textarea
            class="form-input form-textarea"
            rows="${isWaitingComposer ? "3" : "5"}"
            data-host-display-message
            ${hostUiState.isDisplayActionBusy ? "disabled" : ""}
          >${escapeHtml(composerDrafts.message)}</textarea>
        </label>
        <div class="host-display-form-actions">
          <button
            type="submit"
            class="primary-button"
            ${hostUiState.isDisplayActionBusy ? "disabled" : ""}
          >
            ${hostUiState.isDisplayActionBusy ? "Saving..." : "Show on Display"}
          </button>
        </div>
      </form>
    `;
  }

  function renderCompactQuestionList(questionListNode) {
    if (!questionListNode) {
      return;
    }

    questionListNode.innerHTML = "";
    const scrollPanelNode = document.createElement("div");
    scrollPanelNode.className = "host-scroll-panel host-question-scroll";

    if (hostUiState.isQuestionPoolLoading && !hostUiState.hasLoadedQuestionPool) {
      const loadingCopyNode = document.createElement("p");

      loadingCopyNode.className = "player-copy host-trivia-list-empty";
      loadingCopyNode.textContent = "Loading the current Trivia question pool...";
      questionListNode.append(loadingCopyNode);
      return;
    }

    if (hostUiState.questionPoolUnavailableMessage && !hostUiState.hasLoadedQuestionPool) {
      const unavailableCopyNode = document.createElement("p");

      unavailableCopyNode.className = "player-copy host-trivia-list-empty";
      unavailableCopyNode.textContent = hostUiState.questionPoolUnavailableMessage;
      questionListNode.append(unavailableCopyNode);
      return;
    }

    if (hostUiState.questionPool.counts.total === 0) {
      const emptyCopyNode = document.createElement("p");

      emptyCopyNode.className = "player-copy host-trivia-list-empty";
      emptyCopyNode.textContent = "No Trivia questions have been uploaded yet.";
      questionListNode.append(emptyCopyNode);
      return;
    }

    const filteredQuestions = getFilteredQuestions();

    if (filteredQuestions.length === 0) {
      const filterEmptyCopyNode = document.createElement("p");

      filterEmptyCopyNode.className = "player-copy host-trivia-list-empty";
      filterEmptyCopyNode.textContent = hostUiState.activeDifficultyFilter === "all"
        ? "No saved Trivia questions are available right now."
        : `No ${formatTriviaDifficultyLabel(hostUiState.activeDifficultyFilter).toLowerCase()} questions are in the current pool.`;
      questionListNode.append(filterEmptyCopyNode);
      return;
    }

    filteredQuestions.forEach((question) => {
      scrollPanelNode.append(createTriviaQuestionListRow(
        question,
        hostUiState.selectedQuestionId === question.id
      ));
    });

    questionListNode.append(scrollPanelNode);
  }

  function renderCompactRandomPreview(previewNode) {
    if (!previewNode) {
      return;
    }

    previewNode.innerHTML = "";

    const previewQuestion = getRandomPreviewQuestion();
    const panelNode = document.createElement("section");

    panelNode.className = "hub-panel host-operator-card host-random-preview-card";
    panelNode.append(createHostSectionHeading({
      eyebrow: "Random Preview",
      title: previewQuestion ? "Local Random Pick" : "Ready for Random Pick",
    }));

    if (!previewQuestion) {
      const helperCopyNode = document.createElement("p");

      helperCopyNode.className = "player-copy";
      helperCopyNode.textContent = "Use Random Easy, Medium, or Hard to preview one saved question locally.";
      panelNode.append(helperCopyNode);
      previewNode.append(panelNode);
      return;
    }

    panelNode.append(createTriviaQuestionCard(previewQuestion, {
      showHeading: false,
      showId: false,
    }));

    const actionsNode = document.createElement("div");
    const selectButtonNode = document.createElement("button");

    actionsNode.className = "host-random-preview-actions";
    selectButtonNode.type = "button";
    selectButtonNode.className = "primary-button";
    selectButtonNode.dataset.action = "select-random-preview-trivia";
    selectButtonNode.textContent = "Select This Question";
    actionsNode.append(selectButtonNode);
    panelNode.append(actionsNode);
    previewNode.append(panelNode);
  }

  function renderCompactSelectedQuestionPreview(previewNode) {
    if (!previewNode) {
      return;
    }

    previewNode.innerHTML = "";

    const selectedQuestion = getSelectedQuestion();
    const panelNode = document.createElement("section");

    panelNode.className = "hub-panel host-operator-card";
    panelNode.append(createHostSectionHeading({
      eyebrow: "Selected Question",
      title: selectedQuestion ? "Ready to Push" : "No Question Selected",
    }));

    if (!selectedQuestion) {
      const helperCopyNode = document.createElement("p");

      helperCopyNode.className = "player-copy";
      helperCopyNode.textContent = "Choose one saved question before pushing a new Live Trivia round.";
      panelNode.append(helperCopyNode);
      previewNode.append(panelNode);
      return;
    }

    panelNode.append(createTriviaQuestionCard(selectedQuestion, {
      showHeading: false,
      showId: false,
    }));
    previewNode.append(panelNode);
  }

  function renderCompactCurrentRound(roundNode) {
    if (!roundNode) {
      return;
    }

    roundNode.innerHTML = "";

    const panelNode = document.createElement("section");
    const headerNode = document.createElement("div");
    const titleWrapNode = document.createElement("div");
    const eyebrowNode = document.createElement("p");
    const titleNode = document.createElement("h3");
    const statusBadgeNode = document.createElement("span");

    panelNode.className = "host-trivia-live-section";
    headerNode.className = "trivia-status-row";
    eyebrowNode.className = "eyebrow";
    eyebrowNode.textContent = "Current Trivia Round";
    titleNode.textContent = hasActiveTriviaRound(hostUiState.currentRound)
      ? "Live Question"
      : "No Live Trivia Round";
    statusBadgeNode.className = "trivia-status-badge";
    statusBadgeNode.dataset.triviaStatus = hostUiState.currentRound.status;
    statusBadgeNode.textContent = getTriviaRoundStatusLabel(hostUiState.currentRound.status);
    titleWrapNode.append(eyebrowNode, titleNode);
    headerNode.append(titleWrapNode, statusBadgeNode);
    panelNode.append(headerNode);

    if (!hasActiveTriviaRound(hostUiState.currentRound)) {
      const helperCopyNode = document.createElement("p");

      helperCopyNode.className = "player-copy";
      helperCopyNode.textContent = "Select a saved question on the left, then push it live when you are ready.";
      panelNode.append(helperCopyNode);
      roundNode.append(panelNode);
      return;
    }

    const roundQuestionNode = createTriviaQuestionCard(createRoundSnapshotQuestion(hostUiState.currentRound), {
      showHeading: false,
      showId: false,
      showDifficultyMeta: false,
      showAnswer: hostUiState.currentRound.status === "revealed" || !!hostUiState.currentRound.revealedAt,
      includePanelChrome: false,
    });

    roundQuestionNode.classList.add("host-trivia-live-question");
    panelNode.append(roundQuestionNode);
    roundNode.append(panelNode);
  }

  function renderBingoOperatorCounts(countsNode) {
    if (!countsNode) {
      return;
    }

    countsNode.innerHTML = "";

    const panelNode = document.createElement("section");
    const countsGridNode = document.createElement("div");
    const hasPreparedRound = hasPreparedBingoRound(hostUiState.bingoCurrentRound);
    const countDefinitions = [
      {
        label: "Round Status",
        value: getBingoRoundStatusLabel(hostUiState.bingoCurrentRound.status),
      },
      {
        label: "Active Cards",
        value: hasPreparedRound ? hostUiState.bingoStats.activeCardCount : 0,
      },
      {
        label: "Draw Count",
        value: hasPreparedRound ? hostUiState.bingoStats.drawCount : 0,
      },
      {
        label: "Remaining",
        value: hasPreparedRound ? hostUiState.bingoStats.remainingUndrawnItems : 0,
      },
      {
        label: "Line Winners",
        value: hasPreparedRound ? hostUiState.bingoStats.lineWinnerCount : 0,
      },
      {
        label: "Blackout Winners",
        value: hasPreparedRound ? hostUiState.bingoStats.blackoutWinnerCount : 0,
      },
    ];

    panelNode.className = "hub-panel host-operator-card";
    countsGridNode.className = "trivia-count-grid host-summary-grid";
    panelNode.append(createHostSectionHeading({
      eyebrow: "Live Panel",
      title: "Bingo Round Snapshot",
    }));

    countDefinitions.forEach((countDefinition) => {
      countsGridNode.append(createSummaryCountCard(countDefinition));
    });

    panelNode.append(countsGridNode);
    countsNode.append(panelNode);
  }

  function renderBingoOperatorActions(actionsNode) {
    if (!actionsNode) {
      return;
    }

    actionsNode.innerHTML = "";

    const currentRound = hostUiState.bingoCurrentRound;
    const isBusy = hostUiState.isPreparingBingoRound || hostUiState.isBingoActionBusy;
    const hasPreparedRound = hasPreparedBingoRound(currentRound);
    const undrawnItems = hasPreparedRound ? hostUiState.bingoStats.undrawnItems : [];
    const panelNode = document.createElement("section");
    const primaryActionsNode = document.createElement("div");
    const manualRowNode = document.createElement("div");
    const manualFieldNode = document.createElement("label");
    const manualLabelNode = document.createElement("span");
    const manualDrawSelectNode = document.createElement("select");
    const roundCloseActionsNode = document.createElement("div");
    const dangerActionsNode = document.createElement("div");
    const prepareButton = createBingoActionButton({
      action: "prepare-bingo-round",
      label: hostUiState.isPreparingBingoRound ? "Preparing..." : "Prepare Round",
      buttonClass: "primary-button",
      disabled: hostUiState.isPreparingBingoRound
        || hostUiState.isBingoActionBusy
        || !hostUiState.hasLoadedBingoSourcePool
        || !hostUiState.hasLoadedRegisteredPlayers
        || !hostUiState.hasLoadedBingoCurrentRound,
    });

    panelNode.className = "hub-panel host-operator-card";
    primaryActionsNode.className = "host-action-row";
    manualRowNode.className = "host-inline-field-row";
    manualFieldNode.className = "form-field host-inline-field";
    manualLabelNode.textContent = "Manual Draw";
    manualDrawSelectNode.id = "host-bingo-manual-draw-select";
    manualDrawSelectNode.className = "form-input";
    manualDrawSelectNode.disabled = !canDrawBingoRound(currentRound) || undrawnItems.length === 0 || isBusy;
    roundCloseActionsNode.className = "host-action-row";
    dangerActionsNode.className = "host-danger-actions";

    panelNode.append(createHostSectionHeading({
      eyebrow: "Action Row",
      title: "Run the Bingo Round",
    }));

    primaryActionsNode.append(
      prepareButton,
      createBingoActionButton({
        action: "lock-bingo-cards",
        label: hostUiState.isBingoActionBusy ? "Working..." : "Lock Cards",
        disabled: !canLockBingoRound(currentRound) || isBusy,
      }),
      createBingoActionButton({
        action: "start-bingo-round",
        label: hostUiState.isBingoActionBusy ? "Working..." : "Start Round",
        disabled: !canStartBingoRound(currentRound) || isBusy,
      }),
      createBingoActionButton({
        action: "draw-next-bingo-item",
        label: hostUiState.isBingoActionBusy ? "Drawing..." : "Random Draw",
        disabled: !canDrawBingoRound(currentRound) || undrawnItems.length === 0 || isBusy,
      })
    );

    const placeholderOptionNode = document.createElement("option");

    placeholderOptionNode.value = "";
    placeholderOptionNode.textContent = undrawnItems.length > 0
      ? "Select an undrawn item"
      : "No undrawn items remain";
    placeholderOptionNode.selected = true;
    placeholderOptionNode.disabled = true;
    manualDrawSelectNode.append(placeholderOptionNode);

    undrawnItems.forEach((itemValue) => {
      const optionNode = document.createElement("option");

      optionNode.value = itemValue.id;
      optionNode.textContent = itemValue.name;
      manualDrawSelectNode.append(optionNode);
    });

    manualFieldNode.append(manualLabelNode, manualDrawSelectNode);
    manualRowNode.append(
      manualFieldNode,
      createBingoActionButton({
        action: "draw-selected-bingo-item",
        label: hostUiState.isBingoActionBusy ? "Drawing..." : "Manual Draw",
        disabled: !canDrawBingoRound(currentRound) || undrawnItems.length === 0 || isBusy,
      })
    );

    roundCloseActionsNode.append(
      createBingoActionButton({
        action: "end-bingo-round",
        label: hostUiState.isBingoActionBusy ? "Working..." : "End Round",
        disabled: !canEndBingoRound(currentRound) || isBusy,
      })
    );

    dangerActionsNode.append(
      createBingoActionButton({
        action: "clear-bingo-round",
        label: hostUiState.isBingoActionBusy ? "Working..." : "Clear / Reset Current Bingo",
        buttonClass: "secondary-button host-danger-button",
        disabled: !canClearBingoRound(currentRound) || isBusy,
      })
    );

    panelNode.append(primaryActionsNode, manualRowNode, roundCloseActionsNode, dangerActionsNode);
    actionsNode.append(panelNode);
  }

  function renderBingoLatestDraw(latestDrawNode) {
    if (!latestDrawNode) {
      return;
    }

    latestDrawNode.innerHTML = "";

    const panelNode = document.createElement("section");
    const latestDraw = hostUiState.bingoStats.lastDraw;
    const drawValueNode = document.createElement("div");
    const drawMetaNode = document.createElement("p");

    panelNode.className = "hub-panel host-operator-card host-latest-draw-panel";
    drawValueNode.className = "host-latest-draw-value";
    drawMetaNode.className = "player-copy";
    panelNode.append(createHostSectionHeading({
      eyebrow: "Latest Draw",
      title: latestDraw ? `${latestDraw.sequence}. ${latestDraw.name}` : "No Draw Yet",
    }));

    if (!latestDraw) {
      drawMetaNode.textContent = "Random Draw or Manual Draw will appear here once the round is in progress.";
      panelNode.append(drawMetaNode);
      latestDrawNode.append(panelNode);
      return;
    }

    drawValueNode.textContent = latestDraw.name;
    drawMetaNode.textContent = latestDraw.method === BINGO_DRAW_METHOD_MANUAL
      ? "Manual draw"
      : "Random draw";
    panelNode.append(drawValueNode, drawMetaNode);
    latestDrawNode.append(panelNode);
  }

  function renderBingoDrawHistoryCompact(drawHistoryNode) {
    if (!drawHistoryNode) {
      return;
    }

    drawHistoryNode.innerHTML = "";

    const panelNode = document.createElement("section");

    panelNode.className = "hub-panel host-operator-card";
    panelNode.append(createHostSectionHeading({
      eyebrow: "Recent Draws",
      title: "Draw History",
    }));

    if (hostUiState.bingoStats.orderedDraws.length === 0) {
      const emptyCopyNode = document.createElement("p");

      emptyCopyNode.className = "player-copy";
      emptyCopyNode.textContent = "No Bingo items have been drawn yet.";
      panelNode.append(emptyCopyNode);
      drawHistoryNode.append(panelNode);
      return;
    }

    const listNode = document.createElement("ol");
    const scrollPanelNode = document.createElement("div");

    listNode.className = "host-draw-list";
    scrollPanelNode.className = "host-scroll-panel";

    hostUiState.bingoStats.orderedDraws
      .slice()
      .sort((leftDraw, rightDraw) => rightDraw.sequence - leftDraw.sequence)
      .slice(0, 12)
      .forEach((drawRecord) => {
        const listItemNode = document.createElement("li");
        const sequenceNode = document.createElement("span");
        const nameNode = document.createElement("span");
        const methodNode = document.createElement("span");

        listItemNode.className = "host-draw-list__item";
        sequenceNode.className = "host-draw-list__sequence";
        nameNode.className = "host-draw-list__name";
        methodNode.className = "host-draw-list__method";
        sequenceNode.textContent = `${drawRecord.sequence}.`;
        nameNode.textContent = drawRecord.name;
        methodNode.textContent = drawRecord.method === BINGO_DRAW_METHOD_MANUAL ? "Manual" : "Random";
        listItemNode.append(sequenceNode, nameNode, methodNode);
        listNode.append(listItemNode);
      });

    scrollPanelNode.append(listNode);
    panelNode.append(scrollPanelNode);
    drawHistoryNode.append(panelNode);
  }

  function renderBingoWinnerTable(winnersNode) {
    if (!winnersNode) {
      return;
    }

    winnersNode.innerHTML = "";

    const panelNode = document.createElement("section");
    const winnerRows = hostUiState.bingoStats.winnerRows.filter(
      (winnerRow) => winnerRow.blackoutWinner === true || winnerRow.lineWinner === true
    );

    panelNode.className = "hub-panel host-operator-card";
    panelNode.append(createHostSectionHeading({
      eyebrow: "Players' Vault Awards",
      title: "Award Progress",
    }));

    if (winnerRows.length === 0) {
      const emptyCopyNode = document.createElement("p");

      emptyCopyNode.className = "player-copy";
      emptyCopyNode.textContent = "No Players' Vault awards yet.";
      panelNode.append(emptyCopyNode);
      winnersNode.append(panelNode);
      return;
    }

    const tableWrapNode = document.createElement("div");

    tableWrapNode.className = "host-awards-table-wrap host-scroll-panel";
    tableWrapNode.innerHTML = `
      <table class="host-awards-table">
        <thead>
          <tr>
            <th scope="col">Player</th>
            <th scope="col">Line Count</th>
            <th scope="col">Completed Lines</th>
            <th scope="col">Blackout</th>
          </tr>
        </thead>
        <tbody>
          ${winnerRows.map((winnerRow) => `
            <tr>
              <td>${escapeHtml(winnerRow.playerName || winnerRow.playerId)}</td>
              <td>${Array.isArray(winnerRow.completedLines) ? winnerRow.completedLines.length : 0}</td>
              <td>${escapeHtml(formatCompletedBingoLines(winnerRow.completedLines))}</td>
              <td>${winnerRow.blackoutWinner === true ? "Yes" : "No"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    panelNode.append(tableWrapNode);
    winnersNode.append(panelNode);
  }

  function renderBingoCurrentRoundCompact(roundNode) {
    if (!roundNode) {
      return;
    }

    roundNode.innerHTML = "";

    const panelNode = document.createElement("section");
    const headerNode = document.createElement("div");
    const titleWrapNode = document.createElement("div");
    const eyebrowNode = document.createElement("p");
    const titleNode = document.createElement("h3");
    const statusBadgeNode = document.createElement("span");

    panelNode.className = "hub-panel host-operator-card";
    headerNode.className = "trivia-status-row";
    eyebrowNode.className = "eyebrow";
    eyebrowNode.textContent = "Live Status";
    titleNode.textContent = hasPreparedBingoRound(hostUiState.bingoCurrentRound)
      ? "Current Bingo Round"
      : "No Bingo Round Prepared";
    statusBadgeNode.className = "trivia-status-badge";
    statusBadgeNode.dataset.bingoStatus = hostUiState.bingoCurrentRound.status;
    statusBadgeNode.textContent = getBingoRoundStatusLabel(hostUiState.bingoCurrentRound.status);
    titleWrapNode.append(eyebrowNode, titleNode);
    headerNode.append(titleWrapNode, statusBadgeNode);
    panelNode.append(headerNode);

    if (!hasPreparedBingoRound(hostUiState.bingoCurrentRound)) {
      const helperCopyNode = document.createElement("p");

      helperCopyNode.className = "player-copy";
      helperCopyNode.textContent = "Prepare a shared round on the left after the Bingo pool is ready.";
      panelNode.append(helperCopyNode);
      roundNode.append(panelNode);
      return;
    }

    const currentRound = hostUiState.bingoCurrentRound;
    const lastDraw = hostUiState.bingoStats.lastDraw;

    panelNode.append(
      createTriviaQuestionMetaRow("Cards Locked", currentRound.cardsLocked ? "Yes" : "No"),
      createTriviaQuestionMetaRow(
        "Latest Draw",
        lastDraw
          ? `${lastDraw.sequence}. ${lastDraw.name} (${lastDraw.method})`
          : "No items have been drawn yet."
      )
    );

    roundNode.append(panelNode);
  }

  function renderAdvancedWarnings(warningsNode) {
    if (!warningsNode) {
      return;
    }

    warningsNode.innerHTML = "";

    const warningMessages = new Set();

    [
      hostUiState.questionPoolWarning,
      hostUiState.questionPoolUnavailableMessage,
      hostUiState.currentRoundWarning,
      hostUiState.currentRoundUnavailableMessage,
      hostUiState.answersWarning,
      hostUiState.answersUnavailableMessage,
      hostUiState.displayWarning,
      hostUiState.displayUnavailableMessage,
      hostUiState.bingoSourcePoolWarning,
      hostUiState.bingoSourcePoolUnavailableMessage,
      hostUiState.registeredPlayersWarning,
      hostUiState.registeredPlayersUnavailableMessage,
      hostUiState.bingoCurrentRoundWarning,
      hostUiState.bingoCurrentRoundUnavailableMessage,
      hostUiState.bingoCardsWarning,
      hostUiState.bingoCardsUnavailableMessage,
      hostUiState.bingoDrawsWarning,
      hostUiState.bingoDrawsUnavailableMessage,
      hostUiState.bingoWinnersWarning,
      hostUiState.bingoWinnersUnavailableMessage,
      hostUiState.bingoWinnerPersistenceWarning,
    ].forEach((warningMessage) => {
      if (warningMessage) {
        warningMessages.add(warningMessage);
      }
    });

    hostUiState.displayState.errors.forEach((displayError) => {
      if (displayError) {
        warningMessages.add(displayError);
      }
    });

    if (hostUiState.bingoStats.cardErrors.length > 0) {
      warningMessages.add("Some malformed Bingo cards were ignored in host statistics.");
    }

    if (hostUiState.bingoStats.drawErrors.length > 0) {
      warningMessages.add("Some malformed Bingo draw records were ignored in host statistics.");
    }

    if (hostUiState.bingoStats.winnerErrors.length > 0) {
      warningMessages.add("Some malformed persisted Bingo winner records were ignored.");
    }

    const panelNode = document.createElement("section");

    panelNode.className = "hub-panel host-operator-card";
    panelNode.append(createHostSectionHeading({
      eyebrow: "Internal",
      title: "Warnings and Normalization Notes",
    }));

    if (warningMessages.size === 0) {
      const emptyCopyNode = document.createElement("p");

      emptyCopyNode.className = "player-copy";
      emptyCopyNode.textContent = "No current diagnostic warnings.";
      panelNode.append(emptyCopyNode);
      warningsNode.append(panelNode);
      return;
    }

    const listNode = document.createElement("ul");

    listNode.className = "host-advanced-list";
    warningMessages.forEach((warningMessage) => {
      const listItemNode = document.createElement("li");

      listItemNode.textContent = warningMessage;
      listNode.append(listItemNode);
    });

    panelNode.append(listNode);
    warningsNode.append(panelNode);
  }

  function renderAdvancedDisplayDiagnostics(displayNode) {
    if (!displayNode) {
      return;
    }

    displayNode.innerHTML = "";

    const panelNode = document.createElement("section");
    const currentDisplayState = hostUiState.displayState;

    panelNode.className = "hub-panel host-operator-card";
    panelNode.append(createHostSectionHeading({
      eyebrow: "Advanced",
      title: "Display Diagnostics",
    }));
    panelNode.append(
      createTriviaQuestionMetaRow("Mode", formatDisplayModeLabel(currentDisplayState.mode)),
      createTriviaQuestionMetaRow("Trivia Round ID", currentDisplayState.triviaRoundId || "None"),
      createTriviaQuestionMetaRow("Updated At", formatUpdatedAt(currentDisplayState.updatedAt)),
      createTriviaQuestionMetaRow("Updated By", currentDisplayState.updatedByRole || "Unknown"),
      createTriviaQuestionMetaRow("Waiting Message", currentDisplayState.statusMessage || "None"),
      createTriviaQuestionMetaRow(
        "Saved Announcement",
        currentDisplayState.announcement.message
          ? `${getDisplayMessageTitle(currentDisplayState.announcement, "Announcement")}: ${currentDisplayState.announcement.message}`
          : "None"
      ),
      createTriviaQuestionMetaRow(
        "Saved Winner",
        currentDisplayState.winner.message
          ? `${getDisplayMessageTitle(currentDisplayState.winner, "Winner")}: ${currentDisplayState.winner.message}`
          : "None"
      )
    );

    displayNode.append(panelNode);
  }

  function renderAdvancedTriviaDiagnostics(triviaNode) {
    if (!triviaNode) {
      return;
    }

    triviaNode.innerHTML = "";

    const panelNode = document.createElement("section");
    const currentRound = hostUiState.currentRound;

    panelNode.className = "hub-panel host-operator-card";
    panelNode.append(createHostSectionHeading({
      eyebrow: "Advanced",
      title: "Trivia Diagnostics",
    }));
    panelNode.append(
      createTriviaQuestionMetaRow("Question Pool Saved", formatUpdatedAt(hostUiState.questionPool.updatedAt)),
      createTriviaQuestionMetaRow("Selected Question ID", hostUiState.selectedQuestionId || "None"),
      createTriviaQuestionMetaRow("Random Preview ID", hostUiState.randomPreviewQuestionId || "None"),
      createTriviaQuestionMetaRow("Current Round ID", currentRound.roundId || "None"),
      createTriviaQuestionMetaRow("Current Question ID", currentRound.questionId || "None"),
      createTriviaQuestionMetaRow("Pushed At", formatUpdatedAt(currentRound.pushedAt)),
      createTriviaQuestionMetaRow("Locked At", formatUpdatedAt(currentRound.lockedAt)),
      createTriviaQuestionMetaRow("Revealed At", formatUpdatedAt(currentRound.revealedAt))
    );

    if (hasActiveTriviaRound(currentRound)) {
      panelNode.append(createTriviaQuestionCard(createRoundSnapshotQuestion(currentRound), {
        showHeading: true,
        showId: true,
        showAnswer: true,
      }));
    }

    triviaNode.append(panelNode);
  }

  function renderAdvancedBingoDiagnostics(bingoNode) {
    if (!bingoNode) {
      return;
    }

    bingoNode.innerHTML = "";

    const panelNode = document.createElement("section");
    const currentRound = hostUiState.bingoCurrentRound;

    panelNode.className = "hub-panel host-operator-card";
    panelNode.append(createHostSectionHeading({
      eyebrow: "Advanced",
      title: "Bingo Diagnostics",
    }));
    panelNode.append(
      createTriviaQuestionMetaRow("Round ID", currentRound.roundId || "None"),
      createTriviaQuestionMetaRow("Registered Players", String(hostUiState.registeredPlayerCount)),
      createTriviaQuestionMetaRow("Source Pool", String(hostUiState.bingoSourcePool.count)),
      createTriviaQuestionMetaRow("Target Pool", String(getCurrentBingoTargetPoolSize())),
      createTriviaQuestionMetaRow("Actual Pool", String(currentRound.actualPoolSize || 0)),
      createTriviaQuestionMetaRow("Prepared At", formatUpdatedAt(currentRound.preparedAt)),
      createTriviaQuestionMetaRow("Cards Locked At", formatUpdatedAt(currentRound.cardsLockedAt)),
      createTriviaQuestionMetaRow("Started At", formatUpdatedAt(currentRound.startedAt)),
      createTriviaQuestionMetaRow("Ended At", formatUpdatedAt(currentRound.endedAt)),
      createTriviaQuestionMetaRow(
        "Last Draw At",
        formatUpdatedAt(hostUiState.bingoStats.lastDraw?.drawnAt || "")
      )
    );

    const distributionGridNode = document.createElement("div");

    distributionGridNode.className = "trivia-count-grid host-summary-grid";
    hostUiState.bingoStats.distribution.forEach((distributionEntry) => {
      distributionGridNode.append(createSummaryCountCard({
        label: distributionEntry.label,
        value: distributionEntry.count,
      }));
    });
    panelNode.append(distributionGridNode);

    const winnerRows = hostUiState.bingoStats.winnerRows.filter(
      (winnerRow) => winnerRow.blackoutWinner === true || winnerRow.lineWinner === true
    );

    if (winnerRows.length > 0) {
      const tableWrapNode = document.createElement("div");

      tableWrapNode.className = "host-awards-table-wrap host-scroll-panel";
      tableWrapNode.innerHTML = `
        <table class="host-awards-table">
          <thead>
            <tr>
              <th scope="col">Player</th>
              <th scope="col">First Line At</th>
              <th scope="col">Blackout At</th>
            </tr>
          </thead>
          <tbody>
            ${winnerRows.map((winnerRow) => `
              <tr>
                <td>${escapeHtml(winnerRow.playerName || winnerRow.playerId)}</td>
                <td>${escapeHtml(formatUpdatedAt(winnerRow.firstLineAt))}</td>
                <td>${escapeHtml(formatUpdatedAt(winnerRow.blackoutAt))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;

      panelNode.append(tableWrapNode);
    }

    bingoNode.append(panelNode);
  }

  function renderHostTriviaController() {
    const contentNode = getActiveContentNode();

    if (!contentNode) {
      return;
    }

    const activeTab = normalizeHostTabKey(hostUiState.activeTab);
    const connectionSummary = getHostConnectionSummary();
    const eventName = normalizeTextInput(getEventConfig()?.eventName) || "A2Z Event";
    const filteredTriviaQuestions = getFilteredQuestions();
    const selectedQuestion = getSelectedQuestion();
    const hasLoadedTriviaQuestions = hostUiState.hasLoadedQuestionPool && !hostUiState.questionPoolUnavailableMessage;
    const isTriviaQuestionSelectDisabled = !hasLoadedTriviaQuestions || filteredTriviaQuestions.length === 0;
    const isSelectedQuestionVisible = !!selectedQuestion && filteredTriviaQuestions.some(
      (question) => question.id === selectedQuestion.id
    );
    const questionPoolTitle = hostUiState.activeDifficultyFilter === "all"
      ? "Saved Questions"
      : `${formatTriviaDifficultyLabel(hostUiState.activeDifficultyFilter)} Questions`;

    hostUiState.activeTab = activeTab;

    contentNode.innerHTML = `
      <div class="host-operator-screen">
        <section class="hub-panel host-operator-bar">
          <div class="host-operator-bar__copy">
            <p class="eyebrow">Host Console</p>
            <h2>${escapeHtml(eventName)}</h2>
          </div>
          <div class="host-operator-bar__meta">
            <span class="host-operator-chip" data-tone="${escapeHtml(connectionSummary.tone)}">
              Connection: ${escapeHtml(connectionSummary.label)}
            </span>
            <button type="button" class="secondary-button" data-action="lock-role">Lock Host</button>
          </div>
        </section>

        <div class="host-tab-shell">
        <div class="host-tab-list" role="tablist" aria-label="Host sections">
          ${HOST_TAB_DEFINITIONS.map((tabDefinition) => `
            <button
              type="button"
              id="host-tab-${tabDefinition.key}"
              class="hub-button host-tab-button"
              data-action="switch-host-tab"
              data-host-tab="${tabDefinition.key}"
              role="tab"
              aria-selected="${activeTab === tabDefinition.key ? "true" : "false"}"
              aria-controls="host-panel-${tabDefinition.key}"
              tabindex="${activeTab === tabDefinition.key ? "0" : "-1"}"
            >
              ${escapeHtml(tabDefinition.label)}
            </button>
          `).join("")}
        </div>

        <section
          id="host-panel-display"
          class="host-tab-panel"
          role="tabpanel"
          aria-labelledby="host-tab-display"
          ${activeTab === "display" ? "" : "hidden"}
        >
          <div class="host-panel-stack">
            <div data-host-display-notices></div>
            <div data-host-display-status></div>
            <div data-host-display-quick-modes></div>
            <div data-host-display-composer></div>
          </div>
        </section>

        <section
          id="host-panel-trivia"
          class="host-tab-panel"
          role="tabpanel"
          aria-labelledby="host-tab-trivia"
          ${activeTab === "trivia" ? "" : "hidden"}
        >
          <div class="host-panel-stack">
            <div data-host-live-notices></div>
            <div class="host-action-row" data-host-live-actions></div>
            <div class="host-operator-workspace host-trivia-top-row">
              <div class="host-operator-main host-trivia-main">
                <section class="hub-panel host-operator-card host-trivia-selector-card">
                  <div class="host-section-heading">
                    <p class="eyebrow">Trivia Operator</p>
                    <h3>Question Selector</h3>
                  </div>
                  <div class="host-trivia-selector-grid">
                    <label class="form-field host-inline-field host-trivia-selector-field host-trivia-selector-field--question">
                      <span>Question</span>
                      <select
                        class="form-input"
                        data-host-trivia-question-select
                        ${isTriviaQuestionSelectDisabled ? "disabled" : ""}
                      >
                        <option value="" ${isSelectedQuestionVisible ? "" : "selected"}>Select a saved question</option>
                        ${filteredTriviaQuestions.map((question) => `
                          <option
                            value="${escapeHtml(question.id)}"
                            ${hostUiState.selectedQuestionId === question.id ? "selected" : ""}
                          >
                            ${escapeHtml(formatTriviaQuestionOptionLabel(question))}
                          </option>
                        `).join("")}
                      </select>
                    </label>
                    <label class="form-field host-inline-field host-trivia-selector-field">
                      <span>Difficulty</span>
                      <select class="form-input" data-host-trivia-filter>
                        ${HOST_FILTER_DEFINITIONS.map((filterDefinition) => `
                          <option
                            value="${escapeHtml(filterDefinition.key)}"
                            ${hostUiState.activeDifficultyFilter === filterDefinition.key ? "selected" : ""}
                          >
                            ${escapeHtml(filterDefinition.label)}
                          </option>
                        `).join("")}
                      </select>
                    </label>
                  </div>
                  <div data-host-trivia-counts></div>
                  <div class="trivia-toolbar trivia-random-actions host-toolbar-row host-random-button-row" role="toolbar" aria-label="Random trivia preview">
                    ${["easy", "medium", "hard"].map((difficulty) => `
                      <button
                        type="button"
                        class="secondary-button"
                        data-action="preview-random-trivia"
                        data-difficulty="${difficulty}"
                        ${hostUiState.questionPool.counts[difficulty] > 0 ? "" : "disabled"}
                      >
                        Random ${escapeHtml(difficulty.charAt(0).toUpperCase() + difficulty.slice(1))}
                      </button>
                    `).join("")}
                  </div>
                  <div data-host-random-preview></div>
                </section>
              </div>
              <aside class="host-operator-side host-trivia-side">
                <section class="hub-panel host-operator-card host-trivia-live-panel">
                  <div data-host-current-round></div>
                  <div data-host-answer-stats></div>
                </section>
              </aside>
            </div>
            <section class="hub-panel host-operator-card host-trivia-pool-card">
              <div class="host-section-heading">
                <p class="eyebrow">Question Pool</p>
                <h3>${escapeHtml(questionPoolTitle)}</h3>
              </div>
              <div data-host-trivia-status></div>
              <div data-host-trivia-questions></div>
            </section>
          </div>
        </section>

        <section
          id="host-panel-bingo"
          class="host-tab-panel"
          role="tabpanel"
          aria-labelledby="host-tab-bingo"
          ${activeTab === "bingo" ? "" : "hidden"}
        >
          <div class="host-panel-stack">
            <div data-host-bingo-notices></div>
            <div data-host-bingo-actions></div>
            <div class="host-operator-workspace">
              <div class="host-operator-main">
                <div data-host-bingo-latest-draw></div>
                <div data-host-bingo-draw-history></div>
                <div data-host-bingo-winners></div>
              </div>
              <aside class="host-operator-side">
                <div data-host-bingo-current-round></div>
                <div data-host-bingo-counts></div>
              </aside>
            </div>
          </div>
        </section>

        <section
          id="host-panel-advanced"
          class="host-tab-panel"
          role="tabpanel"
          aria-labelledby="host-tab-advanced"
          ${activeTab === "advanced" ? "" : "hidden"}
        >
          <div class="host-panel-stack">
            <div class="host-advanced-grid">
              <div data-host-advanced-warnings></div>
              <div data-host-advanced-display></div>
              <div data-host-advanced-trivia></div>
              <div data-host-advanced-bingo></div>
            </div>
          </div>
        </section>
        </div>
      </div>
    `;

    renderDisplayNotices(contentNode.querySelector("[data-host-display-notices]"));
    renderDisplayStatus(contentNode.querySelector("[data-host-display-status]"));
    renderDisplayQuickModes(contentNode.querySelector("[data-host-display-quick-modes]"));
    renderDisplayComposer(contentNode.querySelector("[data-host-display-composer]"));
    renderControllerNotices(contentNode.querySelector("[data-host-live-notices]"));
    renderActionButtons(contentNode.querySelector("[data-host-live-actions]"));
    renderCompactCurrentRound(contentNode.querySelector("[data-host-current-round]"));
    renderAnswerStats(contentNode.querySelector("[data-host-answer-stats]"));
    renderCounts(contentNode.querySelector("[data-host-trivia-counts]"));
    renderPoolStatusNotice(contentNode.querySelector("[data-host-trivia-status]"));
    renderCompactQuestionList(contentNode.querySelector("[data-host-trivia-questions]"));
    renderCompactRandomPreview(contentNode.querySelector("[data-host-random-preview]"));
    renderBingoPreparationNotices(contentNode.querySelector("[data-host-bingo-notices]"));
    renderBingoOperatorActions(contentNode.querySelector("[data-host-bingo-actions]"));
    renderBingoLatestDraw(contentNode.querySelector("[data-host-bingo-latest-draw]"));
    renderBingoDrawHistoryCompact(contentNode.querySelector("[data-host-bingo-draw-history]"));
    renderBingoWinnerTable(contentNode.querySelector("[data-host-bingo-winners]"));
    renderBingoCurrentRoundCompact(contentNode.querySelector("[data-host-bingo-current-round]"));
    renderBingoOperatorCounts(contentNode.querySelector("[data-host-bingo-counts]"));
    renderAdvancedWarnings(contentNode.querySelector("[data-host-advanced-warnings]"));
    renderAdvancedDisplayDiagnostics(contentNode.querySelector("[data-host-advanced-display]"));
    renderAdvancedTriviaDiagnostics(contentNode.querySelector("[data-host-advanced-trivia]"));
    renderAdvancedBingoDiagnostics(contentNode.querySelector("[data-host-advanced-bingo]"));
  }

  function attachTriviaQuestionPoolListener() {
    if (typeof unsubscribeTriviaPoolListener === "function") {
      return;
    }

    hostUiState.isQuestionPoolLoading = !hostUiState.hasLoadedQuestionPool;

    unsubscribeTriviaPoolListener = firebase.listenEventData(
      TRIVIA_QUESTION_POOL_PATH,
      (questionPoolValue, listenerStatus) => {
        if (!listenerStatus.ok) {
          hostUiState.isQuestionPoolLoading = false;

          if (hostUiState.hasLoadedQuestionPool) {
            hostUiState.questionPoolWarning = "Live Trivia question-pool updates are temporarily unavailable. Showing the last loaded pool.";
          } else {
            hostUiState.questionPoolUnavailableMessage = "Trivia questions are temporarily unavailable right now. Please try again in a moment.";
          }

          renderHostTriviaController();
          return;
        }

        const normalizedQuestionPool = normalizeTriviaQuestionPool(questionPoolValue);

        if (!normalizedQuestionPool.isValid) {
          hostUiState.isQuestionPoolLoading = false;

          if (hostUiState.hasLoadedQuestionPool) {
            hostUiState.questionPoolWarning = "The saved Trivia question pool is invalid. Showing the last loaded pool.";
          } else {
            hostUiState.questionPoolUnavailableMessage = "The saved Trivia question pool is invalid. Admin needs to replace it.";
          }

          renderHostTriviaController();
          return;
        }

        const selectedQuestionWasPresent = !!getSelectedQuestion();

        hostUiState.questionPool = normalizedQuestionPool;
        hostUiState.hasLoadedQuestionPool = true;
        hostUiState.isQuestionPoolLoading = false;
        hostUiState.questionPoolWarning = "";
        hostUiState.questionPoolUnavailableMessage = "";

        if (!hostUiState.questionPool.orderedQuestions.some(
          (question) => question.id === hostUiState.randomPreviewQuestionId
        )) {
          hostUiState.randomPreviewQuestionId = "";
        }

        if (hostUiState.selectedQuestionId && !getSelectedQuestion()) {
          hostUiState.selectedQuestionId = "";

          if (selectedQuestionWasPresent) {
            setControllerMessage("The selected question was removed from the latest Trivia pool. Please choose another question before pushing.", "warning");
          }
        }

        renderHostTriviaController();
      }
    );
  }

  function attachCurrentRoundListener() {
    if (typeof unsubscribeCurrentRoundListener === "function") {
      return;
    }

    hostUiState.isCurrentRoundLoading = !hostUiState.hasLoadedCurrentRound;

    unsubscribeCurrentRoundListener = firebase.listenEventData(
      TRIVIA_CURRENT_ROUND_PATH,
      (roundValue, listenerStatus) => {
        if (!listenerStatus.ok) {
          hostUiState.isCurrentRoundLoading = false;

          if (hostUiState.hasLoadedCurrentRound) {
            hostUiState.currentRoundWarning = "Live Trivia round updates are temporarily unavailable. Showing the last loaded round.";
          } else {
            hostUiState.currentRoundUnavailableMessage = "The current Live Trivia round is temporarily unavailable right now.";
          }

          renderHostTriviaController();
          return;
        }

        const normalizedRound = normalizeTriviaCurrentRound(roundValue);

        if (!normalizedRound.isValid) {
          hostUiState.isCurrentRoundLoading = false;

          if (hostUiState.hasLoadedCurrentRound) {
            hostUiState.currentRoundWarning = "The current Live Trivia round data is invalid. Showing the last loaded round.";
          } else {
            hostUiState.currentRoundUnavailableMessage = "The current Live Trivia round data is invalid right now.";
            hostUiState.currentRound = normalizeTriviaCurrentRound(null);
            detachHostAnswersListener({ clearStats: true, roundForStats: hostUiState.currentRound });
          }

          renderHostTriviaController();
          return;
        }

        hostUiState.currentRound = normalizedRound;
        hostUiState.hasLoadedCurrentRound = true;
        hostUiState.isCurrentRoundLoading = false;
        hostUiState.currentRoundUnavailableMessage = "";
        hostUiState.currentRoundWarning = "";
        syncHostAnswersListener(normalizedRound);
        renderHostTriviaController();
      }
    );
  }

  function attachBingoSourcePoolListener() {
    if (typeof unsubscribeBingoSourcePoolListener === "function") {
      return;
    }

    hostUiState.isBingoSourcePoolLoading = !hostUiState.hasLoadedBingoSourcePool;

    unsubscribeBingoSourcePoolListener = firebase.listenEventData(
      BINGO_SOURCE_POOL_PATH,
      (sourcePoolValue, listenerStatus) => {
        if (!listenerStatus.ok) {
          hostUiState.isBingoSourcePoolLoading = false;

          if (hostUiState.hasLoadedBingoSourcePool) {
            hostUiState.bingoSourcePoolWarning = "Live Bingo pool updates are temporarily unavailable. Showing the last loaded pool.";
          } else {
            hostUiState.bingoSourcePoolUnavailableMessage = "The Bingo bottle pool is temporarily unavailable right now.";
          }

          renderHostTriviaController();
          return;
        }

        const normalizedSourcePool = normalizeBingoSourcePool(sourcePoolValue);

        if (!normalizedSourcePool.isValid) {
          hostUiState.isBingoSourcePoolLoading = false;

          if (hostUiState.hasLoadedBingoSourcePool) {
            hostUiState.bingoSourcePoolWarning = "The saved Bingo bottle pool is invalid. Showing the last loaded pool.";
          } else {
            hostUiState.bingoSourcePoolUnavailableMessage = "The saved Bingo bottle pool is invalid. Admin needs to replace it.";
          }

          renderHostTriviaController();
          return;
        }

        hostUiState.bingoSourcePool = normalizedSourcePool;
        hostUiState.hasLoadedBingoSourcePool = true;
        hostUiState.isBingoSourcePoolLoading = false;
        hostUiState.bingoSourcePoolUnavailableMessage = "";
        hostUiState.bingoSourcePoolWarning = "";
        renderHostTriviaController();
      }
    );
  }

  function attachRegisteredPlayersListener() {
    if (typeof unsubscribeRegisteredPlayersListener === "function") {
      return;
    }

    hostUiState.isRegisteredPlayersLoading = !hostUiState.hasLoadedRegisteredPlayers;

    unsubscribeRegisteredPlayersListener = firebase.listenEventData("players", (playersValue, listenerStatus) => {
      if (!listenerStatus.ok) {
        hostUiState.isRegisteredPlayersLoading = false;

        if (hostUiState.hasLoadedRegisteredPlayers) {
          hostUiState.registeredPlayersWarning = "Registered player updates are temporarily unavailable. Showing the last loaded count.";
        } else {
          hostUiState.registeredPlayersUnavailableMessage = "Registered player counts are temporarily unavailable right now.";
        }

        renderHostTriviaController();
        return;
      }

      hostUiState.registeredPlayersValue = playersValue && typeof playersValue === "object" && !Array.isArray(playersValue)
        ? playersValue
        : null;
      hostUiState.registeredPlayerCount = countRegisteredPlayers(playersValue);
      hostUiState.hasLoadedRegisteredPlayers = true;
      hostUiState.isRegisteredPlayersLoading = false;
      hostUiState.registeredPlayersUnavailableMessage = "";
      hostUiState.registeredPlayersWarning = "";
      recalculateHostBingoStats();
      renderHostTriviaController();
      void reconcileHostBingoWinners();
    });
  }

  function syncHostBingoRoundScopedListeners(round) {
    const normalizedRound = normalizeBingoCurrentRound(round);

    if (!hasPreparedBingoRound(normalizedRound) || !normalizedRound.roundId) {
      detachHostBingoRoundScopedListeners({ clearState: true });
      return;
    }

    if (
      hostUiState.activeBingoStatsRoundId === normalizedRound.roundId
      && typeof unsubscribeBingoCardsListener === "function"
      && typeof unsubscribeBingoDrawsListener === "function"
      && typeof unsubscribeBingoWinnersListener === "function"
    ) {
      return;
    }

    detachHostBingoRoundScopedListeners({ clearState: true });
    hostUiState.activeBingoStatsRoundId = normalizedRound.roundId;
    hostUiState.isBingoCardsLoading = true;
    hostUiState.isBingoDrawsLoading = true;
    hostUiState.isBingoWinnersLoading = true;
    recalculateHostBingoStats();

    unsubscribeBingoCardsListener = firebase.listenEventData(
      `bingo/live/cards/${normalizedRound.roundId}`,
      (cardsValue, listenerStatus) => {
        if (hostUiState.activeBingoStatsRoundId !== normalizedRound.roundId) {
          return;
        }

        if (!listenerStatus.ok) {
          hostUiState.isBingoCardsLoading = false;

          if (hostUiState.hasLoadedBingoCards) {
            hostUiState.bingoCardsWarning = "Current-round Bingo cards are temporarily unavailable. Showing the last loaded cards.";
          } else {
            hostUiState.bingoCardsUnavailableMessage = "Current-round Bingo cards are temporarily unavailable right now.";
          }

          renderHostTriviaController();
          return;
        }

        hostUiState.bingoCardsValue = cardsValue;
        hostUiState.hasLoadedBingoCards = true;
        hostUiState.isBingoCardsLoading = false;
        hostUiState.bingoCardsUnavailableMessage = "";
        hostUiState.bingoCardsWarning = "";
        recalculateHostBingoStats();
        renderHostTriviaController();
        void reconcileHostBingoWinners();
      }
    );

    unsubscribeBingoDrawsListener = firebase.listenEventData(
      getBingoRoundDrawsPath(normalizedRound.roundId),
      (drawsValue, listenerStatus) => {
        if (hostUiState.activeBingoStatsRoundId !== normalizedRound.roundId) {
          return;
        }

        if (!listenerStatus.ok) {
          hostUiState.isBingoDrawsLoading = false;

          if (hostUiState.hasLoadedBingoDraws) {
            hostUiState.bingoDrawsWarning = "Current-round Bingo draws are temporarily unavailable. Showing the last loaded draws.";
          } else {
            hostUiState.bingoDrawsUnavailableMessage = "Current-round Bingo draws are temporarily unavailable right now.";
          }

          renderHostTriviaController();
          return;
        }

        hostUiState.bingoDrawsValue = drawsValue;
        hostUiState.hasLoadedBingoDraws = true;
        hostUiState.isBingoDrawsLoading = false;
        hostUiState.bingoDrawsUnavailableMessage = "";
        hostUiState.bingoDrawsWarning = "";
        recalculateHostBingoStats();
        renderHostTriviaController();
        void reconcileHostBingoWinners();
      }
    );

    unsubscribeBingoWinnersListener = firebase.listenEventData(
      getBingoRoundWinnersPath(normalizedRound.roundId),
      (winnersValue, listenerStatus) => {
        if (hostUiState.activeBingoStatsRoundId !== normalizedRound.roundId) {
          return;
        }

        if (!listenerStatus.ok) {
          hostUiState.isBingoWinnersLoading = false;

          if (hostUiState.hasLoadedBingoWinners) {
            hostUiState.bingoWinnersWarning = "Current-round Bingo winners are temporarily unavailable. Showing the last loaded winners.";
          } else {
            hostUiState.bingoWinnersUnavailableMessage = "Current-round Bingo winners are temporarily unavailable right now.";
          }

          renderHostTriviaController();
          return;
        }

        hostUiState.bingoWinnersValue = winnersValue;
        hostUiState.hasLoadedBingoWinners = true;
        hostUiState.isBingoWinnersLoading = false;
        hostUiState.bingoWinnersUnavailableMessage = "";
        hostUiState.bingoWinnersWarning = "";
        recalculateHostBingoStats();
        renderHostTriviaController();
        void reconcileHostBingoWinners();
      }
    );
  }

  function attachBingoCurrentRoundListener() {
    if (typeof unsubscribeBingoCurrentRoundListener === "function") {
      return;
    }

    hostUiState.isBingoCurrentRoundLoading = !hostUiState.hasLoadedBingoCurrentRound;

    unsubscribeBingoCurrentRoundListener = firebase.listenEventData(
      BINGO_LIVE_CURRENT_ROUND_PATH,
      (roundValue, listenerStatus) => {
        if (!listenerStatus.ok) {
          hostUiState.isBingoCurrentRoundLoading = false;

          if (hostUiState.hasLoadedBingoCurrentRound) {
            hostUiState.bingoCurrentRoundWarning = "Live Bingo round updates are temporarily unavailable. Showing the last loaded round.";
          } else {
            hostUiState.bingoCurrentRoundUnavailableMessage = "The current Bingo round is temporarily unavailable right now.";
            hostUiState.bingoCurrentRound = createEmptyBingoCurrentRound();
            detachHostBingoRoundScopedListeners({ clearState: true });
          }

          renderHostTriviaController();
          return;
        }

        const normalizedRound = normalizeBingoCurrentRound(roundValue);

        if (!normalizedRound.isValid) {
          hostUiState.isBingoCurrentRoundLoading = false;

          if (hostUiState.hasLoadedBingoCurrentRound) {
            hostUiState.bingoCurrentRoundWarning = "The current Bingo round data is invalid. Showing the last loaded round.";
          } else {
            hostUiState.bingoCurrentRoundUnavailableMessage = "The current Bingo round data is invalid right now.";
            hostUiState.bingoCurrentRound = createEmptyBingoCurrentRound();
            detachHostBingoRoundScopedListeners({ clearState: true });
          }

          renderHostTriviaController();
          return;
        }

        const previousRoundId = normalizeTextInput(hostUiState.bingoCurrentRound.roundId);
        const didRoundChange = previousRoundId !== normalizedRound.roundId;

        if (!hasPreparedBingoRound(normalizedRound) || didRoundChange) {
          detachHostBingoRoundScopedListeners({ clearState: true });
        }

        hostUiState.bingoCurrentRound = normalizedRound;
        hostUiState.hasLoadedBingoCurrentRound = true;
        hostUiState.isBingoCurrentRoundLoading = false;
        hostUiState.bingoCurrentRoundUnavailableMessage = "";
        hostUiState.bingoCurrentRoundWarning = "";
        recalculateHostBingoStats();
        syncHostBingoRoundScopedListeners(normalizedRound);
        renderHostTriviaController();
      }
    );
  }

  async function pushSelectedQuestion() {
    const selectedQuestion = getSelectedQuestion();

    if (!selectedQuestion) {
      setControllerMessage("Select a Trivia question from the latest pool before pushing a live round.", "warning");
      renderHostTriviaController();
      return;
    }

    if (!hostUiState.hasLoadedCurrentRound) {
      setControllerMessage("Live Trivia round state is still loading. Please wait for it to finish before pushing a question.", "warning");
      renderHostTriviaController();
      return;
    }

    if (hasActiveTriviaRound(hostUiState.currentRound)) {
      const replaceConfirmed = window.confirm(
        "A Live Trivia round is already active or still showing results. Replace it with the newly selected question?"
      );

      if (!replaceConfirmed) {
        return;
      }
    }

    const latestSelectedQuestion = getSelectedQuestion();

    if (!latestSelectedQuestion) {
      setControllerMessage("The selected question is no longer in the latest Trivia pool. Please choose another question before pushing.", "warning");
      renderHostTriviaController();
      return;
    }

    hostUiState.isRoundActionBusy = true;
    setControllerMessage();
    renderHostTriviaController();

    const nextRoundPayload = buildLiveTriviaRoundPayload(latestSelectedQuestion, {
      pushedAt: new Date().toISOString(),
    });
    const pushSucceeded = await firebase.writeEventData(TRIVIA_CURRENT_ROUND_PATH, nextRoundPayload);

    hostUiState.isRoundActionBusy = false;

    if (!pushSucceeded) {
      setControllerMessage(firebase.getStatus().message || "We could not push the selected Trivia question right now. Please try again.", "error");
      renderHostTriviaController();
      return;
    }

    hostUiState.pushedQuestionIds.add(latestSelectedQuestion.id);

    const didDisplayAutoFollow = await syncHostDisplayToTriviaRound(nextRoundPayload.roundId);

    if (!didDisplayAutoFollow) {
      setControllerMessage(
        buildDisplayAutoFollowWarning(
          `Live Trivia round pushed for ${latestSelectedQuestion.id}.`,
          "Trivia"
        ),
        "warning"
      );
      renderHostTriviaController();
      return;
    }

    setControllerMessage(`Live Trivia round pushed for ${latestSelectedQuestion.id}.`, "success");
    renderHostTriviaController();
  }

  async function lockCurrentRound() {
    if (!canLockTriviaRound(hostUiState.currentRound)) {
      setControllerMessage("Answers can only be locked while a Trivia question is live.", "warning");
      renderHostTriviaController();
      return;
    }

    hostUiState.isRoundActionBusy = true;
    setControllerMessage();
    renderHostTriviaController();

    const lockSucceeded = await firebase.updateEventData(TRIVIA_CURRENT_ROUND_PATH, {
      status: "locked",
      lockedAt: new Date().toISOString(),
    });

    hostUiState.isRoundActionBusy = false;

    if (!lockSucceeded) {
      setControllerMessage(firebase.getStatus().message || "We could not lock Trivia answers right now. Please try again.", "error");
      renderHostTriviaController();
      return;
    }

    setControllerMessage("Trivia answers locked.", "success");
    renderHostTriviaController();
  }

  async function revealCurrentRound() {
    if (!canRevealTriviaRound(hostUiState.currentRound)) {
      setControllerMessage("The correct answer can only be revealed after answers are locked.", "warning");
      renderHostTriviaController();
      return;
    }

    hostUiState.isRoundActionBusy = true;
    setControllerMessage();
    renderHostTriviaController();

    const revealSucceeded = await firebase.updateEventData(TRIVIA_CURRENT_ROUND_PATH, {
      status: "revealed",
      revealedAt: new Date().toISOString(),
    });

    hostUiState.isRoundActionBusy = false;

    if (!revealSucceeded) {
      setControllerMessage(firebase.getStatus().message || "We could not reveal the Trivia answer right now. Please try again.", "error");
      renderHostTriviaController();
      return;
    }

    setControllerMessage("Trivia answer revealed.", "success");
    renderHostTriviaController();
  }

  async function endCurrentRound() {
    if (!canEndTriviaRound(hostUiState.currentRound)) {
      setControllerMessage("There is no active Trivia round to clear right now.", "warning");
      renderHostTriviaController();
      return;
    }

    const clearConfirmed = window.confirm(
      "End and clear the current Live Trivia round? Historic answers will remain saved under their round IDs."
    );

    if (!clearConfirmed) {
      return;
    }

    hostUiState.isRoundActionBusy = true;
    setControllerMessage();
    renderHostTriviaController();

    const clearSucceeded = await firebase.writeEventData(TRIVIA_CURRENT_ROUND_PATH, createEmptyTriviaCurrentRound());

    hostUiState.isRoundActionBusy = false;

    if (!clearSucceeded) {
      setControllerMessage(firebase.getStatus().message || "We could not clear the current Trivia round right now. Please try again.", "error");
      renderHostTriviaController();
      return;
    }

    setControllerMessage("Live Trivia round cleared. Prior round answers remain stored.", "success");
    renderHostTriviaController();
  }

  async function rereadBingoCurrentRoundForAction({
    expectedRoundId = "",
    allowedStatuses = [],
    unavailableMessage = "The Bingo round is no longer available. Please wait for the latest round to load.",
    staleRoundMessage = "The Bingo round changed before this action could be saved. Please wait for the latest round to load.",
    invalidStatusMessage = "That Bingo action is no longer allowed for the current round state.",
  } = {}) {
    const latestRoundValue = await firebase.readEventData(BINGO_LIVE_CURRENT_ROUND_PATH);
    const latestRound = normalizeBingoCurrentRound(latestRoundValue);

    if (!latestRound.isValid || !hasPreparedBingoRound(latestRound)) {
      setBingoPreparationMessage(unavailableMessage, "warning");
      renderHostTriviaController();
      return null;
    }

    if (expectedRoundId && latestRound.roundId !== expectedRoundId) {
      setBingoPreparationMessage(staleRoundMessage, "warning");
      renderHostTriviaController();
      return null;
    }

    if (allowedStatuses.length > 0 && !allowedStatuses.includes(latestRound.status)) {
      setBingoPreparationMessage(invalidStatusMessage, "warning");
      renderHostTriviaController();
      return null;
    }

    hostUiState.bingoCurrentRound = latestRound;
    hostUiState.hasLoadedBingoCurrentRound = true;
    hostUiState.isBingoCurrentRoundLoading = false;
    hostUiState.bingoCurrentRoundUnavailableMessage = "";
    hostUiState.bingoCurrentRoundWarning = "";
    recalculateHostBingoStats();
    return latestRound;
  }

  async function rereadBingoCardsForRound(round) {
    const cardsValue = await firebase.readEventData(`${BINGO_LIVE_CARDS_PATH}/${round.roundId}`);
    const cardState = normalizeBingoRoundCards(cardsValue, round);

    hostUiState.bingoCardsValue = cardsValue;
    hostUiState.hasLoadedBingoCards = true;
    hostUiState.isBingoCardsLoading = false;
    hostUiState.bingoCardsUnavailableMessage = "";
    hostUiState.bingoCardsWarning = "";
    recalculateHostBingoStats();

    return cardState;
  }

  function beginBingoHostAction() {
    hostUiState.isBingoActionBusy = true;
    setBingoPreparationMessage();
    renderHostTriviaController();
  }

  function finishBingoHostAction() {
    hostUiState.isBingoActionBusy = false;
  }

  async function lockBingoCards() {
    if (!canLockBingoRound(hostUiState.bingoCurrentRound)) {
      setBingoPreparationMessage("Cards can only be locked while the Bingo round is in cards-open status.", "warning");
      renderHostTriviaController();
      return;
    }

    beginBingoHostAction();

    const latestRound = await rereadBingoCurrentRoundForAction({
      expectedRoundId: hostUiState.bingoCurrentRound.roundId,
      allowedStatuses: ["cards_open"],
      invalidStatusMessage: "Cards can only be locked while the Bingo round is in cards-open status.",
    });

    if (!latestRound) {
      finishBingoHostAction();
      renderHostTriviaController();
      return;
    }

    const cardState = await rereadBingoCardsForRound(latestRound);

    if (cardState.cards.length === 0) {
      finishBingoHostAction();
      setBingoPreparationMessage("At least one valid active player Bingo card is required before cards can be locked.", "warning");
      renderHostTriviaController();
      return;
    }

    const lockSucceeded = await firebase.updateEventData(BINGO_LIVE_CURRENT_ROUND_PATH, {
      status: BINGO_ROUND_STATUS_CARDS_LOCKED,
      cardsLocked: true,
      cardsLockedAt: new Date().toISOString(),
    });

    finishBingoHostAction();

    if (!lockSucceeded) {
      setBingoPreparationMessage(firebase.getStatus().message || "We could not lock Bingo cards right now. Please try again.", "error");
      renderHostTriviaController();
      return;
    }

    const didDisplayAutoFollow = await syncHostDisplayToBingoMode();

    if (!didDisplayAutoFollow) {
      setBingoPreparationMessage(
        buildDisplayAutoFollowWarning("Bingo cards locked.", "Bingo"),
        "warning"
      );
      renderHostTriviaController();
      return;
    }

    setBingoPreparationMessage("Bingo cards locked.", "success");
    renderHostTriviaController();
  }

  async function startBingoRound() {
    if (!canStartBingoRound(hostUiState.bingoCurrentRound)) {
      setBingoPreparationMessage("The Bingo round can only be started after cards are locked.", "warning");
      renderHostTriviaController();
      return;
    }

    beginBingoHostAction();

    const latestRound = await rereadBingoCurrentRoundForAction({
      expectedRoundId: hostUiState.bingoCurrentRound.roundId,
      allowedStatuses: [BINGO_ROUND_STATUS_CARDS_LOCKED],
      invalidStatusMessage: "The Bingo round can only be started after cards are locked.",
    });

    if (!latestRound) {
      finishBingoHostAction();
      renderHostTriviaController();
      return;
    }

    const cardState = await rereadBingoCardsForRound(latestRound);

    if (cardState.cards.length === 0) {
      finishBingoHostAction();
      setBingoPreparationMessage("At least one valid active player Bingo card is required before the round can start.", "warning");
      renderHostTriviaController();
      return;
    }

    const startSucceeded = await firebase.updateEventData(BINGO_LIVE_CURRENT_ROUND_PATH, {
      status: BINGO_ROUND_STATUS_IN_PROGRESS,
      cardsLocked: true,
      startedAt: new Date().toISOString(),
    });

    finishBingoHostAction();

    if (!startSucceeded) {
      setBingoPreparationMessage(firebase.getStatus().message || "We could not start the Bingo round right now. Please try again.", "error");
      renderHostTriviaController();
      return;
    }

    const didDisplayAutoFollow = await syncHostDisplayToBingoMode();

    if (!didDisplayAutoFollow) {
      setBingoPreparationMessage(
        buildDisplayAutoFollowWarning("Bingo round started.", "Bingo"),
        "warning"
      );
      renderHostTriviaController();
      return;
    }

    setBingoPreparationMessage("Bingo round started.", "success");
    renderHostTriviaController();
  }

  async function drawBingoItem(method, selectedItemId = "") {
    if (!canDrawBingoRound(hostUiState.bingoCurrentRound)) {
      setBingoPreparationMessage("Bingo draws are only available while the round is in progress.", "warning");
      renderHostTriviaController();
      return;
    }

    const normalizedMethod = method === BINGO_DRAW_METHOD_MANUAL
      ? BINGO_DRAW_METHOD_MANUAL
      : BINGO_DRAW_METHOD_RANDOM;

    beginBingoHostAction();

    const latestRound = await rereadBingoCurrentRoundForAction({
      expectedRoundId: hostUiState.bingoCurrentRound.roundId,
      allowedStatuses: [BINGO_ROUND_STATUS_IN_PROGRESS],
      invalidStatusMessage: "Bingo draws are only available while the round is in progress.",
    });

    if (!latestRound) {
      finishBingoHostAction();
      renderHostTriviaController();
      return;
    }

    const latestDrawsValue = await firebase.readEventData(getBingoRoundDrawsPath(latestRound.roundId));

    hostUiState.bingoDrawsValue = latestDrawsValue;
    hostUiState.hasLoadedBingoDraws = true;
    hostUiState.isBingoDrawsLoading = false;
    hostUiState.bingoDrawsUnavailableMessage = "";
    hostUiState.bingoDrawsWarning = "";
    recalculateHostBingoStats();

    const activePoolItem = normalizedMethod === BINGO_DRAW_METHOD_MANUAL
      ? latestRound.activePool.find((itemValue) => itemValue.id === normalizeTextInput(selectedItemId))
      : selectRandomUndrawnBingoItem(latestRound, latestDrawsValue);

    if (!activePoolItem) {
      finishBingoHostAction();
      setBingoPreparationMessage(
        normalizedMethod === BINGO_DRAW_METHOD_MANUAL
          ? "Select an undrawn Bingo item from the current round before using manual draw."
          : "Every Bingo item in the current round has already been drawn.",
        "warning"
      );
      renderHostTriviaController();
      return;
    }

    const stillInProgress = latestRound.status === BINGO_ROUND_STATUS_IN_PROGRESS;
    const itemBelongsToPool = latestRound.activePool.some((itemValue) => itemValue.id === activePoolItem.id);
    const undrawnItems = getUndrawnBingoRoundItems(latestRound, latestDrawsValue);
    const isAlreadyDrawn = !undrawnItems.some((itemValue) => itemValue.id === activePoolItem.id);

    if (!stillInProgress || !itemBelongsToPool || isAlreadyDrawn) {
      finishBingoHostAction();
      setBingoPreparationMessage("That Bingo item is stale or has already been drawn. No draw was saved.", "warning");
      renderHostTriviaController();
      return;
    }

    const nextSequence = getNextBingoDrawSequence(latestDrawsValue, latestRound);
    const drawRecord = {
      roundId: latestRound.roundId,
      itemId: activePoolItem.id,
      name: activePoolItem.name,
      sequence: nextSequence,
      drawnAt: new Date().toISOString(),
      method: normalizedMethod,
    };
    const drawSucceeded = await firebase.updateEventData("bingo/live", {
      [`draws/${latestRound.roundId}/${activePoolItem.id}`]: drawRecord,
      "currentRound/drawCount": drawRecord.sequence,
      "currentRound/lastDraw": drawRecord,
    });

    finishBingoHostAction();

    if (!drawSucceeded) {
      setBingoPreparationMessage(firebase.getStatus().message || "We could not save the Bingo draw right now. Please try again.", "error");
      renderHostTriviaController();
      return;
    }

    const didDisplayAutoFollow = await syncHostDisplayToBingoMode();
    const drawSuccessMessage = normalizedMethod === BINGO_DRAW_METHOD_MANUAL
      ? `Manually drew ${activePoolItem.name}.`
      : `Drew ${activePoolItem.name}.`;

    if (!didDisplayAutoFollow) {
      setBingoPreparationMessage(
        buildDisplayAutoFollowWarning(drawSuccessMessage, "Bingo"),
        "warning"
      );
      renderHostTriviaController();
      return;
    }

    setBingoPreparationMessage(
      drawSuccessMessage,
      "success"
    );
    renderHostTriviaController();
  }

  async function endBingoRound() {
    if (!canEndBingoRound(hostUiState.bingoCurrentRound)) {
      setBingoPreparationMessage("The Bingo round can only be ended after cards are locked or while draws are in progress.", "warning");
      renderHostTriviaController();
      return;
    }

    const endConfirmed = window.confirm(
      "End the current Bingo round? Cards, draws, statistics, and winner history will remain saved."
    );

    if (!endConfirmed) {
      return;
    }

    beginBingoHostAction();

    const latestRound = await rereadBingoCurrentRoundForAction({
      expectedRoundId: hostUiState.bingoCurrentRound.roundId,
      allowedStatuses: [BINGO_ROUND_STATUS_CARDS_LOCKED, BINGO_ROUND_STATUS_IN_PROGRESS],
      invalidStatusMessage: "The Bingo round can only be ended after cards are locked or while draws are in progress.",
    });

    if (!latestRound) {
      finishBingoHostAction();
      renderHostTriviaController();
      return;
    }

    const endSucceeded = await firebase.updateEventData(BINGO_LIVE_CURRENT_ROUND_PATH, {
      status: BINGO_ROUND_STATUS_ENDED,
      cardsLocked: true,
      endedAt: new Date().toISOString(),
    });

    finishBingoHostAction();

    if (!endSucceeded) {
      setBingoPreparationMessage(firebase.getStatus().message || "We could not end the Bingo round right now. Please try again.", "error");
      renderHostTriviaController();
      return;
    }

    const didDisplayAutoFollow = await syncHostDisplayToBingoMode();

    if (!didDisplayAutoFollow) {
      setBingoPreparationMessage(
        buildDisplayAutoFollowWarning(
          "Bingo round ended. Cards, draws, statistics, and winners remain visible.",
          "Bingo"
        ),
        "warning"
      );
      renderHostTriviaController();
      return;
    }

    setBingoPreparationMessage("Bingo round ended. Cards, draws, statistics, and winners remain visible.", "success");
    renderHostTriviaController();
  }

  async function clearBingoRound() {
    if (!canClearBingoRound(hostUiState.bingoCurrentRound)) {
      setBingoPreparationMessage("There is no active Bingo round to clear right now.", "warning");
      renderHostTriviaController();
      return;
    }

    const clearConfirmed = window.confirm(
      "Clear and reset the current Bingo round to idle? Historic cards, draws, and winner records will remain stored by round ID."
    );

    if (!clearConfirmed) {
      return;
    }

    beginBingoHostAction();

    const latestRound = await firebase.readEventData(BINGO_LIVE_CURRENT_ROUND_PATH);
    const normalizedRound = normalizeBingoCurrentRound(latestRound);

    if (!normalizedRound.isValid || normalizedRound.status === "idle") {
      finishBingoHostAction();
      setBingoPreparationMessage("The Bingo round was already cleared or changed before reset could run.", "warning");
      renderHostTriviaController();
      return;
    }

    if (
      hostUiState.bingoCurrentRound.roundId
      && normalizedRound.roundId
      && normalizedRound.roundId !== hostUiState.bingoCurrentRound.roundId
    ) {
      finishBingoHostAction();
      setBingoPreparationMessage("The Bingo round changed before reset could run. Please wait for the latest round to load.", "warning");
      renderHostTriviaController();
      return;
    }

    const clearSucceeded = await firebase.writeEventData(BINGO_LIVE_CURRENT_ROUND_PATH, createEmptyBingoCurrentRound());

    finishBingoHostAction();

    if (!clearSucceeded) {
      setBingoPreparationMessage(firebase.getStatus().message || "We could not clear the current Bingo round right now. Please try again.", "error");
      renderHostTriviaController();
      return;
    }

    detachHostBingoRoundScopedListeners({ clearState: true });
    hostUiState.bingoCurrentRound = createEmptyBingoCurrentRound();
    hostUiState.hasLoadedBingoCurrentRound = true;
    hostUiState.isBingoCurrentRoundLoading = false;
    hostUiState.bingoCurrentRoundUnavailableMessage = "";
    hostUiState.bingoCurrentRoundWarning = "";
    recalculateHostBingoStats();
    setBingoPreparationMessage("Current Bingo round cleared. Historic cards, draws, and winners remain stored.", "success");
    renderHostTriviaController();
  }

  async function prepareBingoRound() {
    if (!firebase.getStatus().isConnected) {
      setBingoPreparationMessage("Bingo round preparation requires a live Firebase connection.", "warning");
      renderHostTriviaController();
      return;
    }

    if (!hostUiState.hasLoadedBingoCurrentRound) {
      setBingoPreparationMessage("Bingo round state is still loading. Please wait before preparing a new round.", "warning");
      renderHostTriviaController();
      return;
    }

    hostUiState.isPreparingBingoRound = true;
    setBingoPreparationMessage();
    renderHostTriviaController();

    const [playersValue, sourcePoolValue, currentRoundValue] = await Promise.all([
      firebase.readEventData("players"),
      firebase.readEventData(BINGO_SOURCE_POOL_PATH),
      firebase.readEventData(BINGO_LIVE_CURRENT_ROUND_PATH),
    ]);
    const freshPlayerCount = countRegisteredPlayers(playersValue);
    const freshSourcePool = normalizeBingoSourcePool(sourcePoolValue);
    const freshCurrentRound = normalizeBingoCurrentRound(currentRoundValue);

    hostUiState.registeredPlayersValue = playersValue && typeof playersValue === "object" && !Array.isArray(playersValue)
      ? playersValue
      : null;
    hostUiState.registeredPlayerCount = freshPlayerCount;
    hostUiState.hasLoadedRegisteredPlayers = true;
    hostUiState.isRegisteredPlayersLoading = false;
    hostUiState.registeredPlayersUnavailableMessage = "";
    hostUiState.registeredPlayersWarning = "";
    hostUiState.bingoSourcePool = freshSourcePool.isValid ? freshSourcePool : hostUiState.bingoSourcePool;
    hostUiState.hasLoadedBingoSourcePool = true;
    hostUiState.isBingoSourcePoolLoading = false;
    hostUiState.bingoSourcePoolUnavailableMessage = "";
    hostUiState.bingoSourcePoolWarning = freshSourcePool.isValid ? "" : "The saved Bingo bottle pool is invalid. Admin needs to replace it.";
    hostUiState.bingoCurrentRound = freshCurrentRound.isValid ? freshCurrentRound : hostUiState.bingoCurrentRound;
    hostUiState.hasLoadedBingoCurrentRound = true;
    hostUiState.isBingoCurrentRoundLoading = false;
    hostUiState.bingoCurrentRoundUnavailableMessage = "";
    hostUiState.bingoCurrentRoundWarning = freshCurrentRound.isValid ? "" : "The current Bingo round data is invalid right now.";

    if (!freshSourcePool.isValid) {
      hostUiState.isPreparingBingoRound = false;
      setBingoPreparationMessage("The saved Bingo bottle pool is invalid. Admin needs to replace it before a round can be prepared.", "error");
      renderHostTriviaController();
      return;
    }

    if (freshSourcePool.count < BINGO_CARD_ITEM_COUNT) {
      hostUiState.isPreparingBingoRound = false;
      setBingoPreparationMessage(`At least ${BINGO_CARD_ITEM_COUNT} unique Bingo items are required before a round can be prepared.`, "warning");
      renderHostTriviaController();
      return;
    }

    if (freshCurrentRound.isValid && hasPreparedBingoRound(freshCurrentRound)) {
      const replaceConfirmed = window.confirm(
        "A Bingo card round is already prepared. Replace the current Bingo round with a newly prepared round?"
      );

      if (!replaceConfirmed) {
        hostUiState.isPreparingBingoRound = false;
        renderHostTriviaController();
        return;
      }
    } else if (currentRoundValue && !freshCurrentRound.isValid) {
      const replaceInvalidConfirmed = window.confirm(
        "The current Bingo round data is invalid. Replace it with a newly prepared Bingo round?"
      );

      if (!replaceInvalidConfirmed) {
        hostUiState.isPreparingBingoRound = false;
        renderHostTriviaController();
        return;
      }
    }

    const targetPoolSize = getBingoTargetPoolSize(freshPlayerCount);
    const actualPoolSize = Math.min(targetPoolSize, freshSourcePool.count);
    const activePool = actualPoolSize === freshSourcePool.count
      ? sampleBingoItems(freshSourcePool.items, freshSourcePool.count)
      : sampleBingoItems(freshSourcePool.items, targetPoolSize);
    const nextRoundPayload = buildBingoCurrentRoundPayload({
      playerCountAtPreparation: freshPlayerCount,
      targetPoolSize,
      activePool,
      cardsLocked: false,
      preparedAt: new Date().toISOString(),
    });
    const prepareSucceeded = await firebase.writeEventData(BINGO_LIVE_CURRENT_ROUND_PATH, nextRoundPayload);

    hostUiState.isPreparingBingoRound = false;

    if (!prepareSucceeded) {
      setBingoPreparationMessage(firebase.getStatus().message || "We could not prepare the Bingo round right now. Please try again.", "error");
      renderHostTriviaController();
      return;
    }

    detachHostBingoRoundScopedListeners({ clearState: true });
    hostUiState.bingoCurrentRound = normalizeBingoCurrentRound(nextRoundPayload);
    hostUiState.hasLoadedBingoCurrentRound = true;
    hostUiState.isBingoCurrentRoundLoading = false;
    hostUiState.bingoCurrentRoundUnavailableMessage = "";
    hostUiState.bingoCurrentRoundWarning = "";
    recalculateHostBingoStats();
    syncHostBingoRoundScopedListeners(hostUiState.bingoCurrentRound);

    const displayFollowSucceeded = await syncHostDisplayToBingoMode();
    const preparedRoundMessage = freshSourcePool.count < targetPoolSize
      ? `Bingo round prepared with ${freshSourcePool.count} items because the current pool could not meet the ${targetPoolSize}-item target.`
      : `Bingo round prepared for ${freshPlayerCount} registered players with a ${targetPoolSize}-item active pool.`;
    const preparedRoundTone = freshSourcePool.count < targetPoolSize
      ? "warning"
      : "success";

    if (!displayFollowSucceeded) {
      setBingoPreparationMessage(
        buildDisplayAutoFollowWarning(preparedRoundMessage, "Bingo"),
        "warning"
      );
      renderHostTriviaController();
      return;
    }

    setBingoPreparationMessage(preparedRoundMessage, preparedRoundTone);

    renderHostTriviaController();
  }

  function ensureHostEventHandlers(rootNode) {
    if (
      activeHostRoot === rootNode
      && activeHostClickHandler
      && activeHostInputHandler
      && activeHostChangeHandler
      && activeHostSubmitHandler
    ) {
      return;
    }

    if (activeHostRoot && activeHostClickHandler) {
      activeHostRoot.removeEventListener("click", activeHostClickHandler);
    }

    if (activeHostRoot && activeHostInputHandler) {
      activeHostRoot.removeEventListener("input", activeHostInputHandler);
    }

    if (activeHostRoot && activeHostChangeHandler) {
      activeHostRoot.removeEventListener("change", activeHostChangeHandler);
    }

    if (activeHostRoot && activeHostSubmitHandler) {
      activeHostRoot.removeEventListener("submit", activeHostSubmitHandler);
    }

    activeHostClickHandler = async (event) => {
      const actionNode = event.target.closest("[data-action]");

      if (!actionNode) {
        return;
      }

      const action = actionNode.dataset.action;

      if (action === "lock-role") {
        cleanupHostTriviaController();
        return;
      }

      if (action === "switch-host-tab") {
        const nextTab = normalizeHostTabKey(actionNode.dataset.hostTab);

        if (hostUiState.activeTab !== nextTab) {
          hostUiState.activeTab = nextTab;
          renderHostTriviaController();
        }

        return;
      }

      if (action === "switch-host-display-mode") {
        if (hostUiState.isDisplayActionBusy) {
          return;
        }

        await switchHostDisplayMode(actionNode.dataset.displayMode || "");
        return;
      }

      if (action === "preview-random-trivia") {
        const randomQuestion = getRandomPreviewQuestionForDifficulty(
          actionNode.dataset.difficulty || "all"
        );

        hostUiState.randomPreviewQuestionId = randomQuestion?.id || "";
        renderHostTriviaController();
        return;
      }

      if (action === "select-random-preview-trivia") {
        const previewQuestion = getRandomPreviewQuestion();

        if (!previewQuestion) {
          hostUiState.randomPreviewQuestionId = "";
          setControllerMessage("The random preview is no longer available. Pick another random question.", "warning");
          renderHostTriviaController();
          return;
        }

        hostUiState.activeDifficultyFilter = normalizeHostDifficultyFilter(previewQuestion.difficulty);
        hostUiState.selectedQuestionId = previewQuestion.id;
        setControllerMessage();
        renderHostTriviaController();
        return;
      }

      if (action === "select-trivia-question") {
        hostUiState.selectedQuestionId = actionNode.dataset.questionId || "";
        setControllerMessage();
        renderHostTriviaController();
        return;
      }

      if (action === "prepare-bingo-round") {
        if (hostUiState.isPreparingBingoRound || hostUiState.isBingoActionBusy) {
          return;
        }

        await prepareBingoRound();
        return;
      }

      if (action === "lock-bingo-cards") {
        if (hostUiState.isBingoActionBusy) {
          return;
        }

        await lockBingoCards();
        return;
      }

      if (action === "start-bingo-round") {
        if (hostUiState.isBingoActionBusy) {
          return;
        }

        await startBingoRound();
        return;
      }

      if (action === "draw-next-bingo-item") {
        if (hostUiState.isBingoActionBusy) {
          return;
        }

        await drawBingoItem(BINGO_DRAW_METHOD_RANDOM);
        return;
      }

      if (action === "draw-selected-bingo-item") {
        if (hostUiState.isBingoActionBusy) {
          return;
        }

        const manualDrawSelect = rootNode.querySelector("#host-bingo-manual-draw-select");
        const selectedItemId = manualDrawSelect instanceof HTMLSelectElement
          ? manualDrawSelect.value
          : "";

        await drawBingoItem(BINGO_DRAW_METHOD_MANUAL, selectedItemId);
        return;
      }

      if (action === "end-bingo-round") {
        if (hostUiState.isBingoActionBusy) {
          return;
        }

        await endBingoRound();
        return;
      }

      if (action === "clear-bingo-round") {
        if (hostUiState.isBingoActionBusy) {
          return;
        }

        await clearBingoRound();
        return;
      }

      if (hostUiState.isRoundActionBusy) {
        return;
      }

      if (action === "push-live-trivia") {
        await pushSelectedQuestion();
        return;
      }

      if (action === "lock-live-trivia") {
        await lockCurrentRound();
        return;
      }

      if (action === "reveal-live-trivia") {
        await revealCurrentRound();
        return;
      }

      if (action === "end-live-trivia") {
        await endCurrentRound();
      }
    };

    activeHostInputHandler = (event) => {
      const targetNode = event.target;

      if (targetNode instanceof HTMLInputElement && targetNode.matches("[data-host-display-title]")) {
        const composerType = normalizeHostDisplayComposerType(hostUiState.displayComposerType);

        if (composerType === DISPLAY_MODE_ANNOUNCEMENT) {
          hostUiState.displayAnnouncementTitleDraft = targetNode.value;
          hostUiState.isDisplayAnnouncementDirty = true;
        } else if (composerType === DISPLAY_MODE_WINNER) {
          hostUiState.displayWinnerTitleDraft = targetNode.value;
          hostUiState.isDisplayWinnerDirty = true;
        }

        return;
      }

      if (targetNode instanceof HTMLTextAreaElement && targetNode.matches("[data-host-display-message]")) {
        const composerType = normalizeHostDisplayComposerType(hostUiState.displayComposerType);

        if (composerType === DISPLAY_MODE_WAITING) {
          hostUiState.displayWaitingDraft = targetNode.value;
          hostUiState.isDisplayWaitingDirty = true;
          return;
        }

        if (composerType === DISPLAY_MODE_ANNOUNCEMENT) {
          hostUiState.displayAnnouncementMessageDraft = targetNode.value;
          hostUiState.isDisplayAnnouncementDirty = true;
          return;
        }

        hostUiState.displayWinnerMessageDraft = targetNode.value;
        hostUiState.isDisplayWinnerDirty = true;
      }
    };

    activeHostChangeHandler = (event) => {
      const targetNode = event.target;

      if (targetNode instanceof HTMLSelectElement && targetNode.matches("[data-host-display-type]")) {
        hostUiState.displayComposerType = normalizeHostDisplayComposerType(targetNode.value);
        renderHostTriviaController();
        return;
      }

      if (targetNode instanceof HTMLSelectElement && targetNode.matches("[data-host-trivia-filter]")) {
        hostUiState.activeDifficultyFilter = normalizeHostDifficultyFilter(targetNode.value);

        if (
          hostUiState.selectedQuestionId
          && !getFilteredQuestions().some((question) => question.id === hostUiState.selectedQuestionId)
        ) {
          hostUiState.selectedQuestionId = "";
        }

        renderHostTriviaController();
        return;
      }

      if (targetNode instanceof HTMLSelectElement && targetNode.matches("[data-host-trivia-question-select]")) {
        hostUiState.selectedQuestionId = normalizeTextInput(targetNode.value);
        setControllerMessage();
        renderHostTriviaController();
      }
    };

    activeHostSubmitHandler = async (event) => {
      const formNode = event.target;

      if (!(formNode instanceof HTMLFormElement) || !formNode.matches("[data-host-display-form]")) {
        return;
      }

      event.preventDefault();

      if (hostUiState.isDisplayActionBusy) {
        return;
      }

      await submitHostDisplayComposer();
    };

    rootNode.addEventListener("click", activeHostClickHandler);
    rootNode.addEventListener("input", activeHostInputHandler);
    rootNode.addEventListener("change", activeHostChangeHandler);
    rootNode.addEventListener("submit", activeHostSubmitHandler);
    activeHostRoot = rootNode;
  }

  return initRoleProtectedPage({
    role: "host",
    rootSelector: HOST_ROOT_SELECTOR,
    state,
    firebase,
    renderStatus,
    pinFieldName: "hostPin",
    lockedIntroCopy: "Enter the Host PIN to unlock live Host controls for this browser session.",
    shellTitle: "Host Console",
    shellCopy: "Live event operations only.",
    setupCopy: "Host PIN setup is required before this page can be unlocked.",
    placeholderCards: HOST_RESERVED_CARDS,
    onUnlock() {
      initTriviaModule({ firebase, state, role: "host" });
      initBingoModule({ firebase, state, role: "host" });
    },
    onRenderUnlocked({ rootNode }) {
      ensureHostEventHandlers(rootNode);
      attachHostDisplayListener();
      attachTriviaQuestionPoolListener();
      attachCurrentRoundListener();
      attachBingoSourcePoolListener();
      attachRegisteredPlayersListener();
      attachBingoCurrentRoundListener();
      renderHostTriviaController();
    },
  });
}

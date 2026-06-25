import {
  BINGO_LIVE_CURRENT_ROUND_PATH,
  BINGO_ROUND_STATUS_CARDS_LOCKED,
  BINGO_ROUND_STATUS_CARDS_OPEN,
  BINGO_ROUND_STATUS_ENDED,
  BINGO_ROUND_STATUS_IN_PROGRESS,
  hasPreparedBingoRound,
  normalizeBingoCurrentRound,
} from "./bingo-pool.js";
import { getBingoRoundDrawsPath, normalizeBingoRoundDraws } from "./bingo-live.js";
import {
  DEFAULT_WAITING_STATUS_MESSAGE,
  DISPLAY_MODE_ANNOUNCEMENT,
  DISPLAY_MODE_BINGO,
  DISPLAY_MODE_TRIVIA,
  DISPLAY_MODE_TRIVIA_REVEAL,
  DISPLAY_MODE_WAITING,
  DISPLAY_MODE_WINNER,
  DISPLAY_PATH,
  canDisplayTriviaRevealRound,
  canDisplayTriviaRound,
  getDisplayMessageTitle,
  normalizeDisplayState,
} from "./display-state.js";
import {
  TRIVIA_CURRENT_ROUND_PATH,
  TRIVIA_ROUND_STATUS_LOCKED,
  TRIVIA_ROUND_STATUS_QUESTION_LIVE,
  TRIVIA_ROUND_STATUS_REVEALED,
  hasActiveTriviaRound,
  normalizeTriviaCurrentRound,
} from "./trivia-live.js";
import { isValidAbsoluteHttpUrl, normalizeTextInput } from "./utils.js";

const DISPLAY_ROOT_SELECTOR = "#display-app";
const CONFIG_PATH = "config";
const RECENT_BINGO_DRAW_COUNT = 5;

let activeDisplayRoot = null;
let unsubscribeDisplayStateListener = null;
let unsubscribeConfigListener = null;
let unsubscribeTriviaRoundListener = null;
let unsubscribeBingoRoundListener = null;
let unsubscribeBingoDrawsListener = null;
let hasBoundDisplayBeforeUnload = false;
let displayUiState = null;

function createEmptyDisplayUiState(eventConfig = null) {
  return {
    eventConfig: eventConfig || null,
    hasLoadedConfig: false,
    configWarning: "",
    rawDisplayStateValue: null,
    displayState: normalizeDisplayState(null, eventConfig),
    hasLoadedDisplayState: false,
    displayStateWarning: "",
    triviaRound: normalizeTriviaCurrentRound(null),
    hasLoadedTriviaRound: false,
    triviaRoundWarning: "",
    bingoRound: normalizeBingoCurrentRound(null),
    hasLoadedBingoRound: false,
    bingoRoundWarning: "",
    bingoDrawsValue: null,
    hasLoadedBingoDraws: false,
    bingoDrawsWarning: "",
    activeBingoDrawsRoundId: "",
  };
}

function cleanupDisplayPageRuntime() {
  if (typeof unsubscribeDisplayStateListener === "function") {
    unsubscribeDisplayStateListener();
  }

  if (typeof unsubscribeConfigListener === "function") {
    unsubscribeConfigListener();
  }

  if (typeof unsubscribeTriviaRoundListener === "function") {
    unsubscribeTriviaRoundListener();
  }

  if (typeof unsubscribeBingoRoundListener === "function") {
    unsubscribeBingoRoundListener();
  }

  if (typeof unsubscribeBingoDrawsListener === "function") {
    unsubscribeBingoDrawsListener();
  }

  unsubscribeDisplayStateListener = null;
  unsubscribeConfigListener = null;
  unsubscribeTriviaRoundListener = null;
  unsubscribeBingoRoundListener = null;
  unsubscribeBingoDrawsListener = null;

  if (displayUiState) {
    displayUiState.activeBingoDrawsRoundId = "";
  }

  activeDisplayRoot = null;
}

function handleDisplayBeforeUnload() {
  cleanupDisplayPageRuntime();
}

function formatDifficultyLabel(difficultyValue) {
  const normalizedDifficulty = normalizeTextInput(difficultyValue);

  if (!normalizedDifficulty) {
    return "Trivia";
  }

  return normalizedDifficulty.charAt(0).toUpperCase() + normalizedDifficulty.slice(1);
}

function createElement(tagName, className = "") {
  const node = document.createElement(tagName);

  if (className) {
    node.className = className;
  }

  return node;
}

function createBadge(label, dataValue = "") {
  const badgeNode = createElement("span", "display-chip");

  if (dataValue) {
    badgeNode.dataset.displayChip = dataValue;
  }

  badgeNode.textContent = label;
  return badgeNode;
}

function createInfoCard(label, value) {
  const cardNode = createElement("article", "display-info-card");
  const valueNode = createElement("strong", "display-info-card__value");
  const labelNode = createElement("span", "display-info-card__label");

  valueNode.textContent = value;
  labelNode.textContent = label;
  cardNode.append(valueNode, labelNode);
  return cardNode;
}

function createBrandBlock(eventConfig, { compact = false } = {}) {
  const brandNode = createElement(
    "header",
    compact ? "display-brand display-brand--compact" : "display-brand"
  );
  const logoUrl = normalizeTextInput(eventConfig?.eventLogoUrl);
  const eventName = normalizeTextInput(eventConfig?.eventName) || "A2Z Event";
  const textWrapNode = createElement("div", "display-brand__copy");
  const eyebrowNode = createElement("p", "display-brand__eyebrow");
  const titleNode = createElement(compact ? "h2" : "h1", "display-brand__title");

  eyebrowNode.textContent = "A2Z Liquors";
  titleNode.textContent = eventName;
  textWrapNode.append(eyebrowNode, titleNode);

  if (isValidAbsoluteHttpUrl(logoUrl)) {
    const logoNode = createElement("img", "display-brand__logo");

    logoNode.alt = `${eventName} logo`;
    logoNode.src = logoUrl;
    logoNode.loading = "eager";
    logoNode.decoding = "async";
    logoNode.addEventListener("error", () => {
      logoNode.hidden = true;
    }, { once: true });
    brandNode.append(logoNode);
  }

  brandNode.append(textWrapNode);
  return brandNode;
}

function createHeroCopy({ eyebrow, title, message, secondaryMessage = "" } = {}) {
  const sectionNode = createElement("section", "display-hero");
  const eyebrowNode = createElement("p", "display-hero__eyebrow");
  const titleNode = createElement("h2", "display-hero__title");

  eyebrowNode.textContent = eyebrow;
  titleNode.textContent = title;
  sectionNode.append(eyebrowNode, titleNode);

  if (message) {
    const messageNode = createElement("p", "display-hero__message");

    messageNode.textContent = message;
    sectionNode.append(messageNode);
  }

  if (secondaryMessage) {
    const secondaryNode = createElement("p", "display-hero__secondary");

    secondaryNode.textContent = secondaryMessage;
    sectionNode.append(secondaryNode);
  }

  return sectionNode;
}

function createTriviaOptionsList(round, { highlightCorrect = false } = {}) {
  const listNode = createElement("ol", "display-option-list");

  round.options.forEach((optionValue, optionIndex) => {
    const optionNode = createElement("li", "display-option-list__item");
    const numberNode = createElement("span", "display-option-list__number");
    const copyNode = createElement("span", "display-option-list__copy");
    const shouldHighlight = highlightCorrect && optionIndex === round.correctAnswer;

    if (shouldHighlight) {
      optionNode.dataset.displayOption = "correct";
    }

    numberNode.textContent = `${optionIndex + 1}.`;
    copyNode.textContent = optionValue;
    optionNode.append(numberNode, copyNode);

    if (shouldHighlight) {
      const markerNode = createBadge("Correct Answer", "correct");

      markerNode.classList.add("display-option-list__badge");
      optionNode.append(markerNode);
    }

    listNode.append(optionNode);
  });

  return listNode;
}

function createTriviaRoundView(round, { revealAnswer = false } = {}) {
  const panelNode = createElement("section", "display-panel display-panel--trivia");
  const headerNode = createElement("div", "display-panel__header");
  const eyebrowNode = createElement("p", "display-panel__eyebrow");
  const titleNode = createElement("h2", "display-panel__title");
  const chipRowNode = createElement("div", "display-chip-row");
  const questionNode = createElement("p", "display-question");

  eyebrowNode.textContent = revealAnswer ? "Trivia Reveal" : "Live Trivia";
  titleNode.textContent = revealAnswer ? "Answer Reveal" : "Current Question";
  chipRowNode.append(
    createBadge(formatDifficultyLabel(round.difficulty), round.difficulty || "default")
  );

  if (round.status === TRIVIA_ROUND_STATUS_LOCKED) {
    chipRowNode.append(createBadge("Answers are locked", "locked"));
  } else if (!revealAnswer && round.status === TRIVIA_ROUND_STATUS_REVEALED) {
    chipRowNode.append(createBadge("Answer reveal is ready", "revealed"));
  } else if (revealAnswer) {
    chipRowNode.append(createBadge("Correct Answer", "correct"));
  } else if (round.status === TRIVIA_ROUND_STATUS_QUESTION_LIVE) {
    chipRowNode.append(createBadge("Choose your answer", "live"));
  }

  questionNode.textContent = round.question;
  headerNode.append(eyebrowNode, titleNode, chipRowNode);
  panelNode.append(headerNode, questionNode, createTriviaOptionsList(round, {
    highlightCorrect: revealAnswer,
  }));
  return panelNode;
}

function createSimpleStatePanel({ eyebrow, title, message, secondaryMessage = "" } = {}) {
  const panelNode = createElement("section", "display-panel display-panel--message");

  panelNode.append(createHeroCopy({
    eyebrow,
    title,
    message,
    secondaryMessage,
  }));
  return panelNode;
}

function createBingoDrawList(orderedDraws) {
  const panelNode = createElement("section", "display-panel display-panel--bingo-history");
  const eyebrowNode = createElement("p", "display-panel__eyebrow");
  const titleNode = createElement("h3", "display-panel__title");
  const listNode = createElement("ol", "display-draw-list");

  eyebrowNode.textContent = "Recent Draws";
  titleNode.textContent = "Latest Bingo Calls";

  orderedDraws.forEach((drawRecord) => {
    const itemNode = createElement("li", "display-draw-list__item");
    const sequenceNode = createElement("strong", "display-draw-list__sequence");
    const copyNode = createElement("span", "display-draw-list__copy");

    sequenceNode.textContent = `${drawRecord.sequence}`;
    copyNode.textContent = drawRecord.name;
    itemNode.append(sequenceNode, copyNode);
    listNode.append(itemNode);
  });

  panelNode.append(eyebrowNode, titleNode, listNode);
  return panelNode;
}

function buildWarningText() {
  const warningTexts = [
    displayUiState?.configWarning,
    displayUiState?.displayStateWarning,
    displayUiState?.triviaRoundWarning,
    displayUiState?.bingoRoundWarning,
    displayUiState?.bingoDrawsWarning,
  ].filter(Boolean);

  return warningTexts.join(" ");
}

function detachBingoDrawsListener({ clearState = true } = {}) {
  if (typeof unsubscribeBingoDrawsListener === "function") {
    unsubscribeBingoDrawsListener();
  }

  unsubscribeBingoDrawsListener = null;

  if (!displayUiState) {
    return;
  }

  displayUiState.activeBingoDrawsRoundId = "";

  if (clearState) {
    displayUiState.bingoDrawsValue = null;
    displayUiState.hasLoadedBingoDraws = false;
    displayUiState.bingoDrawsWarning = "";
  }
}

function renderDisplay() {
  if (!activeDisplayRoot || !displayUiState) {
    return;
  }

  const eventConfig = displayUiState.eventConfig || {};
  const displayState = displayUiState.displayState;
  const screenNode = createElement("section", `display-stage display-stage--${displayState.mode}`);
  const mainWrapNode = createElement("div", "display-stage__content");

  if (
    displayState.mode === DISPLAY_MODE_TRIVIA
    || displayState.mode === DISPLAY_MODE_TRIVIA_REVEAL
    || displayState.mode === DISPLAY_MODE_BINGO
  ) {
    screenNode.append(createBrandBlock(eventConfig, { compact: true }));
  }

  if (displayState.mode === DISPLAY_MODE_WAITING) {
    mainWrapNode.append(
      createBrandBlock(eventConfig),
      createHeroCopy({
        eyebrow: "Welcome",
        title: displayState.statusMessage || DEFAULT_WAITING_STATUS_MESSAGE,
      })
    );
  }

  if (displayState.mode === DISPLAY_MODE_ANNOUNCEMENT) {
    mainWrapNode.append(
      createBrandBlock(eventConfig, { compact: true }),
      createSimpleStatePanel({
        eyebrow: "Announcement",
        title: getDisplayMessageTitle(displayState.announcement, "Announcement"),
        message: displayState.announcement.message || "Announcement details are not available right now.",
      })
    );
  }

  if (displayState.mode === DISPLAY_MODE_WINNER) {
    mainWrapNode.append(
      createBrandBlock(eventConfig, { compact: true }),
      createSimpleStatePanel({
        eyebrow: "Winner",
        title: getDisplayMessageTitle(displayState.winner, "Winner"),
        message: displayState.winner.message || "Winner details are not available right now.",
      })
    );
  }

  if (displayState.mode === DISPLAY_MODE_TRIVIA) {
    const canRenderTrivia = canDisplayTriviaRound(displayUiState.triviaRound)
      && displayState.triviaRoundId
      && displayUiState.triviaRound.roundId === displayState.triviaRoundId;

    if (!canRenderTrivia) {
      mainWrapNode.append(createSimpleStatePanel({
        eyebrow: "Trivia",
        title: "Waiting for the next Trivia question",
        message: "The selected Trivia question is not available right now.",
      }));
    } else {
      mainWrapNode.append(createTriviaRoundView(displayUiState.triviaRound, {
        revealAnswer: displayUiState.triviaRound.status === TRIVIA_ROUND_STATUS_REVEALED,
      }));
    }
  }

  if (displayState.mode === DISPLAY_MODE_TRIVIA_REVEAL) {
    const canRenderTriviaReveal = canDisplayTriviaRevealRound(displayUiState.triviaRound)
      && displayState.triviaRoundId
      && displayUiState.triviaRound.roundId === displayState.triviaRoundId;

    if (!canRenderTriviaReveal) {
      mainWrapNode.append(createSimpleStatePanel({
        eyebrow: "Trivia Reveal",
        title: "Waiting for the answer reveal",
        message: "The Trivia reveal is not available right now.",
      }));
    } else {
      mainWrapNode.append(createTriviaRoundView(displayUiState.triviaRound, {
        revealAnswer: true,
      }));
    }
  }

  if (displayState.mode === DISPLAY_MODE_BINGO) {
    const bingoRound = displayUiState.bingoRound;
    const drawState = normalizeBingoRoundDraws(displayUiState.bingoDrawsValue, bingoRound);
    const bingoPanelNode = createElement("div", "display-bingo-layout");

    if (!hasPreparedBingoRound(bingoRound)) {
      bingoPanelNode.append(createSimpleStatePanel({
        eyebrow: "Bingo",
        title: "Waiting for the next Bingo round",
        message: "The public display is ready for the next Bingo round.",
      }));
    } else if (bingoRound.status === BINGO_ROUND_STATUS_CARDS_OPEN) {
      const openPanelNode = createSimpleStatePanel({
        eyebrow: "Bingo",
        title: "Bingo cards are open",
        message: "Players can still generate, review, and shuffle their cards.",
      });

      openPanelNode.classList.add("display-panel--spotlight");
      bingoPanelNode.append(openPanelNode);
    } else if (bingoRound.status === BINGO_ROUND_STATUS_CARDS_LOCKED) {
      const lockedPanelNode = createSimpleStatePanel({
        eyebrow: "Bingo",
        title: "Bingo cards are locked",
        message: "Waiting for the round to begin.",
      });

      lockedPanelNode.classList.add("display-panel--spotlight");
      bingoPanelNode.append(lockedPanelNode);
    } else if (
      bingoRound.status === BINGO_ROUND_STATUS_IN_PROGRESS
      || bingoRound.status === BINGO_ROUND_STATUS_ENDED
    ) {
      const latestDraw = drawState.lastDraw || bingoRound.lastDraw;
      const infoGridNode = createElement("div", "display-info-grid");
      const recentDraws = drawState.orderedDraws.slice(-RECENT_BINGO_DRAW_COUNT);
      const spotlightPanelNode = createSimpleStatePanel({
        eyebrow: "Bingo",
        title: latestDraw ? latestDraw.name : "Waiting for the next Bingo call",
        message: bingoRound.status === BINGO_ROUND_STATUS_ENDED
          ? "This Bingo round has ended."
          : "Latest Bingo draw",
      });

      spotlightPanelNode.classList.add("display-panel--spotlight");
      bingoPanelNode.append(spotlightPanelNode);

      infoGridNode.append(
        createInfoCard("Draw Count", `${drawState.drawCount}`),
        createInfoCard(
          "Remaining",
          `${Math.max(bingoRound.activePool.length - drawState.drawCount, 0)}`
        ),
        createInfoCard("Status", bingoRound.status === BINGO_ROUND_STATUS_ENDED ? "Ended" : "In Progress")
      );
      bingoPanelNode.append(infoGridNode);

      if (recentDraws.length > 0) {
        bingoPanelNode.append(createBingoDrawList(recentDraws));
      }
    }

    mainWrapNode.append(bingoPanelNode);
  }

  screenNode.append(mainWrapNode);
  activeDisplayRoot.replaceChildren(screenNode);
}

function syncBingoDrawsListener(firebase) {
  if (!displayUiState) {
    return;
  }

  const bingoRound = normalizeBingoCurrentRound(displayUiState.bingoRound);

  if (!hasPreparedBingoRound(bingoRound) || !bingoRound.roundId) {
    detachBingoDrawsListener({ clearState: true });
    renderDisplay();
    return;
  }

  if (
    displayUiState.activeBingoDrawsRoundId === bingoRound.roundId
    && typeof unsubscribeBingoDrawsListener === "function"
  ) {
    return;
  }

  detachBingoDrawsListener({ clearState: true });
  displayUiState.activeBingoDrawsRoundId = bingoRound.roundId;

  unsubscribeBingoDrawsListener = firebase.listenEventData(
    getBingoRoundDrawsPath(bingoRound.roundId),
    (drawsValue, listenerStatus) => {
      if (!displayUiState || displayUiState.activeBingoDrawsRoundId !== bingoRound.roundId) {
        return;
      }

      if (!listenerStatus.ok) {
        if (displayUiState.hasLoadedBingoDraws) {
          displayUiState.bingoDrawsWarning = "Recent Bingo draw updates are temporarily unavailable. Showing the last loaded calls.";
        } else {
          displayUiState.bingoDrawsValue = null;
          displayUiState.bingoDrawsWarning = "Recent Bingo draw updates are temporarily unavailable right now.";
        }

        renderDisplay();
        return;
      }

      displayUiState.bingoDrawsValue = drawsValue;
      displayUiState.hasLoadedBingoDraws = true;
      displayUiState.bingoDrawsWarning = "";
      renderDisplay();
    }
  );
}

export function initDisplayPage({ firebase, state, renderStatus }) {
  cleanupDisplayPageRuntime();

  const displayRoot = document.querySelector(DISPLAY_ROOT_SELECTOR);
  const initialEventConfig = state.getState().eventConfig;

  if (!displayRoot) {
    const missingRootMessage = "Display app container is missing from display.html.";

    renderStatus(missingRootMessage, "warning");
    return {
      statusMessage: missingRootMessage,
    };
  }

  activeDisplayRoot = displayRoot;
  displayUiState = createEmptyDisplayUiState(initialEventConfig);

  if (!hasBoundDisplayBeforeUnload) {
    window.addEventListener("beforeunload", handleDisplayBeforeUnload);
    hasBoundDisplayBeforeUnload = true;
  }

  unsubscribeConfigListener = firebase.listenEventData(CONFIG_PATH, (configValue, listenerStatus) => {
    if (!displayUiState) {
      return;
    }

    if (!listenerStatus.ok) {
      if (displayUiState.hasLoadedConfig) {
        displayUiState.configWarning = "Event branding updates are temporarily unavailable. Showing the last loaded event branding.";
      }

      renderDisplay();
      return;
    }

    displayUiState.eventConfig = configValue && typeof configValue === "object"
      ? {
        ...state.getState().eventConfig,
        ...configValue,
      }
      : state.getState().eventConfig;
    displayUiState.hasLoadedConfig = true;
    displayUiState.configWarning = "";
    displayUiState.displayState = normalizeDisplayState(
      displayUiState.rawDisplayStateValue,
      displayUiState.eventConfig
    );
    renderDisplay();
  });

  unsubscribeDisplayStateListener = firebase.listenEventData(DISPLAY_PATH, (displayValue, listenerStatus) => {
    if (!displayUiState) {
      return;
    }

    if (!listenerStatus.ok) {
      if (displayUiState.hasLoadedDisplayState) {
        displayUiState.displayStateWarning = "Live Display updates are temporarily unavailable. Showing the last loaded Display content.";
      } else {
        displayUiState.displayState = normalizeDisplayState(null, displayUiState.eventConfig);
        displayUiState.displayStateWarning = "Live Display updates are temporarily unavailable. Showing the local Waiting fallback.";
      }

      renderDisplay();
      return;
    }

    displayUiState.rawDisplayStateValue = displayValue;
    displayUiState.displayState = normalizeDisplayState(displayValue, displayUiState.eventConfig);
    displayUiState.hasLoadedDisplayState = true;
    displayUiState.displayStateWarning = displayUiState.displayState.isValid
      ? ""
      : "Some saved Display fields were invalid. Showing the safe normalized Display state.";
    renderDisplay();
  });

  unsubscribeTriviaRoundListener = firebase.listenEventData(TRIVIA_CURRENT_ROUND_PATH, (roundValue, listenerStatus) => {
    if (!displayUiState) {
      return;
    }

    if (!listenerStatus.ok) {
      if (displayUiState.hasLoadedTriviaRound) {
        displayUiState.triviaRoundWarning = "Live Trivia round updates are temporarily unavailable. Showing the last loaded safe Trivia screen where possible.";
      } else {
        displayUiState.triviaRound = normalizeTriviaCurrentRound(null);
        displayUiState.triviaRoundWarning = "Live Trivia round updates are temporarily unavailable right now.";
      }

      renderDisplay();
      return;
    }

    const normalizedRound = normalizeTriviaCurrentRound(roundValue);

    displayUiState.hasLoadedTriviaRound = true;

    if (!normalizedRound.isValid || !hasActiveTriviaRound(normalizedRound)) {
      displayUiState.triviaRound = normalizeTriviaCurrentRound(null);
    } else {
      displayUiState.triviaRound = normalizedRound;
    }

    displayUiState.triviaRoundWarning = normalizedRound.isValid
      ? ""
      : "The current Live Trivia round is invalid, so the public display is showing the safe unavailable state.";
    renderDisplay();
  });

  unsubscribeBingoRoundListener = firebase.listenEventData(BINGO_LIVE_CURRENT_ROUND_PATH, (roundValue, listenerStatus) => {
    if (!displayUiState) {
      return;
    }

    if (!listenerStatus.ok) {
      if (displayUiState.hasLoadedBingoRound) {
        displayUiState.bingoRoundWarning = "Live Bingo round updates are temporarily unavailable. Showing the last loaded safe Bingo state where possible.";
      } else {
        displayUiState.bingoRound = normalizeBingoCurrentRound(null);
        displayUiState.bingoRoundWarning = "Live Bingo round updates are temporarily unavailable right now.";
      }

      renderDisplay();
      return;
    }

    const normalizedRound = normalizeBingoCurrentRound(roundValue);
    const previousRoundId = normalizeTextInput(displayUiState.bingoRound.roundId);
    const nextRoundId = normalizeTextInput(normalizedRound.roundId);
    const didRoundChange = previousRoundId !== nextRoundId;

    displayUiState.hasLoadedBingoRound = true;

    if (!normalizedRound.isValid) {
      displayUiState.bingoRound = normalizeBingoCurrentRound(null);
      displayUiState.bingoRoundWarning = "The current Bingo round is invalid, so the public display is showing the safe Bingo waiting state.";
      detachBingoDrawsListener({ clearState: true });
      renderDisplay();
      return;
    }

    if (didRoundChange || !hasPreparedBingoRound(normalizedRound)) {
      detachBingoDrawsListener({ clearState: true });
    }

    displayUiState.bingoRound = normalizedRound;
    displayUiState.bingoRoundWarning = "";
    syncBingoDrawsListener(firebase);
    renderDisplay();
  });

  renderDisplay();
  renderStatus("Display screen ready for realtime event rendering.", firebase.getStatus().isConnected ? "success" : "warning");

  return {
    statusMessage: "Display screen ready for realtime event rendering.",
  };
}

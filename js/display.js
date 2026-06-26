import {
  BINGO_LIVE_CURRENT_ROUND_PATH,
  BINGO_ROUND_STATUS_CARDS_LOCKED,
  BINGO_ROUND_STATUS_CARDS_OPEN,
  BINGO_ROUND_STATUS_ENDED,
  BINGO_ROUND_STATUS_IN_PROGRESS,
  hasPreparedBingoRound,
  normalizeBingoCurrentRound,
} from "./bingo-pool.js";
import {
  getBingoRoundDrawsPath,
  getBingoRoundWinnersPath,
  normalizeBingoRoundDraws,
  normalizeBingoWinnerRecords,
} from "./bingo-live.js";
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
  getTriviaRoundAnswersPath,
  hasActiveTriviaRound,
  normalizeTriviaAnswerRecord,
  normalizeTriviaCurrentRound,
} from "./trivia-live.js";
import { getPreferredName, isValidAbsoluteHttpUrl, normalizeTextInput } from "./utils.js";

const DISPLAY_ROOT_SELECTOR = "#display-app";
const CONFIG_PATH = "config";
const PLAYERS_PATH = "players";
const DISPLAY_MAX_VISIBLE_TRIVIA_NAMES = 12;
const DISPLAY_MAX_VISIBLE_BINGO_WINNERS = 12;

let activeDisplayRoot = null;
let unsubscribeDisplayStateListener = null;
let unsubscribeConfigListener = null;
let unsubscribeTriviaRoundListener = null;
let unsubscribeBingoRoundListener = null;
let unsubscribeBingoDrawsListener = null;
let unsubscribeTriviaAnswersListener = null;
let unsubscribeBingoWinnersListener = null;
let unsubscribePlayersListener = null;
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
    triviaAnswersValue: null,
    hasLoadedTriviaAnswers: false,
    triviaAnswersWarning: "",
    activeTriviaAnswersRoundId: "",
    bingoWinnersValue: null,
    hasLoadedBingoWinners: false,
    bingoWinnersWarning: "",
    activeBingoWinnersRoundId: "",
    playersValue: null,
    hasLoadedPlayers: false,
    playersWarning: "",
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

  if (typeof unsubscribeTriviaAnswersListener === "function") {
    unsubscribeTriviaAnswersListener();
  }

  if (typeof unsubscribeBingoWinnersListener === "function") {
    unsubscribeBingoWinnersListener();
  }

  if (typeof unsubscribePlayersListener === "function") {
    unsubscribePlayersListener();
  }

  unsubscribeDisplayStateListener = null;
  unsubscribeConfigListener = null;
  unsubscribeTriviaRoundListener = null;
  unsubscribeBingoRoundListener = null;
  unsubscribeBingoDrawsListener = null;
  unsubscribeTriviaAnswersListener = null;
  unsubscribeBingoWinnersListener = null;
  unsubscribePlayersListener = null;

  if (displayUiState) {
    displayUiState.activeBingoDrawsRoundId = "";
    displayUiState.activeTriviaAnswersRoundId = "";
    displayUiState.activeBingoWinnersRoundId = "";
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

function formatCountLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getPublicDisplayName(fullName) {
  return getPreferredName(fullName);
}

function getPlayerNameFromRoster(playerId) {
  if (!displayUiState?.playersValue || typeof displayUiState.playersValue !== "object" || Array.isArray(displayUiState.playersValue)) {
    return "";
  }

  return normalizeTextInput(displayUiState.playersValue[playerId]?.name);
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

function getVisibleItemsWithOverflow(items, limit) {
  const safeItems = Array.isArray(items) ? items.slice() : [];

  return {
    visibleItems: safeItems.slice(0, limit),
    hiddenCount: Math.max(safeItems.length - limit, 0),
  };
}

function getTriviaCorrectAnswerNames(answerRecordsValue, round) {
  const normalizedRound = normalizeTriviaCurrentRound(round);

  if (
    !normalizedRound.isValid
    || !hasActiveTriviaRound(normalizedRound)
    || !Number.isInteger(normalizedRound.correctAnswer)
  ) {
    return [];
  }

  const correctNames = [];

  if (answerRecordsValue && typeof answerRecordsValue === "object" && !Array.isArray(answerRecordsValue)) {
    Object.entries(answerRecordsValue).forEach(([playerIdKey, answerValue]) => {
      const normalizedAnswer = normalizeTriviaAnswerRecord(answerValue, {
        roundId: normalizedRound.roundId,
        playerId: playerIdKey,
      });

      if (!normalizedAnswer.isValid || normalizedAnswer.roundId !== normalizedRound.roundId) {
        return;
      }

      if (normalizedAnswer.answer !== normalizedRound.correctAnswer) {
        return;
      }

      const playerName = getPlayerNameFromRoster(normalizedAnswer.playerId);

      if (!playerName) {
        return;
      }

      correctNames.push(getPublicDisplayName(playerName));
    });
  }

  return correctNames.sort((leftName, rightName) => leftName.localeCompare(rightName));
}

function createResultsBoardEntry({
  name,
  meta = "",
  summary = false,
  highlight = false,
} = {}) {
  const cardNode = createElement("article", "display-results-card");
  const nameNode = createElement("strong", "display-results-card__name");

  if (summary) {
    cardNode.classList.add("display-results-card--summary");
  }

  if (highlight) {
    cardNode.classList.add("display-results-card--highlight");
  }

  nameNode.textContent = name;
  cardNode.append(nameNode);

  if (meta) {
    const metaNode = createElement("span", "display-results-card__meta");

    metaNode.textContent = meta;
    cardNode.append(metaNode);
  }

  return cardNode;
}

function createResultsBoard({
  eyebrow,
  title,
  entries = [],
  emptyMessage,
  overflowLimit,
  blackoutNames = [],
} = {}) {
  const panelNode = createElement("section", "display-panel display-results-board");
  const headerNode = createElement("div", "display-panel__header");
  const eyebrowNode = createElement("p", "display-panel__eyebrow");
  const titleNode = createElement("h3", "display-results-board__title");
  const gridNode = createElement("div", "display-results-grid");
  const { visibleItems, hiddenCount } = getVisibleItemsWithOverflow(entries, overflowLimit);

  eyebrowNode.textContent = eyebrow;
  titleNode.textContent = title;
  headerNode.append(eyebrowNode, titleNode);
  panelNode.append(headerNode);

  if (blackoutNames.length > 0) {
    const blackoutNode = createElement("div", "display-results-blackout");
    const blackoutLabelNode = createElement("span", "display-results-blackout__label");
    const blackoutNamesNode = createElement("div", "display-results-blackout__names");

    blackoutLabelNode.textContent = "BLACKOUT";
    blackoutNames.forEach((name) => {
      const nameNode = createElement("span", "display-results-blackout__name");

      nameNode.textContent = name;
      blackoutNamesNode.append(nameNode);
    });

    blackoutNode.append(blackoutLabelNode, blackoutNamesNode);
    panelNode.append(blackoutNode);
  }

  if (entries.length === 0) {
    const emptyCopyNode = createElement("p", "display-results-empty");

    emptyCopyNode.textContent = emptyMessage;
    panelNode.append(emptyCopyNode);
    return panelNode;
  }

  visibleItems.forEach((entry) => {
    gridNode.append(createResultsBoardEntry(entry));
  });

  if (hiddenCount > 0) {
    gridNode.append(createResultsBoardEntry({
      name: `+${hiddenCount} more`,
      summary: true,
    }));
  }

  panelNode.append(gridNode);
  return panelNode;
}

function createTriviaCorrectAnswersBoard(correctNames) {
  return createResultsBoard({
    eyebrow: "Trivia Results",
    title: "Correct Answers",
    entries: correctNames.map((name) => ({ name })),
    emptyMessage: "No correct answers yet",
    overflowLimit: DISPLAY_MAX_VISIBLE_TRIVIA_NAMES,
  });
}

function createTriviaRoundView(round, { revealAnswer = false, correctAnswerNames = [] } = {}) {
  const stackNode = createElement("div", "display-trivia-stack");
  const panelNode = createElement("section", "display-panel display-panel--trivia");
  const mainColumnNode = createElement("div", "display-trivia-main");
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
  mainColumnNode.append(
    headerNode,
    questionNode,
    createTriviaOptionsList(round, {
      highlightCorrect: revealAnswer,
    })
  );
  panelNode.append(mainColumnNode);
  stackNode.append(panelNode);

  if (revealAnswer) {
    stackNode.append(createTriviaCorrectAnswersBoard(correctAnswerNames));
  }

  return stackNode;
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

function createBingoSpotlightPanel({ latestDrawName, isEnded = false } = {}) {
  const panelNode = createElement("section", "display-panel display-panel--spotlight display-panel--bingo-spotlight");
  const eyebrowNode = createElement("p", "display-panel__eyebrow");
  const titleNode = createElement("h2", "display-bingo-spotlight__name");
  const statusText = isEnded
    ? "Round ended."
    : latestDrawName
      ? ""
      : "Waiting for the first Bingo call.";

  eyebrowNode.textContent = "Latest Draw";
  titleNode.textContent = latestDrawName || "Waiting for the first Bingo call";
  panelNode.append(eyebrowNode, titleNode);

  if (statusText) {
    const statusNode = createElement("p", "display-bingo-spotlight__status");

    statusNode.textContent = statusText;
    panelNode.append(statusNode);
  }

  return panelNode;
}

function getPublicBingoWinnerRows(winnersValue, round) {
  const winnerState = normalizeBingoWinnerRecords(winnersValue, round);

  return winnerState.winnerRecords
    .filter((winnerRecord) => winnerRecord.blackoutWinner === true || winnerRecord.lineWinner === true)
    .map((winnerRecord) => ({
      playerName: getPublicDisplayName(winnerRecord.playerName),
      lineCount: Array.isArray(winnerRecord.completedLines) ? winnerRecord.completedLines.length : 0,
      blackoutWinner: winnerRecord.blackoutWinner === true,
    }))
    .sort((leftWinner, rightWinner) => {
      if (leftWinner.blackoutWinner !== rightWinner.blackoutWinner) {
        return leftWinner.blackoutWinner ? -1 : 1;
      }

      if (leftWinner.lineCount !== rightWinner.lineCount) {
        return rightWinner.lineCount - leftWinner.lineCount;
      }

      return leftWinner.playerName.localeCompare(rightWinner.playerName);
    });
}

function createBingoWinnersPanel(winnerRows) {
  const blackoutWinners = winnerRows.filter((winnerRow) => winnerRow.blackoutWinner === true);

  return createResultsBoard({
    eyebrow: "Bingo Results",
    title: "Line Leaders",
    entries: winnerRows.map((winnerRow) => ({
      name: winnerRow.playerName,
      meta: formatCountLabel(winnerRow.lineCount, "line"),
      highlight: winnerRow.blackoutWinner,
    })),
    emptyMessage: "No line winners yet",
    overflowLimit: DISPLAY_MAX_VISIBLE_BINGO_WINNERS,
    blackoutNames: blackoutWinners.map((winnerRow) => winnerRow.playerName),
  });
  if (blackoutWinners.length > 0) {
    const blackoutNode = createElement("div", "display-bingo-blackout");
    const blackoutLabelNode = createElement("span", "display-bingo-blackout__label");
    const blackoutNamesNode = createElement("div", "display-bingo-blackout__names");

    blackoutLabelNode.textContent = "Blackout";
    blackoutWinners.forEach((winnerRow) => {
      const nameNode = createElement("span", "display-bingo-blackout__name");

      nameNode.textContent = `${winnerRow.playerName} • ${formatCountLabel(winnerRow.lineCount, "line")}`;
      blackoutNamesNode.append(nameNode);
    });
    blackoutNode.append(blackoutLabelNode, blackoutNamesNode);
    panelNode.append(blackoutNode);
  }

}

function buildWarningText() {
  const warningTexts = [
    displayUiState?.configWarning,
    displayUiState?.displayStateWarning,
    displayUiState?.triviaRoundWarning,
    displayUiState?.bingoRoundWarning,
    displayUiState?.bingoDrawsWarning,
    displayUiState?.triviaAnswersWarning,
    displayUiState?.bingoWinnersWarning,
    displayUiState?.playersWarning,
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

function detachTriviaAnswersListener({ clearState = true } = {}) {
  if (typeof unsubscribeTriviaAnswersListener === "function") {
    unsubscribeTriviaAnswersListener();
  }

  unsubscribeTriviaAnswersListener = null;

  if (!displayUiState) {
    return;
  }

  displayUiState.activeTriviaAnswersRoundId = "";

  if (clearState) {
    displayUiState.triviaAnswersValue = null;
    displayUiState.hasLoadedTriviaAnswers = false;
    displayUiState.triviaAnswersWarning = "";
  }
}

function detachBingoWinnersListener({ clearState = true } = {}) {
  if (typeof unsubscribeBingoWinnersListener === "function") {
    unsubscribeBingoWinnersListener();
  }

  unsubscribeBingoWinnersListener = null;

  if (!displayUiState) {
    return;
  }

  displayUiState.activeBingoWinnersRoundId = "";

  if (clearState) {
    displayUiState.bingoWinnersValue = null;
    displayUiState.hasLoadedBingoWinners = false;
    displayUiState.bingoWinnersWarning = "";
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
      const revealAnswer = displayUiState.triviaRound.status === TRIVIA_ROUND_STATUS_REVEALED;

      mainWrapNode.append(createTriviaRoundView(displayUiState.triviaRound, {
        revealAnswer,
        correctAnswerNames: revealAnswer
          ? getTriviaCorrectAnswerNames(displayUiState.triviaAnswersValue, displayUiState.triviaRound)
          : [],
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
        correctAnswerNames: getTriviaCorrectAnswerNames(
          displayUiState.triviaAnswersValue,
          displayUiState.triviaRound
        ),
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
        message: "Get your card ready.",
      });

      openPanelNode.classList.add("display-panel--spotlight");
      bingoPanelNode.append(openPanelNode);
    } else if (bingoRound.status === BINGO_ROUND_STATUS_CARDS_LOCKED) {
      const lockedPanelNode = createSimpleStatePanel({
        eyebrow: "Bingo",
        title: "Bingo cards are locked",
        message: "Bingo is about to begin.",
      });

      lockedPanelNode.classList.add("display-panel--spotlight");
      bingoPanelNode.append(lockedPanelNode);
    } else if (
      bingoRound.status === BINGO_ROUND_STATUS_IN_PROGRESS
      || bingoRound.status === BINGO_ROUND_STATUS_ENDED
    ) {
      const latestDraw = drawState.lastDraw || bingoRound.lastDraw;
      const winnerRows = getPublicBingoWinnerRows(displayUiState.bingoWinnersValue, bingoRound);
      const spotlightPanelNode = createBingoSpotlightPanel({
        latestDrawName: latestDraw?.name || "",
        isEnded: bingoRound.status === BINGO_ROUND_STATUS_ENDED,
      });

      spotlightPanelNode.classList.add("display-panel--spotlight");
      bingoPanelNode.append(spotlightPanelNode);
      bingoPanelNode.append(createBingoWinnersPanel(winnerRows));
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

function syncTriviaAnswersListener(firebase) {
  if (!displayUiState) {
    return;
  }

  const triviaRound = normalizeTriviaCurrentRound(displayUiState.triviaRound);

  if (!hasActiveTriviaRound(triviaRound) || !triviaRound.roundId) {
    detachTriviaAnswersListener({ clearState: true });
    renderDisplay();
    return;
  }

  if (
    displayUiState.activeTriviaAnswersRoundId === triviaRound.roundId
    && typeof unsubscribeTriviaAnswersListener === "function"
  ) {
    return;
  }

  detachTriviaAnswersListener({ clearState: true });
  displayUiState.activeTriviaAnswersRoundId = triviaRound.roundId;

  unsubscribeTriviaAnswersListener = firebase.listenEventData(
    getTriviaRoundAnswersPath(triviaRound.roundId),
    (answersValue, listenerStatus) => {
      if (!displayUiState || displayUiState.activeTriviaAnswersRoundId !== triviaRound.roundId) {
        return;
      }

      if (!listenerStatus.ok) {
        if (displayUiState.hasLoadedTriviaAnswers) {
          displayUiState.triviaAnswersWarning = "Correct-answer name updates are temporarily unavailable. Showing the last loaded names.";
        } else {
          displayUiState.triviaAnswersValue = null;
          displayUiState.triviaAnswersWarning = "Correct-answer names are temporarily unavailable right now.";
        }

        renderDisplay();
        return;
      }

      displayUiState.triviaAnswersValue = answersValue;
      displayUiState.hasLoadedTriviaAnswers = true;
      displayUiState.triviaAnswersWarning = "";
      renderDisplay();
    }
  );
}

function syncBingoWinnersListener(firebase) {
  if (!displayUiState) {
    return;
  }

  const bingoRound = normalizeBingoCurrentRound(displayUiState.bingoRound);

  if (!hasPreparedBingoRound(bingoRound) || !bingoRound.roundId) {
    detachBingoWinnersListener({ clearState: true });
    renderDisplay();
    return;
  }

  if (
    displayUiState.activeBingoWinnersRoundId === bingoRound.roundId
    && typeof unsubscribeBingoWinnersListener === "function"
  ) {
    return;
  }

  detachBingoWinnersListener({ clearState: true });
  displayUiState.activeBingoWinnersRoundId = bingoRound.roundId;

  unsubscribeBingoWinnersListener = firebase.listenEventData(
    getBingoRoundWinnersPath(bingoRound.roundId),
    (winnersValue, listenerStatus) => {
      if (!displayUiState || displayUiState.activeBingoWinnersRoundId !== bingoRound.roundId) {
        return;
      }

      if (!listenerStatus.ok) {
        if (displayUiState.hasLoadedBingoWinners) {
          displayUiState.bingoWinnersWarning = "Bingo winner updates are temporarily unavailable. Showing the last loaded winners.";
        } else {
          displayUiState.bingoWinnersValue = null;
          displayUiState.bingoWinnersWarning = "Bingo winners are temporarily unavailable right now.";
        }

        renderDisplay();
        return;
      }

      displayUiState.bingoWinnersValue = winnersValue;
      displayUiState.hasLoadedBingoWinners = true;
      displayUiState.bingoWinnersWarning = "";
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

  unsubscribePlayersListener = firebase.listenEventData(PLAYERS_PATH, (playersValue, listenerStatus) => {
    if (!displayUiState) {
      return;
    }

    if (!listenerStatus.ok) {
      if (displayUiState.hasLoadedPlayers) {
        displayUiState.playersWarning = "Player name updates are temporarily unavailable. Showing the last loaded public names.";
      } else {
        displayUiState.playersValue = null;
        displayUiState.playersWarning = "Player names are temporarily unavailable right now.";
      }

      renderDisplay();
      return;
    }

    displayUiState.playersValue = playersValue;
    displayUiState.hasLoadedPlayers = true;
    displayUiState.playersWarning = "";
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
        detachTriviaAnswersListener({ clearState: true });
      }

      renderDisplay();
      return;
    }

    const normalizedRound = normalizeTriviaCurrentRound(roundValue);

    displayUiState.hasLoadedTriviaRound = true;

    if (!normalizedRound.isValid || !hasActiveTriviaRound(normalizedRound)) {
      displayUiState.triviaRound = normalizeTriviaCurrentRound(null);
      detachTriviaAnswersListener({ clearState: true });
    } else {
      displayUiState.triviaRound = normalizedRound;
      syncTriviaAnswersListener(firebase);
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
      detachBingoWinnersListener({ clearState: true });
      renderDisplay();
      return;
    }

    if (didRoundChange || !hasPreparedBingoRound(normalizedRound)) {
      detachBingoDrawsListener({ clearState: true });
      detachBingoWinnersListener({ clearState: true });
    }

    displayUiState.bingoRound = normalizedRound;
    displayUiState.bingoRoundWarning = "";
    syncBingoDrawsListener(firebase);
    syncBingoWinnersListener(firebase);
    renderDisplay();
  });

  renderDisplay();
  renderStatus("Display screen ready for realtime event rendering.", firebase.getStatus().isConnected ? "success" : "warning");

  return {
    statusMessage: "Display screen ready for realtime event rendering.",
  };
}

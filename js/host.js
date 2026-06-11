import { initTriviaModule } from "./trivia.js";
import { initBingoModule } from "./bingo.js";
import {
  BINGO_CARD_ITEM_COUNT,
  BINGO_LIVE_CURRENT_ROUND_PATH,
  BINGO_RECOMMENDED_MINIMUM_POOL_SIZE,
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
import { escapeHtml } from "./utils.js";

const HOST_ROOT_SELECTOR = "#host-app";

const HOST_RESERVED_CARDS = [
  {
    title: "Display Screen",
    description: "Future display coordination shortcuts will appear here for live event use.",
  },
  {
    title: "Announcements",
    description: "Future host-only announcement tools will be added in a later slice.",
  },
];

const HOST_FILTER_DEFINITIONS = [
  { key: "all", label: "All" },
  { key: "easy", label: "Easy" },
  { key: "medium", label: "Medium" },
  { key: "hard", label: "Hard" },
];

let activeHostRoot = null;
let activeHostClickHandler = null;
let unsubscribeTriviaPoolListener = null;
let unsubscribeCurrentRoundListener = null;
let unsubscribeHostAnswersListener = null;
let unsubscribeBingoSourcePoolListener = null;
let unsubscribeBingoCurrentRoundListener = null;
let unsubscribeRegisteredPlayersListener = null;
let hasBoundHostBeforeUnload = false;

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
    showAnswer = true,
    showSelectAction = false,
    isSelected = false,
    selectActionLabel = "Select Question",
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

  questionNode.className = "hub-panel trivia-question-card";
  questionNode.dataset.questionId = question.id;
  questionNode.dataset.selected = isSelected ? "true" : "false";
  headerNode.className = "trivia-question-header";
  headingNode.textContent = question.id;
  badgeNode.className = "trivia-difficulty-badge";
  badgeNode.dataset.difficulty = question.difficulty;
  badgeNode.textContent = question.difficulty;
  questionCopyNode.className = "trivia-question-copy";
  questionCopyNode.textContent = question.question;

  headerNode.append(headingNode, badgeNode);
  questionNode.append(
    headerNode,
    createTriviaQuestionMetaRow("Difficulty", question.difficulty),
    questionCopyNode,
    createTriviaOptionsList(question)
  );

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

  if (typeof unsubscribeBingoSourcePoolListener === "function") {
    unsubscribeBingoSourcePoolListener();
  }

  if (typeof unsubscribeBingoCurrentRoundListener === "function") {
    unsubscribeBingoCurrentRoundListener();
  }

  if (typeof unsubscribeRegisteredPlayersListener === "function") {
    unsubscribeRegisteredPlayersListener();
  }

  unsubscribeTriviaPoolListener = null;
  unsubscribeCurrentRoundListener = null;
  unsubscribeHostAnswersListener = null;
  unsubscribeBingoSourcePoolListener = null;
  unsubscribeBingoCurrentRoundListener = null;
  unsubscribeRegisteredPlayersListener = null;

  if (activeHostRoot && activeHostClickHandler) {
    activeHostRoot.removeEventListener("click", activeHostClickHandler);
  }

  activeHostRoot = null;
  activeHostClickHandler = null;
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
    randomPreviewQuestionId: "",
    selectedQuestionId: "",
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
    if (hostUiState.activeDifficultyFilter === "all") {
      return hostUiState.questionPool.orderedQuestions.slice();
    }

    return hostUiState.questionPool.orderedQuestions.filter(
      (question) => question.difficulty === hostUiState.activeDifficultyFilter
    );
  }

  function getRandomPreviewQuestion() {
    if (!hostUiState.randomPreviewQuestionId) {
      return null;
    }

    return hostUiState.questionPool.orderedQuestions.find(
      (question) => question.id === hostUiState.randomPreviewQuestionId
    ) || null;
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

    [
      createCountDefinition("Easy", hostUiState.questionPool.counts.easy),
      createCountDefinition("Medium", hostUiState.questionPool.counts.medium),
      createCountDefinition("Hard", hostUiState.questionPool.counts.hard),
      createCountDefinition("Total", hostUiState.questionPool.counts.total),
    ].forEach((countDefinition) => {
      const countNode = document.createElement("article");
      const valueNode = document.createElement("strong");
      const labelNode = document.createElement("span");

      countNode.className = "trivia-count-card";
      valueNode.textContent = countDefinition.value;
      labelNode.textContent = countDefinition.label;
      countNode.append(valueNode, labelNode);
      countsNode.append(countNode);
    });
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

    statsPanelNode.className = "trivia-answer-stats";
    headerNode.className = "player-section-header";
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

    const summaryGridNode = document.createElement("div");
    const answersTotalNode = document.createElement("article");
    const totalValueNode = document.createElement("strong");
    const totalLabelNode = document.createElement("span");

    summaryGridNode.className = "trivia-count-grid";
    answersTotalNode.className = "trivia-count-card";
    totalValueNode.textContent = String(hostUiState.answerStats.totalSubmitted);
    totalLabelNode.textContent = "Submitted";
    answersTotalNode.append(totalValueNode, totalLabelNode);
    summaryGridNode.append(answersTotalNode);
    statsPanelNode.append(summaryGridNode);

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

    [
      { label: "Registered Players", value: hostUiState.registeredPlayerCount },
      { label: "Source Pool", value: hostUiState.bingoSourcePool.count },
      { label: "Target Pool", value: getCurrentBingoTargetPoolSize() },
      {
        label: "Can Meet Target",
        value: hostUiState.bingoSourcePool.count >= getCurrentBingoTargetPoolSize() ? "Yes" : "No",
      },
    ].forEach((countDefinition) => {
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

    roundPanelNode.append(
      createTriviaQuestionMetaRow("Prepared", formatUpdatedAt(hostUiState.bingoCurrentRound.preparedAt)),
      createTriviaQuestionMetaRow("Player Count", String(hostUiState.bingoCurrentRound.playerCountAtPreparation)),
      createTriviaQuestionMetaRow("Target Pool Size", String(hostUiState.bingoCurrentRound.targetPoolSize)),
      createTriviaQuestionMetaRow("Actual Pool Size", String(hostUiState.bingoCurrentRound.actualPoolSize)),
      createTriviaQuestionMetaRow("Cards Locked", hostUiState.bingoCurrentRound.cardsLocked ? "Yes" : "No")
    );

    roundNode.append(roundPanelNode);
  }

  function renderBingoPreparationActions(actionsNode) {
    if (!actionsNode) {
      return;
    }

    const cannotPrepare = hostUiState.isPreparingBingoRound
      || !hostUiState.hasLoadedBingoSourcePool
      || !hostUiState.hasLoadedRegisteredPlayers
      || !hostUiState.hasLoadedBingoCurrentRound;

    actionsNode.innerHTML = `
      <button
        type="button"
        class="primary-button"
        data-action="prepare-bingo-round"
        ${cannotPrepare ? "disabled" : ""}
      >
        ${hostUiState.isPreparingBingoRound ? "Preparing Bingo Round..." : "Prepare New Bingo Card Round"}
      </button>
    `;
  }

  function renderHostTriviaController() {
    const contentNode = getActiveContentNode();

    if (!contentNode) {
      return;
    }

    const lastSavedLabel = formatUpdatedAt(hostUiState.questionPool.updatedAt);

    contentNode.innerHTML = `
      <div class="admin-sections">
        <section class="player-section admin-section">
          <div class="player-section-header">
            <div>
              <p class="eyebrow">Live Trivia Controller</p>
              <h3>Run the Current Trivia Round</h3>
              <p class="player-copy">Select a saved Trivia question, push it live, watch realtime answer totals, then lock, reveal, or clear the round.</p>
            </div>
          </div>
          <div data-host-live-notices></div>
          <div data-host-selected-question></div>
          <div class="admin-button-row trivia-live-actions" data-host-live-actions></div>
          <div data-host-current-round></div>
          <div data-host-answer-stats></div>
        </section>

        <section class="player-section admin-section">
          <div class="player-section-header">
            <div>
              <p class="eyebrow">Trivia Question Browser</p>
              <h3>Saved Question Pool</h3>
              <p class="player-copy">Browse and filter the saved Trivia Question Pool. The latest realtime pool is the source of truth for every push.</p>
            </div>
          </div>
          <div class="trivia-count-grid" data-host-trivia-counts></div>
          <p class="admin-meta">Last saved: <span data-host-trivia-updated-at>${escapeHtml(lastSavedLabel)}</span></p>
          <div data-host-trivia-status></div>
          <div class="trivia-toolbar" role="toolbar" aria-label="Filter trivia questions">
            ${HOST_FILTER_DEFINITIONS.map((filterDefinition) => `
              <button
                type="button"
                class="hub-button trivia-filter-button"
                data-action="filter-trivia-questions"
                data-difficulty="${filterDefinition.key}"
                aria-pressed="${hostUiState.activeDifficultyFilter === filterDefinition.key ? "true" : "false"}"
              >
                ${escapeHtml(filterDefinition.label)}
              </button>
            `).join("")}
          </div>
          <div class="trivia-toolbar trivia-random-actions" role="toolbar" aria-label="Random trivia preview">
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
          <div class="trivia-question-list" data-host-trivia-questions></div>
        </section>

        <section class="player-section admin-section">
          <div class="player-section-header">
            <div>
              <p class="eyebrow">Bingo Round Preparation</p>
              <h3>Bingo Round Preparation</h3>
              <p class="player-copy">Prepare a shared Bingo card round using the current registered player count and the saved Bingo bottle pool. Pool size is calculated automatically for this event.</p>
            </div>
          </div>
          <div data-host-bingo-notices></div>
          <div class="trivia-count-grid" data-host-bingo-counts></div>
          <div class="admin-button-row" data-host-bingo-actions></div>
          <div data-host-bingo-current-round></div>
        </section>

        <section class="player-section admin-section">
          <div>
            <p class="eyebrow">Reserved Host Areas</p>
            <h3>Future Host Modules</h3>
            <p class="player-copy">These controls stay reserved for later slices.</p>
          </div>
          <div class="placeholder-grid">
            ${renderReservedCards(HOST_RESERVED_CARDS)}
          </div>
        </section>
      </div>
    `;

    renderControllerNotices(contentNode.querySelector("[data-host-live-notices]"));
    renderSelectedQuestionPreview(contentNode.querySelector("[data-host-selected-question]"));
    renderActionButtons(contentNode.querySelector("[data-host-live-actions]"));
    renderCurrentRoundPanel(contentNode.querySelector("[data-host-current-round]"));
    renderAnswerStats(contentNode.querySelector("[data-host-answer-stats]"));
    renderCounts(contentNode.querySelector("[data-host-trivia-counts]"));
    renderPoolStatusNotice(contentNode.querySelector("[data-host-trivia-status]"));
    renderQuestionList(contentNode.querySelector("[data-host-trivia-questions]"));
    renderRandomPreview(contentNode.querySelector("[data-host-random-preview]"));
    renderBingoPreparationNotices(contentNode.querySelector("[data-host-bingo-notices]"));
    renderBingoPreparationCounts(contentNode.querySelector("[data-host-bingo-counts]"));
    renderBingoPreparationActions(contentNode.querySelector("[data-host-bingo-actions]"));
    renderBingoCurrentRoundPanel(contentNode.querySelector("[data-host-bingo-current-round]"));
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

      hostUiState.registeredPlayerCount = countRegisteredPlayers(playersValue);
      hostUiState.hasLoadedRegisteredPlayers = true;
      hostUiState.isRegisteredPlayersLoading = false;
      hostUiState.registeredPlayersUnavailableMessage = "";
      hostUiState.registeredPlayersWarning = "";
      renderHostTriviaController();
    });
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
          }

          renderHostTriviaController();
          return;
        }

        hostUiState.bingoCurrentRound = normalizedRound;
        hostUiState.hasLoadedBingoCurrentRound = true;
        hostUiState.isBingoCurrentRoundLoading = false;
        hostUiState.bingoCurrentRoundUnavailableMessage = "";
        hostUiState.bingoCurrentRoundWarning = "";
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

    hostUiState.bingoCurrentRound = normalizeBingoCurrentRound(nextRoundPayload);
    hostUiState.hasLoadedBingoCurrentRound = true;
    hostUiState.isBingoCurrentRoundLoading = false;
    hostUiState.bingoCurrentRoundUnavailableMessage = "";
    hostUiState.bingoCurrentRoundWarning = "";

    if (freshSourcePool.count < targetPoolSize) {
      setBingoPreparationMessage(
        `Bingo round prepared with ${freshSourcePool.count} items because the current pool could not meet the ${targetPoolSize}-item target.`,
        "warning"
      );
    } else {
      setBingoPreparationMessage(
        `Bingo round prepared for ${freshPlayerCount} registered players with a ${targetPoolSize}-item active pool.`,
        "success"
      );
    }

    renderHostTriviaController();
  }

  function ensureHostClickHandler(rootNode) {
    if (activeHostRoot === rootNode && activeHostClickHandler) {
      return;
    }

    if (activeHostRoot && activeHostClickHandler) {
      activeHostRoot.removeEventListener("click", activeHostClickHandler);
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

      if (action === "filter-trivia-questions") {
        hostUiState.activeDifficultyFilter = actionNode.dataset.difficulty || "all";
        renderHostTriviaController();
        return;
      }

      if (action === "preview-random-trivia") {
        const randomQuestion = getRandomQuestion(
          hostUiState.questionPool.orderedQuestions,
          actionNode.dataset.difficulty || "all"
        );

        hostUiState.randomPreviewQuestionId = randomQuestion?.id || "";
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
        if (hostUiState.isPreparingBingoRound) {
          return;
        }

        await prepareBingoRound();
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

    rootNode.addEventListener("click", activeHostClickHandler);
    activeHostRoot = rootNode;
  }

  return initRoleProtectedPage({
    role: "host",
    rootSelector: HOST_ROOT_SELECTOR,
    state,
    firebase,
    renderStatus,
    pinFieldName: "hostPin",
    lockedIntroCopy: "Enter the Host PIN to unlock live event and display controls for this browser session.",
    shellTitle: "Host Console",
    shellCopy: "Host access is limited to live event operations and display coordination. Admin-only settings, exports, and destructive tools stay locked out.",
    setupCopy: "Host PIN setup is required before this page can be unlocked.",
    placeholderCards: HOST_RESERVED_CARDS,
    onUnlock() {
      initTriviaModule({ firebase, state, role: "host" });
      initBingoModule({ firebase, state, role: "host" });
    },
    onRenderUnlocked({ rootNode }) {
      ensureHostClickHandler(rootNode);
      attachTriviaQuestionPoolListener();
      attachCurrentRoundListener();
      attachBingoSourcePoolListener();
      attachRegisteredPlayersListener();
      attachBingoCurrentRoundListener();
      renderHostTriviaController();
    },
  });
}

import { initTriviaModule } from "./trivia.js";
import { initBingoModule } from "./bingo.js";
import { initRoleProtectedPage } from "./role-access.js";
import {
  getRandomQuestion,
  normalizeTriviaQuestionPool,
  TRIVIA_QUESTION_POOL_PATH,
} from "./trivia-pool.js";
import { escapeHtml } from "./utils.js";

const HOST_ROOT_SELECTOR = "#host-app";

const HOST_RESERVED_CARDS = [
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

const HOST_FILTER_DEFINITIONS = [
  { key: "all", label: "All" },
  { key: "easy", label: "Easy" },
  { key: "medium", label: "Medium" },
  { key: "hard", label: "Hard" },
];

let activeHostRoot = null;
let activeHostClickHandler = null;
let unsubscribeTriviaPoolListener = null;
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

    optionNode.textContent = `${optionIndex}. ${optionValue}`;
    listNode.append(optionNode);
  });

  return listNode;
}

function createTriviaQuestionCard(question, { showHeading = true } = {}) {
  const questionNode = document.createElement("article");
  const headerNode = document.createElement("div");
  const headingNode = document.createElement(showHeading ? "h4" : "h3");
  const badgeNode = document.createElement("span");
  const questionCopyNode = document.createElement("p");
  const answerNode = document.createElement("p");

  questionNode.className = "hub-panel trivia-question-card";
  headerNode.className = "trivia-question-header";
  headingNode.textContent = question.id;
  badgeNode.className = "trivia-difficulty-badge";
  badgeNode.dataset.difficulty = question.difficulty;
  badgeNode.textContent = question.difficulty;
  questionCopyNode.className = "trivia-question-copy";
  questionCopyNode.textContent = question.question;
  answerNode.className = "trivia-answer-note";
  answerNode.textContent = `Correct answer: ${question.answer} (${question.options[question.answer]})`;

  headerNode.append(headingNode, badgeNode);
  questionNode.append(
    headerNode,
    createTriviaQuestionMetaRow("Difficulty", question.difficulty),
    questionCopyNode,
    createTriviaOptionsList(question),
    answerNode
  );

  return questionNode;
}

function cleanupHostQuestionBrowser() {
  if (typeof unsubscribeTriviaPoolListener === "function") {
    unsubscribeTriviaPoolListener();
  }

  unsubscribeTriviaPoolListener = null;

  if (activeHostRoot && activeHostClickHandler) {
    activeHostRoot.removeEventListener("click", activeHostClickHandler);
  }

  activeHostRoot = null;
  activeHostClickHandler = null;
}

function handleHostBeforeUnload() {
  cleanupHostQuestionBrowser();
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
  };

  cleanupHostQuestionBrowser();

  if (!hasBoundHostBeforeUnload) {
    window.addEventListener("beforeunload", handleHostBeforeUnload);
    hasBoundHostBeforeUnload = true;
  }

  function getActiveContentNode() {
    return hostRoot?.querySelector("[data-role-content]") || null;
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

  function renderStatusNotice(statusNode) {
    if (!statusNode) {
      return;
    }

    statusNode.innerHTML = "";

    if (hostUiState.isQuestionPoolLoading && !hostUiState.hasLoadedQuestionPool) {
      const loadingNode = document.createElement("div");

      loadingNode.className = "notice-panel";
      loadingNode.dataset.tone = "info";
      loadingNode.textContent = "Loading the current Trivia question pool...";
      statusNode.append(loadingNode);
      return;
    }

    if (hostUiState.questionPoolUnavailableMessage && !hostUiState.hasLoadedQuestionPool) {
      const unavailableNode = document.createElement("div");

      unavailableNode.className = "notice-panel";
      unavailableNode.dataset.tone = "warning";
      unavailableNode.textContent = hostUiState.questionPoolUnavailableMessage;
      statusNode.append(unavailableNode);
      return;
    }

    if (hostUiState.questionPoolWarning) {
      const warningNode = document.createElement("div");

      warningNode.className = "notice-panel";
      warningNode.dataset.tone = "warning";
      warningNode.textContent = hostUiState.questionPoolWarning;
      statusNode.append(warningNode);
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
      questionListNode.append(createTriviaQuestionCard(question));
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

  function renderHostQuestionBrowser() {
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
              <p class="eyebrow">Trivia Question Browser</p>
              <h3>Trivia Question Browser</h3>
              <p class="player-copy">Browse the saved Trivia Question Pool after Host PIN unlock. Live Trivia controls, pushes, lock/reveal, and player answering stay out of this slice.</p>
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

    renderCounts(contentNode.querySelector("[data-host-trivia-counts]"));
    renderStatusNotice(contentNode.querySelector("[data-host-trivia-status]"));
    renderQuestionList(contentNode.querySelector("[data-host-trivia-questions]"));
    renderRandomPreview(contentNode.querySelector("[data-host-random-preview]"));
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

          renderHostQuestionBrowser();
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

          renderHostQuestionBrowser();
          return;
        }

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

        renderHostQuestionBrowser();
      }
    );
  }

  function ensureHostClickHandler(rootNode) {
    if (activeHostRoot === rootNode && activeHostClickHandler) {
      return;
    }

    if (activeHostRoot && activeHostClickHandler) {
      activeHostRoot.removeEventListener("click", activeHostClickHandler);
    }

    activeHostClickHandler = (event) => {
      const actionNode = event.target.closest("[data-action]");

      if (!actionNode) {
        return;
      }

      const action = actionNode.dataset.action;

      if (action === "lock-role") {
        cleanupHostQuestionBrowser();
        return;
      }

      if (action === "filter-trivia-questions") {
        hostUiState.activeDifficultyFilter = actionNode.dataset.difficulty || "all";
        renderHostQuestionBrowser();
        return;
      }

      if (action === "preview-random-trivia") {
        const randomQuestion = getRandomQuestion(
          hostUiState.questionPool.orderedQuestions,
          actionNode.dataset.difficulty || "all"
        );

        hostUiState.randomPreviewQuestionId = randomQuestion?.id || "";
        renderHostQuestionBrowser();
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
      renderHostQuestionBrowser();
    },
  });
}

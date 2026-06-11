import { initTriviaModule } from "./trivia.js";
import { initBingoModule } from "./bingo.js";
import {
  DEFAULT_PUBLIC_BOTTLE_LIST_TITLE,
  hasBottleListItems,
  normalizeBottleList,
  PLAYER_EMPTY_BOTTLE_LIST_MESSAGE,
  PUBLIC_BOTTLE_LIST_PATH,
} from "./bottle-list.js";
import {
  buildTriviaAnswerPayload,
  createEmptyTriviaAnswerRecord,
  getTriviaPlayerAnswerPath,
  getTriviaRoundStatusLabel,
  hasActiveTriviaRound,
  isTriviaRoundLive,
  isValidTriviaAnswerForRound,
  normalizeTriviaAnswerRecord,
  normalizeTriviaCurrentRound,
  TRIVIA_CURRENT_ROUND_PATH,
  TRIVIA_ROUND_STATUS_LOCKED,
  TRIVIA_ROUND_STATUS_QUESTION_LIVE,
  TRIVIA_ROUND_STATUS_REVEALED,
} from "./trivia-live.js";
import {
  escapeHtml,
  getOrCreateDeviceId,
  getPreferredName,
  isValidAbsoluteHttpUrl,
  isValidEmail,
  normalizeEmailInput,
  normalizeTextInput,
} from "./utils.js";
import {
  MISSING_STATIC_PAGE_MESSAGE,
  REVIEW_LINK_DEFINITIONS,
  STATIC_PAGE_DEFINITIONS,
  hasStaticPageContent,
  normalizeReviewLinks,
  normalizeStaticPages,
} from "./static-pages.js";

const PLAYER_ROOT_SELECTOR = "#player-app";
const PLAYER_TRIVIA_WAITING_MESSAGE = "Waiting for the next Trivia question...";

let unsubscribePagesListener = null;
let unsubscribeReviewLinksListener = null;
let unsubscribeBottleListListener = null;
let unsubscribePlayerTriviaRoundListener = null;
let unsubscribePlayerTriviaAnswerListener = null;
let activePlayerRoot = null;
let activePlayerClickHandler = null;
let activePlayerSubmitHandler = null;
let hasBoundPlayerBeforeUnload = false;

const HUB_PANELS = [
  {
    id: "trivia",
    label: "Trivia",
    title: "Trivia",
    message: "Open Trivia to see the current live question, answer while it is live, and review the reveal.",
    kind: "trivia",
  },
  {
    id: "bingo",
    label: "Bingo",
    title: "Bingo",
    message: "Bingo is coming in the next slice.",
    kind: "placeholder",
  },
  {
    id: "bottle-list",
    label: "Bottle List",
    title: "Bottle List",
    message: "View the posted public bottle list for this event.",
    kind: "bottle-list",
  },
  ...STATIC_PAGE_DEFINITIONS.map((pageDefinition) => ({
    id: pageDefinition.hubPanelId,
    label: pageDefinition.label,
    title: pageDefinition.defaultTitle,
    message: `${pageDefinition.label} is ready to view from Firebase content.`,
    kind: "static-page",
    pageKey: pageDefinition.key,
  })),
  {
    id: "leave-review",
    label: "Leave Review",
    title: "Leave Review",
    message: "Choose a review destination when links have been configured for this event.",
    kind: "review-links",
  },
];

const DEFAULT_HUB_PANEL_ID = HUB_PANELS[0].id;

function clearPlayerContentListeners() {
  if (typeof unsubscribePagesListener === "function") {
    unsubscribePagesListener();
  }

  if (typeof unsubscribeReviewLinksListener === "function") {
    unsubscribeReviewLinksListener();
  }

  if (typeof unsubscribeBottleListListener === "function") {
    unsubscribeBottleListListener();
  }

  unsubscribePagesListener = null;
  unsubscribeReviewLinksListener = null;
  unsubscribeBottleListListener = null;
}

function clearPlayerTriviaListeners() {
  if (typeof unsubscribePlayerTriviaRoundListener === "function") {
    unsubscribePlayerTriviaRoundListener();
  }

  if (typeof unsubscribePlayerTriviaAnswerListener === "function") {
    unsubscribePlayerTriviaAnswerListener();
  }

  unsubscribePlayerTriviaRoundListener = null;
  unsubscribePlayerTriviaAnswerListener = null;
}

function cleanupPlayerPageRuntime() {
  clearPlayerContentListeners();
  clearPlayerTriviaListeners();

  if (activePlayerRoot && activePlayerClickHandler) {
    activePlayerRoot.removeEventListener("click", activePlayerClickHandler);
  }

  if (activePlayerRoot && activePlayerSubmitHandler) {
    activePlayerRoot.removeEventListener("submit", activePlayerSubmitHandler);
  }

  activePlayerRoot = null;
  activePlayerClickHandler = null;
  activePlayerSubmitHandler = null;
}

function handlePlayerBeforeUnload() {
  cleanupPlayerPageRuntime();
}

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

function isStaticPagePanel(panel) {
  return panel?.kind === "static-page";
}

function isReviewLinksPanel(panel) {
  return panel?.kind === "review-links";
}

function isBottleListPanel(panel) {
  return panel?.kind === "bottle-list";
}

function isTriviaPanel(panel) {
  return panel?.kind === "trivia";
}

function shouldOpenHubDetailPanel(panel) {
  return isTriviaPanel(panel)
    || isStaticPagePanel(panel)
    || isReviewLinksPanel(panel)
    || isBottleListPanel(panel);
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

function renderHubSummary(activePanel) {
  return `
    <section class="hub-panel" aria-live="polite">
      <h3>${escapeHtml(activePanel.title)}</h3>
      <p>${escapeHtml(activePanel.message)}</p>
    </section>
  `;
}

function renderTriviaDetail() {
  return `
    <section class="player-section">
      <div class="player-section-header">
        <div>
          <p class="eyebrow">Event Hub</p>
          <h2>Trivia</h2>
          <p class="player-copy">Watch for the live question, answer while it is open, and check the reveal when the Host finishes the round.</p>
        </div>
        <button type="button" class="text-link-button" data-action="back-to-hub">Back to Event Hub</button>
      </div>
      <div class="trivia-live-detail">
        <div data-player-trivia-status></div>
        <div data-player-trivia-panel></div>
      </div>
    </section>
  `;
}

function renderStaticPageDetail() {
  return `
    <section class="player-section">
      <div class="player-section-header">
        <div>
          <p class="eyebrow">Event Hub</p>
          <h2 data-static-page-title></h2>
        </div>
        <button type="button" class="text-link-button" data-action="back-to-hub">Back to Event Hub</button>
      </div>
      <div class="hub-panel static-page-panel">
        <p class="static-page-content" data-static-page-content></p>
      </div>
    </section>
  `;
}

function renderReviewDetail() {
  return `
    <section class="player-section">
      <div class="player-section-header">
        <div>
          <p class="eyebrow">Event Hub</p>
          <h2>Leave Review</h2>
          <p class="player-copy">Choose the review destination you want to use. Unavailable links stay disabled until Admin posts them.</p>
        </div>
        <button type="button" class="text-link-button" data-action="back-to-hub">Back to Event Hub</button>
      </div>
      <div class="review-links-grid" data-review-actions></div>
    </section>
  `;
}

function renderBottleListDetail() {
  return `
    <section class="player-section">
      <div class="player-section-header">
        <div>
          <p class="eyebrow">Event Hub</p>
          <h2 data-bottle-list-title></h2>
          <p class="player-copy">Public raffle or event bottle list only. This page remains separate from Bingo.</p>
        </div>
        <button type="button" class="text-link-button" data-action="back-to-hub">Back to Event Hub</button>
      </div>
      <div class="bottle-list-detail">
        <div data-bottle-list-status></div>
        <div class="bottle-list-group-grid" data-bottle-list-groups></div>
      </div>
    </section>
  `;
}

function createPlayerNotice(message, tone) {
  const noticeNode = document.createElement("div");

  noticeNode.className = "player-note";
  noticeNode.dataset.tone = tone;
  noticeNode.textContent = message;
  return noticeNode;
}

function renderBottleListGroups(groupsNode, bottleList) {
  if (!groupsNode) {
    return;
  }

  groupsNode.innerHTML = "";

  bottleList.groups.forEach((group) => {
    const groupNode = document.createElement("article");
    const titleNode = document.createElement("h3");
    const tableWrapNode = document.createElement("div");
    const tableNode = document.createElement("table");
    const tableHeadNode = document.createElement("thead");
    const headerRowNode = document.createElement("tr");
    const bottleHeaderNode = document.createElement("th");
    const quantityHeaderNode = document.createElement("th");
    const priceHeaderNode = document.createElement("th");
    const tableBodyNode = document.createElement("tbody");

    groupNode.className = "hub-panel bottle-list-group";
    titleNode.textContent = group.title;
    tableWrapNode.className = "bottle-list-table-wrap";
    tableNode.className = "bottle-list-table";
    bottleHeaderNode.scope = "col";
    bottleHeaderNode.textContent = "Bottle";
    quantityHeaderNode.scope = "col";
    quantityHeaderNode.textContent = "Qty";
    priceHeaderNode.scope = "col";
    priceHeaderNode.textContent = "Price";
    headerRowNode.append(bottleHeaderNode, quantityHeaderNode, priceHeaderNode);
    tableHeadNode.append(headerRowNode);

    group.items.forEach((item) => {
      const itemRowNode = document.createElement("tr");
      const nameNode = document.createElement("td");
      const quantityNode = document.createElement("td");
      const priceNode = document.createElement("td");

      nameNode.dataset.label = "Bottle";
      nameNode.textContent = item.name;
      quantityNode.dataset.label = "Qty";
      quantityNode.textContent = String(item.quantity);
      priceNode.dataset.label = "Price";
      priceNode.textContent = item.price;
      itemRowNode.append(nameNode, quantityNode, priceNode);
      tableBodyNode.append(itemRowNode);
    });

    tableNode.append(tableHeadNode, tableBodyNode);
    tableWrapNode.append(tableNode);
    groupNode.append(titleNode, tableWrapNode);
    groupsNode.append(groupNode);
  });
}

function renderBottleListDetailContent(playerRoot, playerUiState) {
  const titleNode = playerRoot.querySelector("[data-bottle-list-title]");
  const statusNode = playerRoot.querySelector("[data-bottle-list-status]");
  const groupsNode = playerRoot.querySelector("[data-bottle-list-groups]");
  const bottleList = playerUiState.bottleList;

  if (titleNode) {
    titleNode.textContent = bottleList.title || DEFAULT_PUBLIC_BOTTLE_LIST_TITLE;
  }

  if (statusNode) {
    statusNode.innerHTML = "";

    if (playerUiState.isBottleListLoading && !playerUiState.hasLoadedBottleList) {
      statusNode.append(createPlayerNotice("Loading the public bottle list...", "info"));
    } else if (playerUiState.bottleListUnavailableMessage && !playerUiState.hasLoadedBottleList) {
      statusNode.append(createPlayerNotice(playerUiState.bottleListUnavailableMessage, "warning"));
    } else if (playerUiState.bottleListWarning) {
      statusNode.append(createPlayerNotice(playerUiState.bottleListWarning, "warning"));
    }
  }

  if (!groupsNode) {
    return;
  }

  groupsNode.innerHTML = "";

  if (playerUiState.isBottleListLoading && !playerUiState.hasLoadedBottleList) {
    return;
  }

  if (playerUiState.bottleListUnavailableMessage && !playerUiState.hasLoadedBottleList) {
    const unavailablePanelNode = document.createElement("div");
    const unavailableCopyNode = document.createElement("p");

    unavailablePanelNode.className = "hub-panel bottle-list-empty-panel";
    unavailableCopyNode.textContent = playerUiState.bottleListUnavailableMessage;
    unavailablePanelNode.append(unavailableCopyNode);
    groupsNode.append(unavailablePanelNode);
    return;
  }

  if (!hasBottleListItems(bottleList)) {
    const emptyPanelNode = document.createElement("div");
    const emptyCopyNode = document.createElement("p");

    emptyPanelNode.className = "hub-panel bottle-list-empty-panel";
    emptyCopyNode.textContent = PLAYER_EMPTY_BOTTLE_LIST_MESSAGE;
    emptyPanelNode.append(emptyCopyNode);
    groupsNode.append(emptyPanelNode);
    return;
  }

  renderBottleListGroups(groupsNode, bottleList);
}

function renderHub(playerState, playerUiState) {
  const currentState = playerState.getState();
  const currentPlayer = currentState.currentPlayer;
  const activePanel = getHubPanel(currentState.activeHubPanel);
  const hubButtonsMarkup = HUB_PANELS
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

  if (playerUiState.isViewingHubDetail && isTriviaPanel(activePanel)) {
    return renderTriviaDetail();
  }

  if (playerUiState.isViewingHubDetail && isStaticPagePanel(activePanel)) {
    return renderStaticPageDetail();
  }

  if (playerUiState.isViewingHubDetail && isReviewLinksPanel(activePanel)) {
    return renderReviewDetail();
  }

  if (playerUiState.isViewingHubDetail && isBottleListPanel(activePanel)) {
    return renderBottleListDetail();
  }

  return `
    <section class="player-section">
      <div class="player-section-header">
        <div>
          <p class="eyebrow">Event Hub</p>
          <h2 data-player-welcome>Welcome, ${escapeHtml(getPreferredName(currentPlayer?.name))}.</h2>
        </div>
        <button type="button" class="text-link-button" data-action="edit-check-in">Edit Check-In</button>
      </div>
      <p class="player-copy">Choose a section below. Live Trivia is ready here, while additional event features will continue to expand in later slices.</p>
      <div class="hub-grid">
        ${hubButtonsMarkup}
      </div>
      ${renderHubSummary(activePanel)}
    </section>
  `;
}

function renderReviewActions(reviewActionsNode, reviewLinks) {
  if (!reviewActionsNode) {
    return;
  }

  reviewActionsNode.innerHTML = "";

  REVIEW_LINK_DEFINITIONS.forEach((linkDefinition, index) => {
    const reviewLinkWrapper = document.createElement("article");
    const reviewLinkHeading = document.createElement("h3");
    const reviewLinkDescription = document.createElement("p");
    const reviewLinkUrl = reviewLinks[linkDefinition.key];
    const isLinkAvailable = isValidAbsoluteHttpUrl(reviewLinkUrl);

    reviewLinkWrapper.className = "hub-panel review-link-card";
    reviewLinkHeading.className = "review-link-title";
    reviewLinkHeading.textContent = linkDefinition.label;
    reviewLinkDescription.className = "review-link-note";

    if (isLinkAvailable) {
      const reviewLinkButton = document.createElement("a");

      reviewLinkButton.className = `${index === 0 ? "primary-button" : "secondary-button"} button-link`;
      reviewLinkButton.href = reviewLinkUrl;
      reviewLinkButton.target = "_blank";
      reviewLinkButton.rel = "noopener noreferrer";
      reviewLinkButton.textContent = `Open ${linkDefinition.label}`;
      reviewLinkDescription.textContent = "Opens in a new tab.";
      reviewLinkWrapper.append(reviewLinkHeading, reviewLinkButton, reviewLinkDescription);
    } else {
      const unavailableButton = document.createElement("button");

      unavailableButton.type = "button";
      unavailableButton.className = "secondary-button";
      unavailableButton.disabled = true;
      unavailableButton.textContent = `${linkDefinition.label} Unavailable`;
      reviewLinkDescription.textContent = "This review link has not been posted yet.";
      reviewLinkWrapper.append(reviewLinkHeading, unavailableButton, reviewLinkDescription);
    }

    reviewActionsNode.append(reviewLinkWrapper);
  });
}

function createTriviaSummaryRow(label, value) {
  const summaryNode = document.createElement("p");
  const labelNode = document.createElement("strong");

  summaryNode.className = "trivia-question-meta";
  labelNode.textContent = `${label}: `;
  summaryNode.append(labelNode, document.createTextNode(value));
  return summaryNode;
}

function appendTriviaAnswerSummary(containerNode, label, answerIndex, options) {
  if (!Number.isInteger(answerIndex) || !options[answerIndex]) {
    return;
  }

  containerNode.append(
    createTriviaSummaryRow(label, `Choice ${answerIndex + 1} (${options[answerIndex]})`)
  );
}

function renderPlayerTriviaDetailContent(playerRoot, playerUiState) {
  const statusNode = playerRoot.querySelector("[data-player-trivia-status]");
  const panelNode = playerRoot.querySelector("[data-player-trivia-panel]");
  const currentRound = playerUiState.triviaRound;
  const savedAnswer = isValidTriviaAnswerForRound(playerUiState.triviaAnswer, currentRound)
    ? playerUiState.triviaAnswer
    : null;
  const hasResolvedCurrentRoundAnswer = playerUiState.hasLoadedTriviaAnswer || !playerUiState.isTriviaAnswerLoading;

  if (statusNode) {
    statusNode.innerHTML = "";

    if (playerUiState.triviaActionMessage.text) {
      statusNode.append(createPlayerNotice(playerUiState.triviaActionMessage.text, playerUiState.triviaActionMessage.tone));
    }

    if (playerUiState.isTriviaRoundLoading && !playerUiState.hasLoadedTriviaRound) {
      statusNode.append(createPlayerNotice("Loading the current Trivia question...", "info"));
    } else if (playerUiState.triviaRoundUnavailableMessage && !playerUiState.hasLoadedTriviaRound) {
      statusNode.append(createPlayerNotice(playerUiState.triviaRoundUnavailableMessage, "warning"));
    } else if (playerUiState.triviaRoundWarning) {
      statusNode.append(createPlayerNotice(playerUiState.triviaRoundWarning, "warning"));
    }

    if (hasActiveTriviaRound(currentRound)) {
      if (playerUiState.triviaAnswerUnavailableMessage && !playerUiState.hasLoadedTriviaAnswer) {
        statusNode.append(createPlayerNotice(playerUiState.triviaAnswerUnavailableMessage, "warning"));
      } else if (playerUiState.triviaAnswerWarning) {
        statusNode.append(createPlayerNotice(playerUiState.triviaAnswerWarning, "warning"));
      }

      if (playerUiState.isSavingTriviaAnswer) {
        statusNode.append(createPlayerNotice("Saving your Trivia answer...", "info"));
      }
    }
  }

  if (!panelNode) {
    return;
  }

  panelNode.innerHTML = "";

  if (!hasActiveTriviaRound(currentRound)) {
    const waitingPanelNode = document.createElement("section");
    const waitingCopyNode = document.createElement("p");

    waitingPanelNode.className = "hub-panel trivia-player-panel";
    waitingCopyNode.className = "player-copy";
    waitingCopyNode.textContent = PLAYER_TRIVIA_WAITING_MESSAGE;
    waitingPanelNode.append(waitingCopyNode);
    panelNode.append(waitingPanelNode);
    return;
  }

  const triviaPanelNode = document.createElement("section");
  const headerNode = document.createElement("div");
  const titleWrapNode = document.createElement("div");
  const eyebrowNode = document.createElement("p");
  const titleNode = document.createElement("h3");
  const statusBadgeNode = document.createElement("span");
  const questionNode = document.createElement("p");
  const helperCopyNode = document.createElement("p");
  const optionsGridNode = document.createElement("div");

  triviaPanelNode.className = "trivia-player-panel";
  headerNode.className = "trivia-status-row";
  eyebrowNode.className = "eyebrow";
  eyebrowNode.textContent = "Live Trivia";
  titleNode.textContent = currentRound.questionId || "Current Question";
  statusBadgeNode.className = "trivia-status-badge";
  statusBadgeNode.dataset.triviaStatus = currentRound.status;
  statusBadgeNode.textContent = getTriviaRoundStatusLabel(currentRound.status);
  titleWrapNode.append(eyebrowNode, titleNode);
  headerNode.append(titleWrapNode, statusBadgeNode);
  questionNode.className = "trivia-question-copy";
  questionNode.textContent = currentRound.question;
  helperCopyNode.className = "player-copy";
  optionsGridNode.className = "trivia-answer-grid";

  if (currentRound.status === TRIVIA_ROUND_STATUS_QUESTION_LIVE) {
    helperCopyNode.textContent = savedAnswer
      ? "Your current answer is saved. You can still change it while the question stays live."
      : "Tap an answer below. You can change it until the Host locks the round.";
  } else if (currentRound.status === TRIVIA_ROUND_STATUS_LOCKED) {
    helperCopyNode.textContent = "Answers are locked.";
  } else {
    helperCopyNode.textContent = "The correct answer has been revealed.";
  }

  currentRound.options.forEach((optionValue, optionIndex) => {
    const answerButtonNode = document.createElement("button");
    const isSelected = savedAnswer?.answer === optionIndex;
    const isDisabled = !isTriviaRoundLive(currentRound) || playerUiState.isSavingTriviaAnswer;
    const isCorrectReveal = currentRound.status === TRIVIA_ROUND_STATUS_REVEALED
      && currentRound.correctAnswer === optionIndex;
    const isIncorrectReveal = currentRound.status === TRIVIA_ROUND_STATUS_REVEALED
      && isSelected
      && currentRound.correctAnswer !== optionIndex;

    answerButtonNode.type = "button";
    answerButtonNode.className = "secondary-button trivia-answer-button";
    answerButtonNode.dataset.action = "select-trivia-answer";
    answerButtonNode.dataset.answerIndex = String(optionIndex);
    answerButtonNode.dataset.selected = isSelected ? "true" : "false";
    answerButtonNode.dataset.correct = isCorrectReveal ? "true" : "false";
    answerButtonNode.dataset.incorrect = isIncorrectReveal ? "true" : "false";
    answerButtonNode.disabled = isDisabled;
    answerButtonNode.textContent = `Choice ${optionIndex + 1}: ${optionValue}`;
    optionsGridNode.append(answerButtonNode);
  });

  triviaPanelNode.append(headerNode, questionNode, helperCopyNode, optionsGridNode);

  if (playerUiState.isTriviaAnswerLoading && !savedAnswer) {
    const answerLoadingNode = document.createElement("p");

    answerLoadingNode.className = "player-copy";
    answerLoadingNode.textContent = "Checking your saved answer for this round...";
    triviaPanelNode.append(answerLoadingNode);
  }

  if (currentRound.status === TRIVIA_ROUND_STATUS_QUESTION_LIVE && savedAnswer) {
    appendTriviaAnswerSummary(triviaPanelNode, "Current answer", savedAnswer.answer, currentRound.options);
  }

  if (currentRound.status === TRIVIA_ROUND_STATUS_LOCKED) {
    if (savedAnswer) {
      appendTriviaAnswerSummary(triviaPanelNode, "Submitted answer", savedAnswer.answer, currentRound.options);
    } else if (hasResolvedCurrentRoundAnswer) {
      const missedAnswerNode = document.createElement("p");

      missedAnswerNode.className = "trivia-answer-note";
      missedAnswerNode.textContent = "No answer was submitted before the round was locked.";
      triviaPanelNode.append(missedAnswerNode);
    }
  }

  if (currentRound.status === TRIVIA_ROUND_STATUS_REVEALED) {
    appendTriviaAnswerSummary(triviaPanelNode, "Correct answer", currentRound.correctAnswer, currentRound.options);

    if (savedAnswer) {
      appendTriviaAnswerSummary(triviaPanelNode, "Your answer", savedAnswer.answer, currentRound.options);
    } else if (hasResolvedCurrentRoundAnswer) {
      const noAnswerNode = document.createElement("p");

      noAnswerNode.className = "trivia-answer-note";
      noAnswerNode.textContent = "No answer was submitted before the reveal.";
      triviaPanelNode.append(noAnswerNode);
    }

    const resultNode = document.createElement("div");

    resultNode.className = "trivia-result-pill";

    if (!savedAnswer && hasResolvedCurrentRoundAnswer) {
      resultNode.dataset.tone = "warning";
      resultNode.textContent = "No answer submitted";
    } else if (savedAnswer && savedAnswer.answer === currentRound.correctAnswer) {
      resultNode.dataset.tone = "success";
      resultNode.textContent = "Correct";
    } else if (savedAnswer) {
      resultNode.dataset.tone = "error";
      resultNode.textContent = "Incorrect";
    } else {
      resultNode.dataset.tone = "info";
      resultNode.textContent = "Checking your saved answer...";
    }

    triviaPanelNode.append(resultNode);
  }

  panelNode.append(triviaPanelNode);
}

function populateDynamicHubContent({ playerRoot, state, playerUiState }) {
  const currentState = state.getState();
  const currentPlayer = currentState.currentPlayer;
  const activePanel = getHubPanel(currentState.activeHubPanel);
  const checkInForm = playerRoot.querySelector("#player-checkin-form");

  if (checkInForm instanceof HTMLFormElement) {
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

  if (playerUiState.isViewingHubDetail && isTriviaPanel(activePanel)) {
    renderPlayerTriviaDetailContent(playerRoot, playerUiState);
  }

  if (playerUiState.isViewingHubDetail && isStaticPagePanel(activePanel)) {
    const staticPage = playerUiState.staticPages[activePanel.pageKey];
    const titleNode = playerRoot.querySelector("[data-static-page-title]");
    const contentNode = playerRoot.querySelector("[data-static-page-content]");

    if (titleNode) {
      titleNode.textContent = staticPage.title;
    }

    if (contentNode) {
      contentNode.textContent = hasStaticPageContent(staticPage)
        ? staticPage.content
        : MISSING_STATIC_PAGE_MESSAGE;
    }
  }

  if (playerUiState.isViewingHubDetail && isReviewLinksPanel(activePanel)) {
    renderReviewActions(playerRoot.querySelector("[data-review-actions]"), playerUiState.reviewLinks);
  }

  if (playerUiState.isViewingHubDetail && isBottleListPanel(activePanel)) {
    renderBottleListDetailContent(playerRoot, playerUiState);
  }
}

export async function initPlayerPage({ firebase, state, renderStatus }) {
  initTriviaModule({ firebase, state, role: "player" });
  initBingoModule({ firebase, state, role: "player" });

  cleanupPlayerPageRuntime();

  const playerRoot = document.querySelector(PLAYER_ROOT_SELECTOR);

  if (!hasBoundPlayerBeforeUnload) {
    window.addEventListener("beforeunload", handlePlayerBeforeUnload);
    hasBoundPlayerBeforeUnload = true;
  }

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
    isViewingHubDetail: false,
    playerMessage: {
      text: "",
      tone: "info",
    },
    staticPages: normalizeStaticPages(null),
    reviewLinks: normalizeReviewLinks(null),
    bottleList: normalizeBottleList(null),
    hasLoadedBottleList: false,
    isBottleListLoading: true,
    bottleListWarning: "",
    bottleListUnavailableMessage: "",
    triviaRound: normalizeTriviaCurrentRound(null),
    hasLoadedTriviaRound: false,
    isTriviaRoundLoading: true,
    triviaRoundWarning: "",
    triviaRoundUnavailableMessage: "",
    triviaAnswer: createEmptyTriviaAnswerRecord(),
    hasLoadedTriviaAnswer: false,
    isTriviaAnswerLoading: false,
    triviaAnswerWarning: "",
    triviaAnswerUnavailableMessage: "",
    triviaActionMessage: {
      text: "",
      tone: "info",
    },
    activeTriviaAnswerRoundId: "",
    isSavingTriviaAnswer: false,
  };

  function setPlayerMessage(text = "", tone = "info") {
    playerUiState.playerMessage = { text, tone };
  }

  function setTriviaActionMessage(text = "", tone = "info") {
    playerUiState.triviaActionMessage = { text, tone };
  }

  function getActiveTriviaPlayerId() {
    const currentState = state.getState();
    return currentState.deviceId || currentState.currentPlayer?.playerId || getOrCreateDeviceId();
  }

  function clearPlayerTriviaAnswerState() {
    playerUiState.triviaAnswer = createEmptyTriviaAnswerRecord();
    playerUiState.hasLoadedTriviaAnswer = false;
    playerUiState.isTriviaAnswerLoading = false;
    playerUiState.triviaAnswerWarning = "";
    playerUiState.triviaAnswerUnavailableMessage = "";
    playerUiState.isSavingTriviaAnswer = false;
  }

  function detachPlayerTriviaAnswerListener({ clearState = true } = {}) {
    if (typeof unsubscribePlayerTriviaAnswerListener === "function") {
      unsubscribePlayerTriviaAnswerListener();
    }

    unsubscribePlayerTriviaAnswerListener = null;
    playerUiState.activeTriviaAnswerRoundId = "";

    if (clearState) {
      clearPlayerTriviaAnswerState();
    }
  }

  function syncPlayerTriviaAnswerListener(round) {
    const normalizedRound = normalizeTriviaCurrentRound(round);

    if (!hasActiveTriviaRound(normalizedRound) || !normalizedRound.roundId) {
      detachPlayerTriviaAnswerListener({ clearState: true });
      return;
    }

    if (playerUiState.activeTriviaAnswerRoundId === normalizedRound.roundId && typeof unsubscribePlayerTriviaAnswerListener === "function") {
      return;
    }

    const playerId = getActiveTriviaPlayerId();

    detachPlayerTriviaAnswerListener({ clearState: true });
    playerUiState.activeTriviaAnswerRoundId = normalizedRound.roundId;
    playerUiState.isTriviaAnswerLoading = true;

    unsubscribePlayerTriviaAnswerListener = firebase.listenEventData(
      getTriviaPlayerAnswerPath(normalizedRound.roundId, playerId),
      (answerValue, listenerStatus) => {
        if (playerUiState.activeTriviaAnswerRoundId !== normalizedRound.roundId) {
          return;
        }

        if (!listenerStatus.ok) {
          playerUiState.isTriviaAnswerLoading = false;

          if (playerUiState.hasLoadedTriviaAnswer) {
            playerUiState.triviaAnswerWarning = "Your saved Trivia answer is temporarily unavailable. Showing the last loaded answer.";
          } else {
            playerUiState.triviaAnswerUnavailableMessage = "Your saved Trivia answer is temporarily unavailable right now.";
          }

          renderPlayerView();
          return;
        }

        const normalizedAnswer = normalizeTriviaAnswerRecord(answerValue, {
          roundId: normalizedRound.roundId,
          playerId,
        });

        if (!normalizedAnswer.isValid && !normalizedAnswer.isEmpty) {
          playerUiState.isTriviaAnswerLoading = false;

          if (playerUiState.hasLoadedTriviaAnswer) {
            playerUiState.triviaAnswerWarning = "Your saved Trivia answer is invalid. Showing the last loaded answer.";
          } else {
            playerUiState.triviaAnswerUnavailableMessage = "Your saved Trivia answer data is invalid right now.";
          }

          renderPlayerView();
          return;
        }

        playerUiState.triviaAnswer = normalizedAnswer.isEmpty
          ? createEmptyTriviaAnswerRecord()
          : normalizedAnswer;
        playerUiState.hasLoadedTriviaAnswer = true;
        playerUiState.isTriviaAnswerLoading = false;
        playerUiState.triviaAnswerWarning = "";
        playerUiState.triviaAnswerUnavailableMessage = "";
        renderPlayerView();
      }
    );
  }

  function renderPlayerView() {
    const currentState = state.getState();
    const currentPlayer = currentState.currentPlayer;
    let viewMarkup = "";

    if (currentPlayer && !playerUiState.isEditingCheckIn) {
      viewMarkup = renderHub(state, playerUiState);
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

    populateDynamicHubContent({ playerRoot, state, playerUiState });
  }

  function attachRealtimeContentListeners() {
    clearPlayerContentListeners();

    unsubscribePagesListener = firebase.listenEventData("pages", (pagesValue, listenerStatus) => {
      if (!listenerStatus.ok) {
        return;
      }

      playerUiState.staticPages = normalizeStaticPages(pagesValue);
      renderPlayerView();
    });

    unsubscribeReviewLinksListener = firebase.listenEventData("reviewLinks", (reviewLinksValue, listenerStatus) => {
      if (!listenerStatus.ok) {
        return;
      }

      playerUiState.reviewLinks = normalizeReviewLinks(reviewLinksValue);
      renderPlayerView();
    });

    unsubscribeBottleListListener = firebase.listenEventData(PUBLIC_BOTTLE_LIST_PATH, (bottleListValue, listenerStatus) => {
      if (!listenerStatus.ok) {
        playerUiState.isBottleListLoading = false;

        if (playerUiState.hasLoadedBottleList) {
          playerUiState.bottleListWarning = "Live bottle list updates are temporarily unavailable. Showing the last posted list.";
        } else {
          playerUiState.bottleListUnavailableMessage = "The bottle list is temporarily unavailable right now. Please try again in a moment.";
        }

        renderPlayerView();
        return;
      }

      playerUiState.bottleList = normalizeBottleList(bottleListValue);
      playerUiState.hasLoadedBottleList = true;
      playerUiState.isBottleListLoading = false;
      playerUiState.bottleListWarning = "";
      playerUiState.bottleListUnavailableMessage = "";
      renderPlayerView();
    });
  }

  function attachPlayerTriviaRoundListener() {
    if (typeof unsubscribePlayerTriviaRoundListener === "function") {
      unsubscribePlayerTriviaRoundListener();
      unsubscribePlayerTriviaRoundListener = null;
    }

    playerUiState.isTriviaRoundLoading = !playerUiState.hasLoadedTriviaRound;

    unsubscribePlayerTriviaRoundListener = firebase.listenEventData(
      TRIVIA_CURRENT_ROUND_PATH,
      (roundValue, listenerStatus) => {
        if (!listenerStatus.ok) {
          playerUiState.isTriviaRoundLoading = false;

          if (playerUiState.hasLoadedTriviaRound) {
            playerUiState.triviaRoundWarning = "Live Trivia updates are temporarily unavailable. Showing the last loaded question state.";
          } else {
            playerUiState.triviaRoundUnavailableMessage = "Live Trivia is temporarily unavailable right now.";
            playerUiState.triviaRound = normalizeTriviaCurrentRound(null);
            detachPlayerTriviaAnswerListener({ clearState: true });
          }

          renderPlayerView();
          return;
        }

        const normalizedRound = normalizeTriviaCurrentRound(roundValue);

        if (!normalizedRound.isValid) {
          playerUiState.isTriviaRoundLoading = false;

          if (playerUiState.hasLoadedTriviaRound) {
            playerUiState.triviaRoundWarning = "The current Trivia round data is invalid. Showing the last loaded round.";
          } else {
            playerUiState.triviaRoundUnavailableMessage = "The current Trivia round data is invalid right now.";
            playerUiState.triviaRound = normalizeTriviaCurrentRound(null);
            detachPlayerTriviaAnswerListener({ clearState: true });
          }

          renderPlayerView();
          return;
        }

        playerUiState.triviaRound = normalizedRound;
        playerUiState.hasLoadedTriviaRound = true;
        playerUiState.isTriviaRoundLoading = false;
        playerUiState.triviaRoundWarning = "";
        playerUiState.triviaRoundUnavailableMessage = "";
        syncPlayerTriviaAnswerListener(normalizedRound);
        renderPlayerView();
      }
    );
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
      activeHubPanel: state.getState().activeHubPanel || DEFAULT_HUB_PANEL_ID,
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

  async function savePlayerTriviaAnswer(answerIndex) {
    const currentPlayer = state.getState().currentPlayer;
    const currentRound = playerUiState.triviaRound;
    const savedAnswer = isValidTriviaAnswerForRound(playerUiState.triviaAnswer, currentRound)
      ? playerUiState.triviaAnswer
      : null;

    if (!currentPlayer) {
      setTriviaActionMessage("Please complete check-in before answering Trivia.", "warning");
      renderPlayerView();
      return;
    }

    if (!firebase.getStatus().isConnected) {
      setTriviaActionMessage("Trivia answers are temporarily unavailable because the event connection is not ready.", "warning");
      renderPlayerView();
      return;
    }

    if (!isTriviaRoundLive(currentRound) || !currentRound.roundId) {
      setTriviaActionMessage("This Trivia question is no longer accepting answers.", "warning");
      renderPlayerView();
      return;
    }

    if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= currentRound.options.length) {
      setTriviaActionMessage("That Trivia answer choice is invalid. Please try again.", "error");
      renderPlayerView();
      return;
    }

    if (savedAnswer && savedAnswer.answer === answerIndex) {
      return;
    }

    const playerId = getActiveTriviaPlayerId();
    const roundIdAtSubmit = currentRound.roundId;
    const now = new Date().toISOString();
    const nextAnswerPayload = buildTriviaAnswerPayload({
      roundId: roundIdAtSubmit,
      playerId,
      answer: answerIndex,
      submittedAt: savedAnswer?.submittedAt || now,
      updatedAt: now,
    });

    playerUiState.isSavingTriviaAnswer = true;
    setTriviaActionMessage();
    renderPlayerView();

    const saveSucceeded = await firebase.writeEventData(
      getTriviaPlayerAnswerPath(roundIdAtSubmit, playerId),
      nextAnswerPayload
    );

    playerUiState.isSavingTriviaAnswer = false;

    if (!saveSucceeded) {
      setTriviaActionMessage(firebase.getStatus().message || "We could not save your Trivia answer right now. Please try again.", "error");
      renderPlayerView();
      return;
    }

    if (playerUiState.triviaRound.roundId === roundIdAtSubmit) {
      playerUiState.triviaAnswer = normalizeTriviaAnswerRecord(nextAnswerPayload, {
        roundId: roundIdAtSubmit,
        playerId,
      });
      playerUiState.hasLoadedTriviaAnswer = true;
      playerUiState.isTriviaAnswerLoading = false;
      playerUiState.triviaAnswerWarning = "";
      playerUiState.triviaAnswerUnavailableMessage = "";
    }

    setTriviaActionMessage();
    renderPlayerView();
  }

  activePlayerClickHandler = async (event) => {
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
      const nextPanel = getHubPanel(actionNode.dataset.panelId || DEFAULT_HUB_PANEL_ID);

      playerUiState.isViewingHubDetail = shouldOpenHubDetailPanel(nextPanel);
      state.patch({ activeHubPanel: nextPanel.id });
      renderPlayerView();
      return;
    }

    if (action === "back-to-hub") {
      playerUiState.isViewingHubDetail = false;
      state.patch({ activeHubPanel: DEFAULT_HUB_PANEL_ID });
      renderPlayerView();
      return;
    }

    if (action === "edit-check-in") {
      playerUiState.isEditingCheckIn = true;
      playerUiState.isViewingHubDetail = false;
      setPlayerMessage();
      renderPlayerView();
      return;
    }

    if (action === "cancel-edit-check-in") {
      playerUiState.isEditingCheckIn = false;
      setPlayerMessage();
      renderPlayerView();
      return;
    }

    if (action === "select-trivia-answer") {
      const answerIndex = Number.parseInt(actionNode.dataset.answerIndex || "", 10);
      await savePlayerTriviaAnswer(answerIndex);
    }
  };

  activePlayerSubmitHandler = async (event) => {
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
      activeHubPanel: currentState.activeHubPanel || DEFAULT_HUB_PANEL_ID,
    });

    playerUiState.ageGateDeclined = false;
    playerUiState.isEditingCheckIn = false;
    playerUiState.isViewingHubDetail = false;
    setPlayerMessage(
      currentState.currentPlayer ? "Your check-in details were updated." : "You are checked in and ready for the Event Hub.",
      "success"
    );
    renderPlayerView();
  };

  playerRoot.addEventListener("click", activePlayerClickHandler);
  playerRoot.addEventListener("submit", activePlayerSubmitHandler);
  activePlayerRoot = playerRoot;

  attachRealtimeContentListeners();
  attachPlayerTriviaRoundListener();
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
    ? "Player check-in and Event Hub content are ready for Firebase-backed attendance and realtime updates."
    : "Player check-in is loaded, but a live Firebase connection is required before guests can save check-in or receive event content.";

  renderStatus(firebaseMessage, firebase.isConfigured ? "info" : "warning");

  return {
    statusMessage: firebaseMessage,
  };
}

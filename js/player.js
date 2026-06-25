import { initTriviaModule } from "./trivia.js";
import { initBingoModule } from "./bingo.js";
import {
  BINGO_CARD_ITEM_COUNT,
  BINGO_LIVE_CURRENT_ROUND_PATH,
  BINGO_ROUND_STATUS_CARDS_LOCKED,
  BINGO_ROUND_STATUS_ENDED,
  BINGO_ROUND_STATUS_IN_PROGRESS,
  buildBingoPlayerCardPayload,
  createEmptyBingoCurrentRound,
  createEmptyBingoPlayerCard,
  getBingoPlayerCardPath,
  hasPreparedBingoRound,
  isBingoRoundOpen,
  isValidBingoPlayerCardForRound,
  normalizeBingoCurrentRound,
  normalizeBingoPlayerCard,
  sampleBingoItems,
} from "./bingo-pool.js";
import {
  calculateBingoWinnerMilestones,
  getBingoRoundDrawsPath,
  normalizeBingoRoundDraws,
} from "./bingo-live.js";
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
const PLAYER_BINGO_WAITING_MESSAGE = "Waiting for the next Bingo round...";
const PLAYER_BRAND_EYEBROW = "A2ZEventHubV0.2";
const PLAYER_FALLBACK_EVENT_TITLE = "The Allocated Affair XV";
const PLAYER_EVENT_TITLE_PLACEHOLDERS = new Set([
  "a2z event",
  "a2z event engine demo",
  "a2z liquors event",
]);

let unsubscribePagesListener = null;
let unsubscribeReviewLinksListener = null;
let unsubscribeBottleListListener = null;
let unsubscribePlayerTriviaRoundListener = null;
let unsubscribePlayerTriviaAnswerListener = null;
let unsubscribePlayerBingoRoundListener = null;
let unsubscribePlayerBingoCardListener = null;
let unsubscribePlayerBingoDrawsListener = null;
let activePlayerRoot = null;
let activePlayerClickHandler = null;
let activePlayerInputHandler = null;
let activePlayerSubmitHandler = null;
let hasBoundPlayerBeforeUnload = false;

const HUB_PANELS = [
  {
    id: "trivia",
    label: "Trivia",
    title: "Trivia",
    message: "Join the current question, submit your answer, and check the reveal.",
    kind: "trivia",
  },
  {
    id: "bingo",
    label: "Bingo",
    title: "Bingo",
    message: "Open your card, follow the latest calls, and shuffle while cards stay open.",
    kind: "bingo",
  },
  {
    id: "bottle-list",
    label: "Bottle List",
    title: "Bottle List",
    message: "Browse the current bottle list for this event.",
    kind: "bottle-list",
  },
  ...STATIC_PAGE_DEFINITIONS.map((pageDefinition) => ({
    id: pageDefinition.hubPanelId,
    label: pageDefinition.label,
    title: pageDefinition.defaultTitle,
    message: `View the latest ${pageDefinition.label} details for this event.`,
    kind: "static-page",
    pageKey: pageDefinition.key,
  })),
  {
    id: "leave-review",
    label: "Leave Review",
    title: "Leave Review",
    message: "Share your experience with a quick review.",
    kind: "review-links",
  },
];

const VISIBLE_HUB_PANEL_IDS = [
  "trivia",
  "bingo",
  "bottle-list",
  "faq",
  "rules-alerts",
  "event-schedule",
  "leave-review",
];

const HUB_PANEL_LABEL_OVERRIDES = {
  "bottle-list": "Vault",
  "rules-alerts": "Rules",
};

const DEFAULT_HUB_PANEL_ID = HUB_PANELS[0].id;

function getPlayerEventTitle(eventConfig) {
  const configuredEventTitle = normalizeTextInput(eventConfig?.eventName);

  if (!configuredEventTitle) {
    return PLAYER_FALLBACK_EVENT_TITLE;
  }

  if (PLAYER_EVENT_TITLE_PLACEHOLDERS.has(configuredEventTitle.toLowerCase())) {
    return PLAYER_FALLBACK_EVENT_TITLE;
  }

  return configuredEventTitle;
}

function getPlayerCheckInSummary(currentPlayer) {
  const preferredName = getPreferredName(currentPlayer?.name);

  return currentPlayer
    ? `Welcome ${preferredName}`
    : "Check in to join Trivia, Bingo, and event updates.";
}

function getPlayerHubWelcomeMessage(eventName) {
  return `Welcome to ${eventName}. Use this hub for Trivia, Bingo, bottle list, reviews, and event details.`;
}

function sanitizeZipInput(value) {
  return String(value ?? "")
    .replace(/\D+/g, "")
    .slice(0, 5);
}

function isValidZipCode(value) {
  return /^\d{5}$/.test(sanitizeZipInput(value));
}

function getPlayerTriviaStatusText(currentRound) {
  if (currentRound.status === TRIVIA_ROUND_STATUS_QUESTION_LIVE) {
    return "Choose your answer";
  }

  if (currentRound.status === TRIVIA_ROUND_STATUS_LOCKED) {
    return "Answers are locked";
  }

  if (currentRound.status === TRIVIA_ROUND_STATUS_REVEALED) {
    return "Results are in";
  }

  return getTriviaRoundStatusLabel(currentRound.status);
}

function getPlayerBingoStatusLine(currentRound) {
  if (isBingoRoundOpen(currentRound)) {
    return "Cards are open. Shuffle while you can.";
  }

  if (currentRound.status === BINGO_ROUND_STATUS_CARDS_LOCKED) {
    return "Cards are locked.";
  }

  if (currentRound.status === BINGO_ROUND_STATUS_IN_PROGRESS) {
    return "Bingo is live. Watch for bottles being called.";
  }

  if (currentRound.status === BINGO_ROUND_STATUS_ENDED) {
    return "Round ended.";
  }

  return PLAYER_BINGO_WAITING_MESSAGE;
}

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

function clearPlayerBingoListeners() {
  if (typeof unsubscribePlayerBingoRoundListener === "function") {
    unsubscribePlayerBingoRoundListener();
  }

  if (typeof unsubscribePlayerBingoCardListener === "function") {
    unsubscribePlayerBingoCardListener();
  }

  if (typeof unsubscribePlayerBingoDrawsListener === "function") {
    unsubscribePlayerBingoDrawsListener();
  }

  unsubscribePlayerBingoRoundListener = null;
  unsubscribePlayerBingoCardListener = null;
  unsubscribePlayerBingoDrawsListener = null;
}

function cleanupPlayerPageRuntime() {
  clearPlayerContentListeners();
  clearPlayerTriviaListeners();
  clearPlayerBingoListeners();

  if (activePlayerRoot && activePlayerClickHandler) {
    activePlayerRoot.removeEventListener("click", activePlayerClickHandler);
  }

  if (activePlayerRoot && activePlayerInputHandler) {
    activePlayerRoot.removeEventListener("input", activePlayerInputHandler);
  }

  if (activePlayerRoot && activePlayerSubmitHandler) {
    activePlayerRoot.removeEventListener("submit", activePlayerSubmitHandler);
  }

  activePlayerRoot = null;
  activePlayerClickHandler = null;
  activePlayerInputHandler = null;
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

function getVisibleHubPanels() {
  return VISIBLE_HUB_PANEL_IDS
    .map((panelId) => HUB_PANELS.find((panel) => panel.id === panelId))
    .filter(Boolean);
}

function getHubPanelLabel(panel) {
  return HUB_PANEL_LABEL_OVERRIDES[panel?.id] || panel?.label || "";
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

function isBingoPanel(panel) {
  return panel?.kind === "bingo";
}

function isTriviaPanel(panel) {
  return panel?.kind === "trivia";
}

function shouldOpenHubDetailPanel(panel) {
  return isTriviaPanel(panel)
    || isBingoPanel(panel)
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

function renderAgeGate(eventName) {
  return `
    <section class="player-section player-entry-section">
      <p class="eyebrow">${PLAYER_BRAND_EYEBROW}</p>
      <h2>${escapeHtml(eventName)}</h2>
      <p class="player-kicker">Guest Check-In</p>
      <p class="player-copy">Please confirm that you are 21 or older before continuing to event check-in.</p>
      <div class="player-action-stack">
        <button type="button" class="primary-button" data-action="accept-age-gate">I Am 21+</button>
        <button type="button" class="secondary-button" data-action="decline-age-gate">I Am Under 21</button>
      </div>
    </section>
  `;
}

function renderAgeGateBlocked(eventName) {
  return `
    <section class="player-section player-entry-section">
      <p class="eyebrow">${PLAYER_BRAND_EYEBROW}</p>
      <h2>${escapeHtml(eventName)}</h2>
      <p class="player-kicker">Guest Check-In</p>
      <h3>Thanks for checking</h3>
      <p class="player-copy">This event experience is only available to guests who are 21 or older. Please see event staff if you have questions.</p>
      <button type="button" class="secondary-button" data-action="reset-age-gate">Go Back</button>
    </section>
  `;
}

function renderCheckInForm({ canSave, isEditing, eventName }) {
  const heading = isEditing ? "Edit Check-In" : "Guest Check-In";
  const submitLabel = isEditing ? "Save Changes" : "Check In";
  const helperCopy = isEditing
    ? "Update your details below and save when you're ready."
    : "Enter your details to save your check-in and open the Event Hub.";
  const connectionMessage = canSave
    ? ""
    : `
      <div class="player-note" data-tone="warning">
        Check-in will be available as soon as the event connection is live.
      </div>
    `;
  const cancelAction = isEditing
    ? `<button type="button" class="secondary-button" data-action="cancel-edit-check-in">Cancel</button>`
    : "";

  return `
    <section class="player-section player-entry-section">
      <p class="eyebrow">${PLAYER_BRAND_EYEBROW}</p>
      <h2>${escapeHtml(eventName)}</h2>
      <p class="player-kicker">${heading}</p>
      <p class="player-copy">${helperCopy}</p>
      ${connectionMessage}
      <form id="player-checkin-form" class="player-form" novalidate>
        <label class="form-field" for="player-name">
          <span>Name</span>
          <input id="player-name" name="name" class="form-input" type="text" autocomplete="name" required>
        </label>
        <label class="form-field" for="player-zip">
          <span>ZIP Code</span>
          <input id="player-zip" name="zip" class="form-input" type="text" inputmode="numeric" maxlength="5" pattern="[0-9]{5}" autocomplete="postal-code" required>
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

function renderPlayerDetailHeader({
  eventName,
  title = "",
  titleDataAttribute = "",
  helperCopy = "",
}) {
  const titleAttributes = titleDataAttribute ? ` ${titleDataAttribute}` : "";
  const titleContent = title ? escapeHtml(title) : "";
  const helperMarkup = helperCopy
    ? `<p class="player-copy">${escapeHtml(helperCopy)}</p>`
    : "";

  return `
    <div class="player-detail-header">
      <div class="player-detail-header__top">
        <p class="eyebrow">${escapeHtml(eventName)}</p>
        <button type="button" class="text-link-button player-detail-back-link" data-action="back-to-hub">&larr; Hub</button>
      </div>
      <h2${titleAttributes}>${titleContent}</h2>
      ${helperMarkup}
    </div>
  `;
}

function renderTriviaDetail(eventName) {
  return `
    <section class="player-section">
      ${renderPlayerDetailHeader({
        eventName,
        title: "Trivia",
        helperCopy: "Choose your answer while live.",
      })}
      <div class="trivia-live-detail">
        <div data-player-trivia-status></div>
        <div data-player-trivia-panel></div>
      </div>
    </section>
  `;
}

function renderBingoDetail(eventName) {
  return `
    <section class="player-section">
      ${renderPlayerDetailHeader({
        eventName,
        title: "Bingo",
        helperCopy: "Tip: you can shuffle cards until cards are locked.",
      })}
      <div class="bingo-live-detail">
        <div data-player-bingo-status></div>
        <div data-player-bingo-panel></div>
      </div>
    </section>
  `;
}

function renderStaticPageDetail(eventName) {
  return `
    <section class="player-section">
      ${renderPlayerDetailHeader({
        eventName,
        titleDataAttribute: "data-static-page-title",
      })}
      <div class="hub-panel static-page-panel">
        <p class="static-page-content" data-static-page-content></p>
      </div>
    </section>
  `;
}

function renderReviewDetail(eventName) {
  return `
    <section class="player-section">
      ${renderPlayerDetailHeader({
        eventName,
        title: "Leave Review",
        helperCopy: "Choose a review option below.",
      })}
      <div class="review-links-grid" data-review-actions></div>
    </section>
  `;
}

function renderBottleListDetail(eventName) {
  return `
    <section class="player-section">
      ${renderPlayerDetailHeader({
        eventName,
        titleDataAttribute: "data-bottle-list-title",
        helperCopy: "Browse the current bottle list for this event.",
      })}
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
  const eventName = getPlayerEventTitle(currentState.eventConfig);
  const hubButtonsMarkup = getVisibleHubPanels()
    .map((panel) => `
      <button
        type="button"
        class="hub-button"
        data-action="open-hub-panel"
        data-panel-id="${panel.id}"
        data-hub-span="${panel.id === "leave-review" ? "full" : "half"}"
        aria-pressed="${panel.id === activePanel.id ? "true" : "false"}"
      >
        <span class="hub-button__title">${escapeHtml(getHubPanelLabel(panel))}</span>
      </button>
    `)
    .join("");

  if (playerUiState.isViewingHubDetail && isTriviaPanel(activePanel)) {
    return renderTriviaDetail(eventName);
  }

  if (playerUiState.isViewingHubDetail && isBingoPanel(activePanel)) {
    return renderBingoDetail(eventName);
  }

  if (playerUiState.isViewingHubDetail && isStaticPagePanel(activePanel)) {
    return renderStaticPageDetail(eventName);
  }

  if (playerUiState.isViewingHubDetail && isReviewLinksPanel(activePanel)) {
    return renderReviewDetail(eventName);
  }

  if (playerUiState.isViewingHubDetail && isBottleListPanel(activePanel)) {
    return renderBottleListDetail(eventName);
  }

  return `
    <section class="player-section">
      <div class="player-detail-header player-hub-header">
        <div class="player-detail-header__top">
          <p class="eyebrow">Event Hub</p>
          <button type="button" class="text-link-button player-detail-back-link" data-action="edit-check-in">Edit Check-In</button>
        </div>
        <h2>${escapeHtml(eventName)}</h2>
        <p class="player-checkin-summary" data-player-welcome>${escapeHtml(getPlayerCheckInSummary(currentPlayer))}</p>
      </div>
      <div class="hub-panel player-hub-welcome">
        <p>${escapeHtml(getPlayerHubWelcomeMessage(eventName))}</p>
      </div>
      <div class="hub-grid player-hub-grid">
        ${hubButtonsMarkup}
      </div>
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
      unavailableButton.textContent = `${linkDefinition.label} Coming Soon`;
      reviewLinkDescription.textContent = "This review option is not available yet.";
      reviewLinkWrapper.append(reviewLinkHeading, unavailableButton, reviewLinkDescription);
    }

    reviewActionsNode.append(reviewLinkWrapper);
  });
}

function renderPlayerTriviaDetailContent(playerRoot, playerUiState) {
  const statusNode = playerRoot.querySelector("[data-player-trivia-status]");
  const panelNode = playerRoot.querySelector("[data-player-trivia-panel]");
  const currentRound = playerUiState.triviaRound;
  const savedAnswer = isValidTriviaAnswerForRound(playerUiState.triviaAnswer, currentRound)
    ? playerUiState.triviaAnswer
    : null;

  if (statusNode) {
    statusNode.innerHTML = "";

    if (playerUiState.triviaActionMessage.text) {
      statusNode.append(createPlayerNotice(playerUiState.triviaActionMessage.text, playerUiState.triviaActionMessage.tone));
    }

    if (playerUiState.isTriviaRoundLoading && !playerUiState.hasLoadedTriviaRound) {
      statusNode.append(createPlayerNotice("Loading the current Trivia question...", "info"));
    } else if (playerUiState.triviaRoundUnavailableMessage && !playerUiState.hasLoadedTriviaRound) {
      statusNode.append(createPlayerNotice("Trivia is temporarily unavailable right now.", "warning"));
    } else if (playerUiState.triviaRoundWarning) {
      statusNode.append(createPlayerNotice("Trivia is updating. Showing the latest available question.", "warning"));
    }

    if (hasActiveTriviaRound(currentRound)) {
      if (playerUiState.triviaAnswerUnavailableMessage && !playerUiState.hasLoadedTriviaAnswer) {
        statusNode.append(createPlayerNotice("Your saved answer is temporarily unavailable right now.", "warning"));
      } else if (playerUiState.triviaAnswerWarning) {
        statusNode.append(createPlayerNotice("Showing your latest saved answer.", "warning"));
      }
    }
  }

  if (!panelNode) {
    return;
  }

  panelNode.innerHTML = "";

  if (!hasActiveTriviaRound(currentRound)) {
    const waitingPanelNode = document.createElement("section");
    const waitingEyebrowNode = document.createElement("p");
    const waitingTitleNode = document.createElement("h3");

    waitingPanelNode.className = "hub-panel trivia-player-panel";
    waitingEyebrowNode.className = "eyebrow";
    waitingEyebrowNode.textContent = "Trivia";
    waitingTitleNode.textContent = "Waiting for the next question";
    waitingPanelNode.append(waitingEyebrowNode, waitingTitleNode);
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
  const optionsGridNode = document.createElement("div");

  triviaPanelNode.className = "trivia-player-panel";
  headerNode.className = "trivia-status-row";
  eyebrowNode.className = "eyebrow";
  eyebrowNode.textContent = "Live Trivia";
  titleNode.textContent = "Current Question";
  statusBadgeNode.className = "trivia-status-badge";
  statusBadgeNode.dataset.triviaStatus = currentRound.status;
  statusBadgeNode.textContent = getPlayerTriviaStatusText(currentRound);
  titleWrapNode.append(eyebrowNode, titleNode);
  headerNode.append(titleWrapNode, statusBadgeNode);
  questionNode.className = "trivia-question-copy";
  questionNode.textContent = currentRound.question;
  optionsGridNode.className = "trivia-answer-grid";

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
    answerButtonNode.textContent = `${optionIndex + 1}. ${optionValue}`;
    optionsGridNode.append(answerButtonNode);
  });

  triviaPanelNode.append(headerNode, questionNode, optionsGridNode);

  panelNode.append(triviaPanelNode);
}

function getBingoCompletedLineCount(completedLines) {
  return Array.isArray(completedLines) ? completedLines.length : 0;
}

function formatBingoStatsLine(matchState) {
  const matchCount = Number.isInteger(matchState?.matchCount) ? matchState.matchCount : 0;
  const lineCount = getBingoCompletedLineCount(matchState?.completedLines);

  return `Matches: ${matchCount}/${BINGO_CARD_ITEM_COUNT} | Lines: ${lineCount} | Blackout: ${matchState?.isBlackout ? "Yes" : "No"}`;
}

function renderBingoCardGrid(cardGridNode, bingoCard, matchState = null) {
  if (!cardGridNode) {
    return;
  }

  cardGridNode.innerHTML = "";
  const matchedPositionSet = matchState?.matchedPositionSet instanceof Set
    ? matchState.matchedPositionSet
    : new Set();

  bingoCard.items.forEach((itemValue, itemIndex) => {
    const itemNode = document.createElement("article");
    const nameNode = document.createElement("strong");
    const isMatched = matchedPositionSet.has(itemIndex);

    itemNode.className = "bingo-card-tile";
    itemNode.dataset.matched = isMatched ? "true" : "false";
    nameNode.textContent = itemValue.name;
    itemNode.append(nameNode);

    if (isMatched) {
      const matchLabelNode = document.createElement("span");

      matchLabelNode.className = "bingo-card-match";
      matchLabelNode.textContent = "Matched";
      itemNode.append(matchLabelNode);
    }

    cardGridNode.append(itemNode);
  });
}

function renderPlayerBingoDetailContent(playerRoot, playerUiState) {
  const statusNode = playerRoot.querySelector("[data-player-bingo-status]");
  const panelNode = playerRoot.querySelector("[data-player-bingo-panel]");
  const currentRound = playerUiState.bingoRound;
  const savedCard = isValidBingoPlayerCardForRound(playerUiState.bingoCard, currentRound)
    ? playerUiState.bingoCard
    : null;
  const drawState = hasPreparedBingoRound(currentRound)
    ? normalizeBingoRoundDraws(playerUiState.bingoDrawsValue, currentRound)
    : normalizeBingoRoundDraws(null);
  const matchState = savedCard
    ? calculateBingoWinnerMilestones(savedCard, drawState.orderedDraws)
    : null;

  if (statusNode) {
    statusNode.innerHTML = "";

    if (playerUiState.bingoActionMessage.text) {
      statusNode.append(createPlayerNotice(playerUiState.bingoActionMessage.text, playerUiState.bingoActionMessage.tone));
    }

    if (playerUiState.isBingoRoundLoading && !playerUiState.hasLoadedBingoRound) {
      statusNode.append(createPlayerNotice("Loading the current Bingo round...", "info"));
    } else if (playerUiState.bingoRoundUnavailableMessage && !playerUiState.hasLoadedBingoRound) {
      statusNode.append(createPlayerNotice("Bingo is temporarily unavailable right now.", "warning"));
    } else if (playerUiState.bingoRoundWarning) {
      statusNode.append(createPlayerNotice("Bingo is updating. Showing the latest available round.", "warning"));
    }

    if (hasPreparedBingoRound(currentRound)) {
      if (playerUiState.bingoCardUnavailableMessage && !playerUiState.hasLoadedBingoCard) {
        statusNode.append(createPlayerNotice("Your Bingo card is temporarily unavailable right now.", "warning"));
      } else if (playerUiState.bingoCardWarning) {
        statusNode.append(createPlayerNotice("Showing your latest saved Bingo card.", "warning"));
      }

      if (playerUiState.bingoDrawsUnavailableMessage && !playerUiState.hasLoadedBingoDraws) {
        statusNode.append(createPlayerNotice("Recent Bingo draws are temporarily unavailable right now.", "warning"));
      } else if (playerUiState.bingoDrawsWarning) {
        statusNode.append(createPlayerNotice("Showing the latest available Bingo draws.", "warning"));
      }

      if (playerUiState.isSavingBingoCard) {
        statusNode.append(createPlayerNotice("Saving your Bingo card...", "info"));
      }

      if (playerUiState.isBingoDrawsLoading && !playerUiState.hasLoadedBingoDraws) {
        statusNode.append(createPlayerNotice("Loading recent Bingo draws...", "info"));
      }

      if (drawState.errors.length > 0) {
        statusNode.append(createPlayerNotice("Recent Bingo draws are refreshing.", "warning"));
      }
    }
  }

  if (!panelNode) {
    return;
  }

  panelNode.innerHTML = "";

  if (!hasPreparedBingoRound(currentRound)) {
    const waitingPanelNode = document.createElement("section");
    const waitingCardNode = document.createElement("div");
    const waitingStatusNode = document.createElement("p");

    waitingPanelNode.className = "bingo-player-panel";
    waitingCardNode.className = "hub-panel bingo-player-card bingo-player-card--waiting";
    waitingStatusNode.className = "bingo-round-status";
    waitingStatusNode.textContent = PLAYER_BINGO_WAITING_MESSAGE;
    waitingCardNode.append(waitingStatusNode);
    waitingPanelNode.append(waitingCardNode);
    panelNode.append(waitingPanelNode);
    return;
  }

  const bingoPanelNode = document.createElement("section");
  const bingoCardWrapNode = document.createElement("div");
  const roundStatusNode = document.createElement("p");
  const cardGridNode = document.createElement("div");

  bingoPanelNode.className = "bingo-player-panel";
  bingoCardWrapNode.className = "hub-panel bingo-player-card";
  roundStatusNode.className = "bingo-round-status";
  roundStatusNode.textContent = getPlayerBingoStatusLine(currentRound);
  cardGridNode.className = "bingo-card-grid";
  bingoCardWrapNode.append(roundStatusNode);

  if (currentRound.activePool.length < BINGO_CARD_ITEM_COUNT) {
    roundStatusNode.textContent = PLAYER_BINGO_WAITING_MESSAGE;
    bingoPanelNode.append(bingoCardWrapNode);
    panelNode.append(bingoPanelNode);
    return;
  }

  if (!savedCard) {
    const loadingCopyNode = document.createElement("p");

    loadingCopyNode.className = "player-copy bingo-card-loading";

    if (playerUiState.isSavingBingoCard) {
      loadingCopyNode.textContent = "Saving your Bingo card...";
    } else if (playerUiState.isBingoCardLoading) {
      loadingCopyNode.textContent = "Getting your Bingo card ready...";
    } else if (isBingoRoundOpen(currentRound)) {
      loadingCopyNode.textContent = "Your Bingo card will appear in a moment.";
    } else {
      loadingCopyNode.textContent = "Your Bingo card is not available for this round.";
    }

    bingoCardWrapNode.append(loadingCopyNode);
  } else {
    const statsNode = document.createElement("p");

    statsNode.className = "bingo-stats-line";
    statsNode.textContent = formatBingoStatsLine(matchState);
    bingoCardWrapNode.append(statsNode);

    if (matchState.isLineWinner) {
      const lineWinnerNode = document.createElement("div");

      lineWinnerNode.className = "trivia-result-pill bingo-win-pill";
      lineWinnerNode.dataset.tone = matchState.isBlackout ? "success" : "info";
      lineWinnerNode.textContent = matchState.isBlackout
        ? "Blackout Winner"
        : "Line Winner";
      bingoCardWrapNode.append(lineWinnerNode);
    }

    renderBingoCardGrid(cardGridNode, savedCard, matchState);
    bingoCardWrapNode.append(cardGridNode);

    if (isBingoRoundOpen(currentRound)) {
      const actionsNode = document.createElement("div");
      const shuffleButtonNode = document.createElement("button");

      actionsNode.className = "player-form-actions player-form-actions--bingo";
      shuffleButtonNode.type = "button";
      shuffleButtonNode.className = "primary-button";
      shuffleButtonNode.dataset.action = "shuffle-bingo-card";
      shuffleButtonNode.disabled = playerUiState.isSavingBingoCard;
      shuffleButtonNode.textContent = playerUiState.isSavingBingoCard ? "Saving Bingo Card..." : "Shuffle Card";
      actionsNode.append(shuffleButtonNode);
      bingoCardWrapNode.append(actionsNode);
    }
  }

  bingoPanelNode.append(bingoCardWrapNode);
  panelNode.append(bingoPanelNode);
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
      zipField.value = sanitizeZipInput(playerRecord.zip || "");
    }

    if (emailField instanceof HTMLInputElement) {
      emailField.value = playerRecord.email || "";
    }
  }

  if (playerUiState.isViewingHubDetail && isTriviaPanel(activePanel)) {
    renderPlayerTriviaDetailContent(playerRoot, playerUiState);
  }

  if (playerUiState.isViewingHubDetail && isBingoPanel(activePanel)) {
    renderPlayerBingoDetailContent(playerRoot, playerUiState);
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
    bingoRound: normalizeBingoCurrentRound(null),
    hasLoadedBingoRound: false,
    isBingoRoundLoading: true,
    bingoRoundWarning: "",
    bingoRoundUnavailableMessage: "",
    bingoCard: createEmptyBingoPlayerCard(),
    hasLoadedBingoCard: false,
    isBingoCardLoading: false,
    bingoCardWarning: "",
    bingoCardUnavailableMessage: "",
    bingoDrawsValue: null,
    hasLoadedBingoDraws: false,
    isBingoDrawsLoading: false,
    bingoDrawsWarning: "",
    bingoDrawsUnavailableMessage: "",
    bingoActionMessage: {
      text: "",
      tone: "info",
    },
    activeBingoCardRoundId: "",
    activeBingoDrawsRoundId: "",
    isSavingBingoCard: false,
    bingoCardGenerationGuardKey: "",
  };

  function setPlayerMessage(text = "", tone = "info") {
    playerUiState.playerMessage = { text, tone };
  }

  function setTriviaActionMessage(text = "", tone = "info") {
    playerUiState.triviaActionMessage = { text, tone };
  }

  function setBingoActionMessage(text = "", tone = "info") {
    playerUiState.bingoActionMessage = { text, tone };
  }

  function getActiveTriviaPlayerId() {
    const currentState = state.getState();
    return currentState.deviceId || currentState.currentPlayer?.playerId || getOrCreateDeviceId();
  }

  function getActiveBingoPlayerId() {
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

  function resetBingoCardGenerationGuard() {
    playerUiState.bingoCardGenerationGuardKey = "";
  }

  function clearPlayerBingoCardState() {
    playerUiState.bingoCard = createEmptyBingoPlayerCard();
    playerUiState.hasLoadedBingoCard = false;
    playerUiState.isBingoCardLoading = false;
    playerUiState.bingoCardWarning = "";
    playerUiState.bingoCardUnavailableMessage = "";
    playerUiState.isSavingBingoCard = false;
  }

  function clearPlayerBingoDrawState() {
    playerUiState.bingoDrawsValue = null;
    playerUiState.hasLoadedBingoDraws = false;
    playerUiState.isBingoDrawsLoading = false;
    playerUiState.bingoDrawsWarning = "";
    playerUiState.bingoDrawsUnavailableMessage = "";
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

  function detachPlayerBingoCardListener({ clearState = true, resetGuard = true } = {}) {
    if (typeof unsubscribePlayerBingoCardListener === "function") {
      unsubscribePlayerBingoCardListener();
    }

    unsubscribePlayerBingoCardListener = null;
    playerUiState.activeBingoCardRoundId = "";

    if (clearState) {
      clearPlayerBingoCardState();
    }

    if (resetGuard) {
      resetBingoCardGenerationGuard();
    }
  }

  function detachPlayerBingoDrawListener({ clearState = true } = {}) {
    if (typeof unsubscribePlayerBingoDrawsListener === "function") {
      unsubscribePlayerBingoDrawsListener();
    }

    unsubscribePlayerBingoDrawsListener = null;
    playerUiState.activeBingoDrawsRoundId = "";

    if (clearState) {
      clearPlayerBingoDrawState();
    }
  }

  function detachPlayerBingoDetailListeners({ clearState = true, resetGuard = true } = {}) {
    detachPlayerBingoCardListener({ clearState, resetGuard });
    detachPlayerBingoDrawListener({ clearState });
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
            playerUiState.triviaAnswerWarning = "Showing your latest saved answer.";
          } else {
            playerUiState.triviaAnswerUnavailableMessage = "Your saved answer is temporarily unavailable right now.";
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
            playerUiState.triviaAnswerWarning = "Showing your latest saved answer.";
          } else {
            playerUiState.triviaAnswerUnavailableMessage = "Your saved answer is temporarily unavailable right now.";
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

  function isViewingBingoDetail() {
    const activePanel = getHubPanel(state.getState().activeHubPanel);
    return playerUiState.isViewingHubDetail && isBingoPanel(activePanel);
  }

  function getBingoCardGenerationGuardKey(roundId, playerId) {
    return `${normalizeTextInput(roundId)}:${normalizeTextInput(playerId)}`;
  }

  async function revalidateBingoRoundForCardWrite(expectedRoundId) {
    if (!isViewingBingoDetail()) {
      playerUiState.isSavingBingoCard = false;
      playerUiState.isBingoCardLoading = false;
      return null;
    }

    const latestRoundValue = await firebase.readEventData(BINGO_LIVE_CURRENT_ROUND_PATH);
    const latestRound = normalizeBingoCurrentRound(latestRoundValue);

    if (!latestRound.isValid || !hasPreparedBingoRound(latestRound)) {
      playerUiState.isSavingBingoCard = false;
      playerUiState.isBingoCardLoading = false;
      setBingoActionMessage("The Bingo round is no longer available. Please wait for the latest round to load.", "warning");
      renderPlayerView();
      return null;
    }

    if (latestRound.roundId !== expectedRoundId || playerUiState.bingoRound.roundId !== expectedRoundId) {
      playerUiState.isSavingBingoCard = false;
      playerUiState.isBingoCardLoading = false;
      setBingoActionMessage("The Bingo round changed before your card could be saved. Please wait for the latest round to load.", "warning");
      renderPlayerView();
      return null;
    }

    if (!isBingoRoundOpen(latestRound)) {
      playerUiState.isSavingBingoCard = false;
      playerUiState.isBingoCardLoading = false;
      setBingoActionMessage("This Bingo round is no longer accepting new or shuffled cards.", "warning");
      renderPlayerView();
      return null;
    }

    if (latestRound.activePool.length < BINGO_CARD_ITEM_COUNT) {
      playerUiState.isSavingBingoCard = false;
      playerUiState.isBingoCardLoading = false;
      setBingoActionMessage("This Bingo round is not ready for cards yet.", "warning");
      renderPlayerView();
      return null;
    }

    return latestRound;
  }

  async function maybeGeneratePlayerBingoCard(round, playerId = getActiveBingoPlayerId()) {
    const currentPlayer = state.getState().currentPlayer;
    const normalizedRound = normalizeBingoCurrentRound(round);
    const generationGuardKey = getBingoCardGenerationGuardKey(normalizedRound.roundId, playerId);

    if (!currentPlayer || !firebase.getStatus().isConnected || !isViewingBingoDetail()) {
      return;
    }

    if (!isBingoRoundOpen(normalizedRound) || normalizedRound.activePool.length < BINGO_CARD_ITEM_COUNT) {
      playerUiState.isBingoCardLoading = false;
      playerUiState.bingoCardUnavailableMessage = "This Bingo round is not ready for cards yet.";
      renderPlayerView();
      return;
    }

    if (playerUiState.bingoCardGenerationGuardKey === generationGuardKey || playerUiState.isSavingBingoCard) {
      return;
    }

    playerUiState.bingoCardGenerationGuardKey = generationGuardKey;
    playerUiState.isSavingBingoCard = true;
    playerUiState.isBingoCardLoading = true;
    playerUiState.bingoCardUnavailableMessage = "";
    playerUiState.bingoCardWarning = "";
    setBingoActionMessage();
    renderPlayerView();

    const revalidatedRound = await revalidateBingoRoundForCardWrite(normalizedRound.roundId);

    if (!revalidatedRound) {
      resetBingoCardGenerationGuard();
      return;
    }

    if (!isViewingBingoDetail() || playerUiState.bingoRound.roundId !== revalidatedRound.roundId) {
      playerUiState.isSavingBingoCard = false;
      playerUiState.isBingoCardLoading = false;
      resetBingoCardGenerationGuard();
      return;
    }

    const createdAt = new Date().toISOString();
    const nextCardPayload = buildBingoPlayerCardPayload({
      roundId: revalidatedRound.roundId,
      playerId,
      items: sampleBingoItems(revalidatedRound.activePool, BINGO_CARD_ITEM_COUNT),
      createdAt,
      updatedAt: createdAt,
      shuffleCount: 0,
    }, revalidatedRound);
    const saveSucceeded = await firebase.writeEventData(
      getBingoPlayerCardPath(revalidatedRound.roundId, playerId),
      nextCardPayload
    );

    playerUiState.isSavingBingoCard = false;
    playerUiState.isBingoCardLoading = false;

    if (!saveSucceeded) {
      resetBingoCardGenerationGuard();
      setBingoActionMessage(firebase.getStatus().message || "We could not save your Bingo card right now. Please try again.", "error");
      renderPlayerView();
      return;
    }

    if (playerUiState.bingoRound.roundId === revalidatedRound.roundId) {
      playerUiState.bingoCard = normalizeBingoPlayerCard(nextCardPayload, revalidatedRound, {
        roundId: revalidatedRound.roundId,
        playerId,
      });
      playerUiState.hasLoadedBingoCard = true;
      playerUiState.bingoCardUnavailableMessage = "";
      playerUiState.bingoCardWarning = "";
    }

    setBingoActionMessage();
    renderPlayerView();
  }

  function syncPlayerBingoCardListener(round) {
    const normalizedRound = normalizeBingoCurrentRound(round);

    if (!isViewingBingoDetail() || !hasPreparedBingoRound(normalizedRound) || !normalizedRound.roundId) {
      detachPlayerBingoCardListener({ clearState: true, resetGuard: true });
      return;
    }

    if (playerUiState.activeBingoCardRoundId === normalizedRound.roundId && typeof unsubscribePlayerBingoCardListener === "function") {
      return;
    }

    const playerId = getActiveBingoPlayerId();

    detachPlayerBingoCardListener({ clearState: true, resetGuard: true });
    playerUiState.activeBingoCardRoundId = normalizedRound.roundId;
    playerUiState.isBingoCardLoading = true;
    playerUiState.bingoCardUnavailableMessage = "";
    playerUiState.bingoCardWarning = "";

    unsubscribePlayerBingoCardListener = firebase.listenEventData(
      getBingoPlayerCardPath(normalizedRound.roundId, playerId),
      (cardValue, listenerStatus) => {
        if (playerUiState.activeBingoCardRoundId !== normalizedRound.roundId) {
          return;
        }

        if (!listenerStatus.ok) {
          playerUiState.isBingoCardLoading = false;

          if (playerUiState.hasLoadedBingoCard) {
            playerUiState.bingoCardWarning = "Showing your latest saved Bingo card.";
          } else {
            playerUiState.bingoCardUnavailableMessage = "Your Bingo card is temporarily unavailable right now.";
          }

          renderPlayerView();
          return;
        }

        const normalizedCard = normalizeBingoPlayerCard(cardValue, normalizedRound, {
          roundId: normalizedRound.roundId,
          playerId,
        });

        if (normalizedCard.isEmpty) {
          playerUiState.isBingoCardLoading = true;
          playerUiState.hasLoadedBingoCard = false;
          playerUiState.bingoCardWarning = "";
          playerUiState.bingoCardUnavailableMessage = "";
          renderPlayerView();

          if (isBingoRoundOpen(normalizedRound)) {
            void maybeGeneratePlayerBingoCard(normalizedRound, playerId);
          } else {
            playerUiState.isBingoCardLoading = false;
            renderPlayerView();
          }

          return;
        }

        if (!normalizedCard.isValid) {
          playerUiState.isBingoCardLoading = false;

          if (playerUiState.hasLoadedBingoCard) {
            playerUiState.bingoCardWarning = "Showing your latest saved Bingo card.";
          } else {
            playerUiState.bingoCardUnavailableMessage = "Your Bingo card is temporarily unavailable right now.";
          }

          renderPlayerView();
          return;
        }

        playerUiState.bingoCard = normalizedCard;
        playerUiState.hasLoadedBingoCard = true;
        playerUiState.isBingoCardLoading = false;
        playerUiState.bingoCardWarning = "";
        playerUiState.bingoCardUnavailableMessage = "";
        renderPlayerView();
      }
    );
  }

  function syncPlayerBingoDrawListener(round) {
    const normalizedRound = normalizeBingoCurrentRound(round);

    if (!isViewingBingoDetail() || !hasPreparedBingoRound(normalizedRound) || !normalizedRound.roundId) {
      detachPlayerBingoDrawListener({ clearState: true });
      return;
    }

    if (playerUiState.activeBingoDrawsRoundId === normalizedRound.roundId && typeof unsubscribePlayerBingoDrawsListener === "function") {
      return;
    }

    detachPlayerBingoDrawListener({ clearState: true });
    playerUiState.activeBingoDrawsRoundId = normalizedRound.roundId;
    playerUiState.isBingoDrawsLoading = true;
    playerUiState.bingoDrawsUnavailableMessage = "";
    playerUiState.bingoDrawsWarning = "";

    unsubscribePlayerBingoDrawsListener = firebase.listenEventData(
      getBingoRoundDrawsPath(normalizedRound.roundId),
      (drawsValue, listenerStatus) => {
        if (playerUiState.activeBingoDrawsRoundId !== normalizedRound.roundId) {
          return;
        }

        if (!listenerStatus.ok) {
          playerUiState.isBingoDrawsLoading = false;

          if (playerUiState.hasLoadedBingoDraws) {
            playerUiState.bingoDrawsWarning = "Showing the latest available Bingo draws.";
          } else {
            playerUiState.bingoDrawsUnavailableMessage = "Recent Bingo draws are temporarily unavailable right now.";
          }

          renderPlayerView();
          return;
        }

        playerUiState.bingoDrawsValue = drawsValue;
        playerUiState.hasLoadedBingoDraws = true;
        playerUiState.isBingoDrawsLoading = false;
        playerUiState.bingoDrawsWarning = "";
        playerUiState.bingoDrawsUnavailableMessage = "";
        renderPlayerView();
      }
    );
  }

  function attachPlayerBingoRoundListener() {
    if (typeof unsubscribePlayerBingoRoundListener === "function") {
      unsubscribePlayerBingoRoundListener();
      unsubscribePlayerBingoRoundListener = null;
    }

    playerUiState.isBingoRoundLoading = !playerUiState.hasLoadedBingoRound;

    unsubscribePlayerBingoRoundListener = firebase.listenEventData(
      BINGO_LIVE_CURRENT_ROUND_PATH,
      (roundValue, listenerStatus) => {
        if (!listenerStatus.ok) {
          playerUiState.isBingoRoundLoading = false;

          if (playerUiState.hasLoadedBingoRound) {
            playerUiState.bingoRoundWarning = "Showing the latest available Bingo round.";
          } else {
            playerUiState.bingoRoundUnavailableMessage = "Bingo is temporarily unavailable right now.";
            playerUiState.bingoRound = createEmptyBingoCurrentRound();
            detachPlayerBingoDetailListeners({ clearState: true, resetGuard: true });
          }

          renderPlayerView();
          return;
        }

        const normalizedRound = normalizeBingoCurrentRound(roundValue);

        if (!normalizedRound.isValid) {
          playerUiState.isBingoRoundLoading = false;

          if (playerUiState.hasLoadedBingoRound) {
            playerUiState.bingoRoundWarning = "Showing the latest available Bingo round.";
          } else {
            playerUiState.bingoRoundUnavailableMessage = "Bingo is temporarily unavailable right now.";
            playerUiState.bingoRound = createEmptyBingoCurrentRound();
            detachPlayerBingoDetailListeners({ clearState: true, resetGuard: true });
          }

          renderPlayerView();
          return;
        }

        const previousRoundId = playerUiState.bingoRound.roundId;
        const didRoundChange = previousRoundId !== normalizedRound.roundId;

        if (!hasPreparedBingoRound(normalizedRound) || didRoundChange) {
          detachPlayerBingoDetailListeners({ clearState: true, resetGuard: true });
          setBingoActionMessage();
        }

        playerUiState.bingoRound = normalizedRound;
        playerUiState.hasLoadedBingoRound = true;
        playerUiState.isBingoRoundLoading = false;
        playerUiState.bingoRoundWarning = "";
        playerUiState.bingoRoundUnavailableMessage = "";
        syncPlayerBingoCardListener(normalizedRound);
        syncPlayerBingoDrawListener(normalizedRound);
        renderPlayerView();
      }
    );
  }

  function renderPlayerView() {
    const currentState = state.getState();
    const currentPlayer = currentState.currentPlayer;
    const eventName = getPlayerEventTitle(currentState.eventConfig);
    let viewMarkup = "";

    if (currentPlayer && !playerUiState.isEditingCheckIn) {
      viewMarkup = renderHub(state, playerUiState);
    } else if (currentState.hasPassedAgeGate) {
      viewMarkup = renderCheckInForm({
        canSave: firebase.getStatus().isConnected && !playerUiState.isSubmitting,
        isEditing: playerUiState.isEditingCheckIn,
        eventName,
      });
    } else if (playerUiState.ageGateDeclined) {
      viewMarkup = renderAgeGateBlocked(eventName);
    } else {
      viewMarkup = renderAgeGate(eventName);
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
          playerUiState.bottleListWarning = "Showing the latest posted bottle list.";
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
            playerUiState.triviaRoundWarning = "Showing the latest available Trivia question.";
          } else {
            playerUiState.triviaRoundUnavailableMessage = "Trivia is temporarily unavailable right now.";
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
            playerUiState.triviaRoundWarning = "Showing the latest available Trivia question.";
          } else {
            playerUiState.triviaRoundUnavailableMessage = "Trivia is temporarily unavailable right now.";
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

    if (!isValidZipCode(zip)) {
      return "Please enter a valid 5-digit ZIP code.";
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

  async function shufflePlayerBingoCard() {
    const currentPlayer = state.getState().currentPlayer;
    const currentRound = playerUiState.bingoRound;
    const savedCard = isValidBingoPlayerCardForRound(playerUiState.bingoCard, currentRound)
      ? playerUiState.bingoCard
      : null;

    if (!currentPlayer) {
      setBingoActionMessage("Please complete check-in before using Bingo.", "warning");
      renderPlayerView();
      return;
    }

    if (!firebase.getStatus().isConnected) {
      setBingoActionMessage("Bingo cards are temporarily unavailable because the event connection is not ready.", "warning");
      renderPlayerView();
      return;
    }

    if (!savedCard) {
      setBingoActionMessage("Your saved Bingo card is still loading for this round.", "warning");
      renderPlayerView();
      return;
    }

    if (!isBingoRoundOpen(currentRound) || !currentRound.roundId) {
      setBingoActionMessage("This Bingo round is no longer accepting new or shuffled cards.", "warning");
      renderPlayerView();
      return;
    }

    if (currentRound.activePool.length < BINGO_CARD_ITEM_COUNT) {
      setBingoActionMessage("This Bingo round is not ready for shuffling yet.", "warning");
      renderPlayerView();
      return;
    }

    const playerId = getActiveBingoPlayerId();
    const roundIdAtShuffle = currentRound.roundId;

    playerUiState.isSavingBingoCard = true;
    setBingoActionMessage();
    renderPlayerView();

    const revalidatedRound = await revalidateBingoRoundForCardWrite(roundIdAtShuffle);

    if (!revalidatedRound) {
      return;
    }

    if (!isViewingBingoDetail() || playerUiState.bingoRound.roundId !== revalidatedRound.roundId) {
      playerUiState.isSavingBingoCard = false;
      return;
    }

    const nextCardPayload = buildBingoPlayerCardPayload({
      roundId: roundIdAtShuffle,
      playerId,
      items: sampleBingoItems(revalidatedRound.activePool, BINGO_CARD_ITEM_COUNT),
      createdAt: savedCard.createdAt,
      updatedAt: new Date().toISOString(),
      shuffleCount: savedCard.shuffleCount + 1,
    }, revalidatedRound);
    const saveSucceeded = await firebase.updateEventData(
      getBingoPlayerCardPath(roundIdAtShuffle, playerId),
      {
        items: nextCardPayload.items,
        updatedAt: nextCardPayload.updatedAt,
        shuffleCount: nextCardPayload.shuffleCount,
      }
    );

    playerUiState.isSavingBingoCard = false;

    if (!saveSucceeded) {
      setBingoActionMessage(firebase.getStatus().message || "We could not shuffle your Bingo card right now. Please try again.", "error");
      renderPlayerView();
      return;
    }

    if (playerUiState.bingoRound.roundId === roundIdAtShuffle) {
      playerUiState.bingoCard = normalizeBingoPlayerCard({
        ...savedCard,
        items: nextCardPayload.items,
        updatedAt: nextCardPayload.updatedAt,
        shuffleCount: nextCardPayload.shuffleCount,
      }, revalidatedRound, {
        roundId: roundIdAtShuffle,
        playerId,
      });
      playerUiState.hasLoadedBingoCard = true;
      playerUiState.isBingoCardLoading = false;
      playerUiState.bingoCardWarning = "";
      playerUiState.bingoCardUnavailableMessage = "";
    }

    setBingoActionMessage();
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
      syncPlayerBingoCardListener(playerUiState.bingoRound);
      syncPlayerBingoDrawListener(playerUiState.bingoRound);
      renderPlayerView();
      return;
    }

    if (action === "back-to-hub") {
      playerUiState.isViewingHubDetail = false;
      state.patch({ activeHubPanel: DEFAULT_HUB_PANEL_ID });
      detachPlayerBingoDetailListeners({ clearState: true, resetGuard: true });
      setBingoActionMessage();
      renderPlayerView();
      return;
    }

    if (action === "edit-check-in") {
      playerUiState.isEditingCheckIn = true;
      playerUiState.isViewingHubDetail = false;
      detachPlayerBingoDetailListeners({ clearState: true, resetGuard: true });
      setBingoActionMessage();
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
      return;
    }

    if (action === "shuffle-bingo-card") {
      await shufflePlayerBingoCard();
    }
  };

  activePlayerInputHandler = (event) => {
    const inputNode = event.target;

    if (!(inputNode instanceof HTMLInputElement) || inputNode.id !== "player-zip") {
      return;
    }

    const sanitizedZip = sanitizeZipInput(inputNode.value);

    if (inputNode.value !== sanitizedZip) {
      inputNode.value = sanitizedZip;
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
    const zip = sanitizeZipInput(formData.get("zip"));
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
    setPlayerMessage();
    renderPlayerView();
  };

  playerRoot.addEventListener("click", activePlayerClickHandler);
  playerRoot.addEventListener("input", activePlayerInputHandler);
  playerRoot.addEventListener("submit", activePlayerSubmitHandler);
  activePlayerRoot = playerRoot;

  attachRealtimeContentListeners();
  attachPlayerTriviaRoundListener();
  attachPlayerBingoRoundListener();
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
    ? "Player check-in is ready."
    : "Player check-in will be available once the event connection is live.";

  renderStatus(firebaseMessage, firebase.isConfigured ? "info" : "warning");

  return {
    statusMessage: firebaseMessage,
  };
}

import { initRoleProtectedPage } from "./role-access.js";
import {
  escapeHtml,
  isValidAbsoluteHttpUrl,
  normalizeTextInput,
} from "./utils.js";
import {
  buildBottleListPayload,
  DEFAULT_PUBLIC_BOTTLE_LIST_TITLE,
  hasBottleListItems,
  normalizeBottleList,
  parseBottleListSource,
  PUBLIC_BOTTLE_LIST_PATH,
  reconstructBottleListSource,
} from "./bottle-list.js";
import {
  buildTriviaQuestionPoolPayload,
  normalizeTriviaQuestionPool,
  parseTriviaQuestionPoolJson,
  reconstructTriviaQuestionPoolJson,
  TRIVIA_QUESTION_POOL_PATH,
  TRIVIA_QUESTION_POOL_SAFE_EXAMPLE_JSON,
} from "./trivia-pool.js";
import {
  REVIEW_LINK_DEFINITIONS,
  STATIC_PAGE_DEFINITIONS,
  normalizeMultilineText,
  normalizeReviewLinks,
  normalizeStaticPages,
} from "./static-pages.js";

const ADMIN_ROOT_SELECTOR = "#admin-app";

let activeAdminRoot = null;
let activeAdminClickHandler = null;
let activeAdminInputHandler = null;
let activeAdminSubmitHandler = null;

const ADMIN_RESERVED_CARDS = [
  {
    title: "Event Settings",
    description: "Future event-level settings and scheduling controls will live here.",
  },
  {
    title: "Player Management",
    description: "Future player lookup and record maintenance tools will stay in the Admin area.",
  },
  {
    title: "Exports",
    description: "Future export tools remain reserved for Admin-only access.",
  },
];

function renderSectionNotice(message) {
  if (!message.text) {
    return "";
  }

  return `
    <div class="notice-panel" data-tone="${escapeHtml(message.tone)}" aria-live="polite">
      ${escapeHtml(message.text)}
    </div>
  `;
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

function renderBottleListValidationErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) {
    return "";
  }

  const errorItemsMarkup = errors
    .map((error) => `<li>Line ${escapeHtml(error.lineNumber)}: ${escapeHtml(error.message)}</li>`)
    .join("");

  return `
    <div class="notice-panel validation-panel" data-tone="error" aria-live="polite">
      <p class="validation-title">Fix these lines before saving:</p>
      <ul class="validation-list">
        ${errorItemsMarkup}
      </ul>
    </div>
  `;
}

function renderTriviaQuestionValidationErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) {
    return "";
  }

  const errorItemsMarkup = errors
    .map((error) => `<li>${escapeHtml(error)}</li>`)
    .join("");

  return `
    <div class="notice-panel validation-panel" data-tone="error" aria-live="polite">
      <p class="validation-title">Fix these Trivia Question Pool issues before replacing:</p>
      <ul class="validation-list">
        ${errorItemsMarkup}
      </ul>
    </div>
  `;
}

function renderBottleListGroupsMarkup(groups) {
  return groups
    .map((group) => {
      const itemRowsMarkup = group.items
        .map((item) => `
          <tr>
            <td>${escapeHtml(item.name)}</td>
            <td>${escapeHtml(item.quantity)}</td>
            <td>${escapeHtml(item.price)}</td>
          </tr>
        `)
        .join("");

      return `
        <article class="hub-panel bottle-list-group">
          <h4>${escapeHtml(group.title)}</h4>
          <div class="bottle-list-table-wrap">
            <table class="bottle-list-table">
              <thead>
                <tr>
                  <th scope="col">Bottle</th>
                  <th scope="col">Qty</th>
                  <th scope="col">Price</th>
                </tr>
              </thead>
              <tbody>
                ${itemRowsMarkup}
              </tbody>
            </table>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderBottleListPreview(previewResult) {
  if (!previewResult) {
    return "";
  }

  if (previewResult.isEmpty) {
    return `
      <section class="bottle-list-preview" aria-live="polite">
        <div>
          <p class="eyebrow">Preview</p>
          <h4>Grouped Bottle List Preview</h4>
          <p class="player-copy">No bottle rows were found in the current text.</p>
        </div>
        <div class="hub-panel bottle-list-empty-panel">
          <p>Blank or empty text will not overwrite the current Firebase list.</p>
          <p>Use Clear Public Bottle List if you intentionally want an empty public list.</p>
        </div>
      </section>
    `;
  }

  const bottleLabel = previewResult.itemCount === 1 ? "bottle" : "bottles";
  const groupLabel = previewResult.groups.length === 1 ? "group" : "groups";

  return `
    <section class="bottle-list-preview" aria-live="polite">
      <div>
        <p class="eyebrow">Preview</p>
        <h4>Grouped Bottle List Preview</h4>
        <p class="player-copy">Showing ${escapeHtml(previewResult.itemCount)} ${bottleLabel} across ${escapeHtml(previewResult.groups.length)} ${groupLabel}.</p>
      </div>
      <div class="bottle-list-group-grid">
        ${renderBottleListGroupsMarkup(previewResult.groups)}
      </div>
    </section>
  `;
}

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

function renderTriviaCountGrid(countsNode, counts) {
  if (!countsNode) {
    return;
  }

  countsNode.innerHTML = "";

  [
    { label: "Easy", value: counts.easy },
    { label: "Medium", value: counts.medium },
    { label: "Hard", value: counts.hard },
    { label: "Total", value: counts.total },
  ].forEach((countDefinition) => {
    const countNode = document.createElement("article");
    const valueNode = document.createElement("strong");
    const labelNode = document.createElement("span");

    countNode.className = "trivia-count-card";
    valueNode.textContent = String(countDefinition.value);
    labelNode.textContent = countDefinition.label;
    countNode.append(valueNode, labelNode);
    countsNode.append(countNode);
  });
}

function createTriviaMetaRow(label, value) {
  const rowNode = document.createElement("p");
  const labelNode = document.createElement("strong");

  rowNode.className = "trivia-question-meta";
  labelNode.textContent = `${label}: `;
  rowNode.append(labelNode, document.createTextNode(value));
  return rowNode;
}

function createTriviaOptionsList(question) {
  const optionsListNode = document.createElement("ol");

  optionsListNode.className = "trivia-options-list";
  question.options.forEach((optionValue, optionIndex) => {
    const optionNode = document.createElement("li");

    optionNode.textContent = `${optionIndex}. ${optionValue}`;
    optionsListNode.append(optionNode);
  });

  return optionsListNode;
}

function createTriviaPreviewCard(question, questionIndex) {
  const cardNode = document.createElement("article");
  const headerNode = document.createElement("div");
  const titleNode = document.createElement("h4");
  const difficultyBadgeNode = document.createElement("span");
  const questionCopyNode = document.createElement("p");
  const answerIndexNode = document.createElement("p");
  const answerTextNode = document.createElement("p");

  cardNode.className = "hub-panel trivia-question-card";
  headerNode.className = "trivia-question-header";
  titleNode.textContent = `Question ${questionIndex + 1}`;
  difficultyBadgeNode.className = "trivia-difficulty-badge";
  difficultyBadgeNode.dataset.difficulty = question.difficulty;
  difficultyBadgeNode.textContent = question.difficulty;
  questionCopyNode.className = "trivia-question-copy";
  questionCopyNode.textContent = question.question;
  answerIndexNode.className = "trivia-answer-note";
  answerIndexNode.textContent = `Correct answer index: ${question.answer}`;
  answerTextNode.className = "trivia-answer-note";
  answerTextNode.textContent = `Correct answer text: ${question.options[question.answer]}`;

  headerNode.append(titleNode, difficultyBadgeNode);
  cardNode.append(
    headerNode,
    createTriviaMetaRow("ID", question.id),
    createTriviaMetaRow("Difficulty", question.difficulty),
    questionCopyNode,
    createTriviaOptionsList(question),
    answerIndexNode,
    answerTextNode
  );

  return cardNode;
}

function renderTriviaQuestionPoolPreview(previewNode, previewResult) {
  if (!previewNode) {
    return;
  }

  previewNode.innerHTML = "";

  if (!previewResult) {
    return;
  }

  const previewSectionNode = document.createElement("section");
  const previewHeaderNode = document.createElement("div");
  const eyebrowNode = document.createElement("p");
  const titleNode = document.createElement("h4");
  const copyNode = document.createElement("p");
  const countGridNode = document.createElement("div");
  const cardsNode = document.createElement("div");

  previewSectionNode.className = "trivia-preview";
  previewHeaderNode.className = "trivia-preview-header";
  eyebrowNode.className = "eyebrow";
  eyebrowNode.textContent = "Preview";
  titleNode.textContent = "Trivia Question Pool Preview";
  copyNode.className = "player-copy";
  countGridNode.className = "trivia-count-grid";
  cardsNode.className = "trivia-question-list";

  renderTriviaCountGrid(countGridNode, previewResult.counts);

  if (previewResult.isEmpty) {
    const emptyPanelNode = document.createElement("div");
    const emptyCopyNode = document.createElement("p");

    copyNode.textContent = "This preview is empty.";
    emptyPanelNode.className = "hub-panel trivia-empty-panel";
    emptyCopyNode.textContent = "Replace will refuse empty arrays. Use Clear Question Pool if you intentionally want an empty saved pool.";
    emptyPanelNode.append(emptyCopyNode);
    cardsNode.append(emptyPanelNode);
  } else {
    const questionLabel = previewResult.questions.length === 1 ? "question" : "questions";

    copyNode.textContent = `Showing ${previewResult.questions.length} ${questionLabel} in saved order.`;
    previewResult.questions.forEach((question, questionIndex) => {
      cardsNode.append(createTriviaPreviewCard(question, questionIndex));
    });
  }

  previewHeaderNode.append(eyebrowNode, titleNode, copyNode);
  previewSectionNode.append(previewHeaderNode, countGridNode, cardsNode);
  previewNode.append(previewSectionNode);
}

export function initAdminPage({ firebase, state, renderStatus }) {
  const adminRoot = document.querySelector(ADMIN_ROOT_SELECTOR);
  const adminUiState = {
    activePageKey: STATIC_PAGE_DEFINITIONS[0].key,
    isLoading: true,
    isSavingPage: false,
    isSavingReviewLinks: false,
    isSavingBottleList: false,
    isClearingBottleList: false,
    isSavingQuestionPool: false,
    isClearingQuestionPool: false,
    pages: normalizeStaticPages(null),
    reviewLinks: normalizeReviewLinks(null),
    bottleList: normalizeBottleList(null),
    questionPool: normalizeTriviaQuestionPool(null),
    bottleListDraft: "",
    questionPoolDraft: TRIVIA_QUESTION_POOL_SAFE_EXAMPLE_JSON,
    bottleListPreview: null,
    questionPoolPreview: null,
    bottleListValidationErrors: [],
    questionPoolValidationErrors: [],
    pageMessage: {
      text: "",
      tone: "info",
    },
    reviewMessage: {
      text: "",
      tone: "info",
    },
    bottleListMessage: {
      text: "",
      tone: "info",
    },
    questionPoolMessage: {
      text: "",
      tone: "info",
    },
  };

  function setPageMessage(text = "", tone = "info") {
    adminUiState.pageMessage = { text, tone };
  }

  function setReviewMessage(text = "", tone = "info") {
    adminUiState.reviewMessage = { text, tone };
  }

  function setBottleListMessage(text = "", tone = "info") {
    adminUiState.bottleListMessage = { text, tone };
  }

  function setQuestionPoolMessage(text = "", tone = "info") {
    adminUiState.questionPoolMessage = { text, tone };
  }

  function getEditableBottleListSource(bottleListValue) {
    if (normalizeTextInput(bottleListValue.sourceText)) {
      return {
        draft: bottleListValue.sourceText,
        wasReconstructed: false,
      };
    }

    if (hasBottleListItems(bottleListValue)) {
      return {
        draft: reconstructBottleListSource(bottleListValue),
        wasReconstructed: true,
      };
    }

    return {
      draft: "",
      wasReconstructed: false,
    };
  }

  function getEditableTriviaQuestionPoolSource(questionPoolValue, rawQuestionPoolValue) {
    if (rawQuestionPoolValue === null) {
      return {
        draft: TRIVIA_QUESTION_POOL_SAFE_EXAMPLE_JSON,
        source: "example",
      };
    }

    if (!questionPoolValue.isValid) {
      return {
        draft: TRIVIA_QUESTION_POOL_SAFE_EXAMPLE_JSON,
        source: "invalid",
      };
    }

    return {
      draft: reconstructTriviaQuestionPoolJson(questionPoolValue),
      source: questionPoolValue.order.length === 0 ? "empty" : "saved",
    };
  }

  function readBottleListDraft(formNode) {
    const formData = new FormData(formNode);

    adminUiState.bottleListDraft = String(formData.get("sourceText") ?? "");
    return adminUiState.bottleListDraft;
  }

  function readQuestionPoolDraft(formNode) {
    const formData = new FormData(formNode);

    adminUiState.questionPoolDraft = String(formData.get("questionPoolJson") ?? "");
    return adminUiState.questionPoolDraft;
  }

  function applyBottleListPreviewState(previewResult) {
    adminUiState.bottleListValidationErrors = previewResult.errors;

    if (previewResult.errors.length > 0) {
      adminUiState.bottleListPreview = null;
      setBottleListMessage("Fix the validation errors below before saving.", "error");
      return false;
    }

    adminUiState.bottleListPreview = previewResult;

    if (previewResult.isEmpty) {
      setBottleListMessage("Blank or empty bottle-list text will not overwrite the current Firebase list. Use Clear Public Bottle List to intentionally remove it.", "warning");
      return false;
    }

    const bottleLabel = previewResult.itemCount === 1 ? "bottle" : "bottles";
    const groupLabel = previewResult.groups.length === 1 ? "group" : "groups";

    setBottleListMessage(`Preview ready: ${previewResult.itemCount} ${bottleLabel} across ${previewResult.groups.length} ${groupLabel}.`, "success");
    return true;
  }

  function applyQuestionPoolPreviewState(previewResult) {
    adminUiState.questionPoolValidationErrors = previewResult.errors;

    if (previewResult.errors.length > 0) {
      adminUiState.questionPoolPreview = null;
      setQuestionPoolMessage("Fix the validation errors below before replacing the Trivia Question Pool.", "error");
      return false;
    }

    adminUiState.questionPoolPreview = previewResult;

    if (previewResult.isEmpty) {
      setQuestionPoolMessage("Empty arrays cannot replace the Trivia Question Pool. Use Clear Question Pool to intentionally remove it.", "warning");
      return false;
    }

    const questionLabel = previewResult.questions.length === 1 ? "question" : "questions";

    setQuestionPoolMessage(`Preview ready: ${previewResult.questions.length} ${questionLabel}.`, "success");
    return true;
  }

  function renderAdminContent() {
    if (!adminRoot) {
      return;
    }

    const contentNode = adminRoot.querySelector("[data-role-content]");

    if (!contentNode) {
      return;
    }

    const activePageDefinition = STATIC_PAGE_DEFINITIONS.find((page) => page.key === adminUiState.activePageKey)
      || STATIC_PAGE_DEFINITIONS[0];
    const activePage = adminUiState.pages[activePageDefinition.key];
    const pageSelectorMarkup = STATIC_PAGE_DEFINITIONS
      .map((pageDefinition) => `
        <button
          type="button"
          class="hub-button admin-page-button"
          data-action="select-static-page"
          data-page-key="${escapeHtml(pageDefinition.key)}"
          aria-pressed="${pageDefinition.key === activePageDefinition.key ? "true" : "false"}"
        >
          ${escapeHtml(pageDefinition.label)}
        </button>
      `)
      .join("");
    const reviewFieldMarkup = REVIEW_LINK_DEFINITIONS
      .map((linkDefinition) => `
        <label class="form-field" for="review-link-${escapeHtml(linkDefinition.key)}">
          <span>${escapeHtml(linkDefinition.label)}</span>
          <input
            id="review-link-${escapeHtml(linkDefinition.key)}"
            name="${escapeHtml(linkDefinition.key)}"
            class="form-input"
            type="url"
            inputmode="url"
            placeholder="https://example.com/review"
            data-review-link-input="${escapeHtml(linkDefinition.key)}"
            ${adminUiState.isSavingReviewLinks ? "disabled" : ""}
          >
        </label>
      `)
      .join("");
    const isBottleListBusy = adminUiState.isLoading || adminUiState.isSavingBottleList || adminUiState.isClearingBottleList;
    const isQuestionPoolBusy = adminUiState.isLoading || adminUiState.isSavingQuestionPool || adminUiState.isClearingQuestionPool;
    const currentQuestionPoolCounts = adminUiState.questionPoolPreview?.counts || adminUiState.questionPool.counts;

    contentNode.innerHTML = `
      <div class="admin-sections">
        <section class="player-section admin-section">
          <div class="player-section-header">
            <div>
              <p class="eyebrow">Static Pages</p>
              <h3>Player Content Editor</h3>
              <p class="player-copy">Update player-facing FAQ, rules, mystery details, and the event schedule without changing code.</p>
            </div>
          </div>
          ${renderSectionNotice(adminUiState.pageMessage)}
          <div class="hub-grid admin-page-grid">
            ${pageSelectorMarkup}
          </div>
          <form class="player-form admin-editor-form" data-admin-form="static-page" novalidate>
            <label class="form-field" for="admin-page-title">
              <span>Page Title</span>
              <input
                id="admin-page-title"
                name="title"
                class="form-input"
                type="text"
                data-static-page-title-input
                ${adminUiState.isLoading || adminUiState.isSavingPage ? "disabled" : ""}
              >
            </label>
            <label class="form-field" for="admin-page-content">
              <span>Page Content</span>
              <textarea
                id="admin-page-content"
                name="content"
                class="form-input form-textarea"
                rows="10"
                data-static-page-content-input
                ${adminUiState.isLoading || adminUiState.isSavingPage ? "disabled" : ""}
              ></textarea>
            </label>
            <div class="admin-meta">
              Last saved: <span data-static-page-updated-at>${escapeHtml(formatUpdatedAt(activePage.updatedAt))}</span>
            </div>
            <div class="player-form-actions">
              <button type="submit" class="primary-button" ${adminUiState.isLoading || adminUiState.isSavingPage ? "disabled" : ""}>
                ${adminUiState.isSavingPage ? "Saving Page..." : `Save ${escapeHtml(activePageDefinition.label)}`}
              </button>
            </div>
          </form>
        </section>

        <section class="player-section admin-section">
          <div class="player-section-header">
            <div>
              <p class="eyebrow">Trivia Question Pool</p>
              <h3>Trivia Question Pool</h3>
              <p class="player-copy">Questions stay in Firebase until replaced. <code>answer</code> uses zero-based indexing. This editor manages the saved pool only and does not control live Trivia gameplay.</p>
            </div>
          </div>
          ${renderSectionNotice(adminUiState.questionPoolMessage)}
          ${renderTriviaQuestionValidationErrors(adminUiState.questionPoolValidationErrors)}
          <form class="player-form admin-editor-form" data-admin-form="trivia-question-pool" novalidate>
            <label class="form-field" for="admin-trivia-question-pool-json">
              <span>Paste Question Pool JSON</span>
              <textarea
                id="admin-trivia-question-pool-json"
                name="questionPoolJson"
                class="form-input form-textarea"
                rows="18"
                data-trivia-question-pool-input
                ${isQuestionPoolBusy ? "disabled" : ""}
              ></textarea>
            </label>
            <p class="admin-helper-copy">Questions remain in Firebase until replaced. The <code>answer</code> value must be a zero-based option index. Replace only updates <code>/trivia/questionPool</code> and does not create live Trivia state.</p>
            <div class="trivia-count-grid" data-admin-trivia-counts></div>
            <div class="admin-meta">
              Last saved: <span data-trivia-question-pool-updated-at>${escapeHtml(formatUpdatedAt(adminUiState.questionPool.updatedAt))}</span>
            </div>
            <div class="admin-button-row">
              <button type="button" class="secondary-button" data-action="validate-trivia-question-pool" ${isQuestionPoolBusy ? "disabled" : ""}>
                Validate / Preview
              </button>
              <button type="submit" class="primary-button" ${isQuestionPoolBusy ? "disabled" : ""}>
                ${adminUiState.isSavingQuestionPool ? "Replacing Question Pool..." : "Replace Question Pool"}
              </button>
              <button type="button" class="secondary-button" data-action="clear-trivia-question-pool" ${isQuestionPoolBusy ? "disabled" : ""}>
                ${adminUiState.isClearingQuestionPool ? "Clearing Question Pool..." : "Clear Question Pool"}
              </button>
            </div>
          </form>
          <div data-trivia-question-pool-preview></div>
        </section>

        <section class="player-section admin-section">
          <div class="player-section-header">
            <div>
              <p class="eyebrow">Public Bottle List</p>
              <h3>Public Bottle List</h3>
              <p class="player-copy">Paste, validate, preview, and publish the public raffle or event bottle list for players. This section is separate from the future Bingo bottle list.</p>
            </div>
          </div>
          ${renderSectionNotice(adminUiState.bottleListMessage)}
          ${renderBottleListValidationErrors(adminUiState.bottleListValidationErrors)}
          <form class="player-form admin-editor-form" data-admin-form="public-bottle-list" novalidate>
            <label class="form-field" for="admin-bottle-list-source">
              <span>Paste Bottle List Text</span>
              <textarea
                id="admin-bottle-list-source"
                name="sourceText"
                class="form-input form-textarea"
                rows="12"
                data-bottle-list-source-input
                ${isBottleListBusy ? "disabled" : ""}
              ></textarea>
            </label>
            <p class="admin-helper-copy">Use <code>Bottle Name | Quantity | Price</code> for bottle rows. Nonblank lines without pipes become group headings.</p>
            <div class="admin-meta">
              Last saved: <span data-bottle-list-updated-at>${escapeHtml(formatUpdatedAt(adminUiState.bottleList.updatedAt))}</span>
            </div>
            <div class="admin-button-row">
              <button type="button" class="secondary-button" data-action="validate-bottle-list" ${isBottleListBusy ? "disabled" : ""}>
                Validate / Preview
              </button>
              <button type="submit" class="primary-button" ${isBottleListBusy ? "disabled" : ""}>
                ${adminUiState.isSavingBottleList ? "Saving Bottle List..." : "Save Bottle List"}
              </button>
              <button type="button" class="secondary-button" data-action="clear-bottle-list" ${isBottleListBusy ? "disabled" : ""}>
                ${adminUiState.isClearingBottleList ? "Clearing Bottle List..." : "Clear Public Bottle List"}
              </button>
            </div>
          </form>
          ${renderBottleListPreview(adminUiState.bottleListPreview)}
        </section>

        <section class="player-section admin-section">
          <div class="player-section-header">
            <div>
              <p class="eyebrow">Review Links</p>
              <h3>Leave Review Destinations</h3>
              <p class="player-copy">Only valid absolute http or https URLs will appear as clickable review buttons for players.</p>
            </div>
          </div>
          ${renderSectionNotice(adminUiState.reviewMessage)}
          <form class="player-form admin-editor-form" data-admin-form="review-links" novalidate>
            ${reviewFieldMarkup}
            <div class="player-form-actions">
              <button type="submit" class="primary-button" ${adminUiState.isLoading || adminUiState.isSavingReviewLinks ? "disabled" : ""}>
                ${adminUiState.isSavingReviewLinks ? "Saving Review Links..." : "Save Review Links"}
              </button>
            </div>
          </form>
        </section>

        <section class="player-section admin-section">
          <div>
            <p class="eyebrow">Reserved Admin Areas</p>
            <h3>Future Admin Modules</h3>
            <p class="player-copy">The remaining Admin areas stay reserved for later slices.</p>
          </div>
          <div class="placeholder-grid">
            ${renderReservedCards(ADMIN_RESERVED_CARDS)}
          </div>
        </section>
      </div>
    `;

    const titleField = contentNode.querySelector("[data-static-page-title-input]");
    const contentField = contentNode.querySelector("[data-static-page-content-input]");
    const questionPoolField = contentNode.querySelector("[data-trivia-question-pool-input]");
    const bottleListSourceField = contentNode.querySelector("[data-bottle-list-source-input]");

    if (titleField instanceof HTMLInputElement) {
      titleField.value = activePage.title;
    }

    if (contentField instanceof HTMLTextAreaElement) {
      contentField.value = activePage.content;
    }

    if (questionPoolField instanceof HTMLTextAreaElement) {
      questionPoolField.value = adminUiState.questionPoolDraft;
    }

    if (bottleListSourceField instanceof HTMLTextAreaElement) {
      bottleListSourceField.value = adminUiState.bottleListDraft;
    }

    REVIEW_LINK_DEFINITIONS.forEach((linkDefinition) => {
      const inputNode = contentNode.querySelector(`[data-review-link-input="${linkDefinition.key}"]`);

      if (inputNode instanceof HTMLInputElement) {
        inputNode.value = adminUiState.reviewLinks[linkDefinition.key] || "";
      }
    });

    renderTriviaCountGrid(contentNode.querySelector("[data-admin-trivia-counts]"), currentQuestionPoolCounts);
    renderTriviaQuestionPoolPreview(
      contentNode.querySelector("[data-trivia-question-pool-preview]"),
      adminUiState.questionPoolPreview
    );
  }

  async function loadAdminContent() {
    adminUiState.isLoading = true;
    setPageMessage();
    setReviewMessage();
    setBottleListMessage();
    setQuestionPoolMessage();
    renderAdminContent();

    const [pagesValue, reviewLinksValue, bottleListValue, questionPoolValue] = await Promise.all([
      firebase.readEventData("pages"),
      firebase.readEventData("reviewLinks"),
      firebase.readEventData(PUBLIC_BOTTLE_LIST_PATH),
      firebase.readEventData(TRIVIA_QUESTION_POOL_PATH),
    ]);

    adminUiState.pages = normalizeStaticPages(pagesValue);
    adminUiState.reviewLinks = normalizeReviewLinks(reviewLinksValue);
    adminUiState.bottleList = normalizeBottleList(bottleListValue);
    adminUiState.questionPool = normalizeTriviaQuestionPool(questionPoolValue);
    adminUiState.bottleListValidationErrors = [];
    adminUiState.questionPoolValidationErrors = [];
    adminUiState.bottleListPreview = null;
    adminUiState.questionPoolPreview = null;

    const editableBottleList = getEditableBottleListSource(adminUiState.bottleList);
    const editableQuestionPool = getEditableTriviaQuestionPoolSource(adminUiState.questionPool, questionPoolValue);
    const firebaseStatus = firebase.getStatus();

    adminUiState.bottleListDraft = editableBottleList.draft;
    adminUiState.questionPoolDraft = editableQuestionPool.draft;

    if (editableBottleList.wasReconstructed) {
      setBottleListMessage("Loaded the saved bottle list by reconstructing editable text from structured data.", "info");
    }

    if (questionPoolValue === null && firebaseStatus.error) {
      setQuestionPoolMessage(firebaseStatus.message || "Trivia Question Pool data is temporarily unavailable.", "error");
    } else if (editableQuestionPool.source === "example") {
      setQuestionPoolMessage("No Trivia Question Pool is saved yet. The editor has been prefilled with a safe example that will not save until you replace the pool.", "info");
    } else if (editableQuestionPool.source === "saved") {
      setQuestionPoolMessage("Loaded the saved Trivia Question Pool from Firebase.", "info");
    } else if (editableQuestionPool.source === "empty") {
      setQuestionPoolMessage("Loaded the saved empty Trivia Question Pool from Firebase. Replace it with questions or keep it empty with Clear Question Pool.", "info");
    } else if (editableQuestionPool.source === "invalid") {
      setQuestionPoolMessage("The saved Trivia Question Pool is invalid. The editor was reset to the safe example until the pool is replaced.", "error");
    }

    adminUiState.isLoading = false;
    renderAdminContent();
  }

  async function saveActivePage(formNode) {
    const activePageDefinition = STATIC_PAGE_DEFINITIONS.find((page) => page.key === adminUiState.activePageKey)
      || STATIC_PAGE_DEFINITIONS[0];
    const formData = new FormData(formNode);
    const nextPagePayload = {
      title: normalizeTextInput(formData.get("title")) || activePageDefinition.defaultTitle,
      content: normalizeMultilineText(formData.get("content")),
      updatedAt: new Date().toISOString(),
    };

    adminUiState.isSavingPage = true;
    setPageMessage();
    renderAdminContent();

    const saveSucceeded = await firebase.writeEventData(`pages/${activePageDefinition.key}`, nextPagePayload);

    adminUiState.isSavingPage = false;

    if (!saveSucceeded) {
      setPageMessage(firebase.getStatus().message || "We could not save that page right now. Please try again.", "error");
      renderAdminContent();
      return;
    }

    adminUiState.pages = {
      ...adminUiState.pages,
      [activePageDefinition.key]: nextPagePayload,
    };
    setPageMessage(`${activePageDefinition.label} saved to Firebase.`, "success");
    renderAdminContent();
  }

  async function saveReviewLinks(formNode) {
    const formData = new FormData(formNode);
    const nextReviewLinks = REVIEW_LINK_DEFINITIONS.reduce((reviewLinks, linkDefinition) => {
      reviewLinks[linkDefinition.key] = normalizeTextInput(formData.get(linkDefinition.key));
      return reviewLinks;
    }, {});
    const invalidLinks = REVIEW_LINK_DEFINITIONS.filter((linkDefinition) => {
      const linkValue = nextReviewLinks[linkDefinition.key];
      return linkValue && !isValidAbsoluteHttpUrl(linkValue);
    });

    if (invalidLinks.length > 0) {
      const invalidLabels = invalidLinks.map((linkDefinition) => linkDefinition.label).join(" and ");
      setReviewMessage(`${invalidLabels} must use a full http or https URL.`, "error");
      renderAdminContent();
      return;
    }

    adminUiState.isSavingReviewLinks = true;
    setReviewMessage();
    renderAdminContent();

    const saveSucceeded = await firebase.updateEventData("reviewLinks", nextReviewLinks);

    adminUiState.isSavingReviewLinks = false;

    if (!saveSucceeded) {
      setReviewMessage(firebase.getStatus().message || "We could not save the review links right now. Please try again.", "error");
      renderAdminContent();
      return;
    }

    adminUiState.reviewLinks = {
      ...adminUiState.reviewLinks,
      ...nextReviewLinks,
    };
    setReviewMessage("Review links saved to Firebase.", "success");
    renderAdminContent();
  }

  function validateBottleList(formNode) {
    const sourceText = readBottleListDraft(formNode);
    const previewResult = parseBottleListSource(sourceText);

    applyBottleListPreviewState(previewResult);
    renderAdminContent();
    return previewResult;
  }

  function validateQuestionPool(formNode) {
    const sourceText = readQuestionPoolDraft(formNode);
    const previewResult = parseTriviaQuestionPoolJson(sourceText);

    applyQuestionPoolPreviewState(previewResult);
    renderAdminContent();
    return previewResult;
  }

  async function saveBottleList(formNode) {
    const sourceText = readBottleListDraft(formNode);
    const previewResult = parseBottleListSource(sourceText);
    const canSave = applyBottleListPreviewState(previewResult);

    if (!canSave) {
      renderAdminContent();
      return;
    }

    adminUiState.isSavingBottleList = true;
    setBottleListMessage();
    renderAdminContent();

    const nextBottleListPayload = buildBottleListPayload({
      title: adminUiState.bottleList.title || DEFAULT_PUBLIC_BOTTLE_LIST_TITLE,
      sourceText: previewResult.sourceText,
      groups: previewResult.groups,
      updatedAt: new Date().toISOString(),
    });
    const saveSucceeded = await firebase.updateEventData(PUBLIC_BOTTLE_LIST_PATH, nextBottleListPayload);

    adminUiState.isSavingBottleList = false;

    if (!saveSucceeded) {
      setBottleListMessage(firebase.getStatus().message || "We could not save the Public Bottle List right now. Please try again.", "error");
      renderAdminContent();
      return;
    }

    adminUiState.bottleList = normalizeBottleList(nextBottleListPayload);
    adminUiState.bottleListDraft = nextBottleListPayload.sourceText;
    adminUiState.bottleListValidationErrors = [];
    adminUiState.bottleListPreview = previewResult;
    setBottleListMessage("Public Bottle List saved to Firebase.", "success");
    renderAdminContent();
  }

  async function saveQuestionPool(formNode) {
    const sourceText = readQuestionPoolDraft(formNode);
    const previewResult = parseTriviaQuestionPoolJson(sourceText);
    const canReplace = applyQuestionPoolPreviewState(previewResult);

    if (!canReplace) {
      renderAdminContent();
      return;
    }

    const replaceConfirmed = window.confirm(
      "Replace the saved Trivia Question Pool in Firebase? This updates only /trivia/questionPool and does not create live Trivia gameplay state."
    );

    if (!replaceConfirmed) {
      renderAdminContent();
      return;
    }

    adminUiState.isSavingQuestionPool = true;
    setQuestionPoolMessage();
    renderAdminContent();

    const nextQuestionPoolPayload = buildTriviaQuestionPoolPayload({
      questions: previewResult.questions,
      updatedAt: new Date().toISOString(),
    });
    const saveSucceeded = await firebase.writeEventData(TRIVIA_QUESTION_POOL_PATH, nextQuestionPoolPayload);

    adminUiState.isSavingQuestionPool = false;

    if (!saveSucceeded) {
      setQuestionPoolMessage(firebase.getStatus().message || "We could not replace the Trivia Question Pool right now. Please try again.", "error");
      renderAdminContent();
      return;
    }

    adminUiState.questionPool = normalizeTriviaQuestionPool(nextQuestionPoolPayload);
    adminUiState.questionPoolDraft = reconstructTriviaQuestionPoolJson(adminUiState.questionPool);
    adminUiState.questionPoolValidationErrors = [];
    adminUiState.questionPoolPreview = {
      ...previewResult,
      questions: adminUiState.questionPool.orderedQuestions,
      counts: adminUiState.questionPool.counts,
    };
    setQuestionPoolMessage("Trivia Question Pool replaced in Firebase.", "success");
    renderAdminContent();
  }

  async function clearBottleList() {
    const clearConfirmed = window.confirm(
      "Clear the Public Bottle List from Firebase? This only clears the public raffle or event bottle list and does not affect Bingo."
    );

    if (!clearConfirmed) {
      return;
    }

    adminUiState.isClearingBottleList = true;
    setBottleListMessage();
    renderAdminContent();

    const emptyBottleListPayload = buildBottleListPayload({
      title: adminUiState.bottleList.title || DEFAULT_PUBLIC_BOTTLE_LIST_TITLE,
      sourceText: "",
      groups: [],
      updatedAt: new Date().toISOString(),
    });
    const clearSucceeded = await firebase.updateEventData(PUBLIC_BOTTLE_LIST_PATH, emptyBottleListPayload);

    adminUiState.isClearingBottleList = false;

    if (!clearSucceeded) {
      setBottleListMessage(firebase.getStatus().message || "We could not clear the Public Bottle List right now. Please try again.", "error");
      renderAdminContent();
      return;
    }

    adminUiState.bottleList = normalizeBottleList(emptyBottleListPayload);
    adminUiState.bottleListDraft = "";
    adminUiState.bottleListValidationErrors = [];
    adminUiState.bottleListPreview = null;
    setBottleListMessage("Public Bottle List cleared from Firebase.", "success");
    renderAdminContent();
  }

  async function clearQuestionPool() {
    const clearConfirmed = window.confirm(
      "Clear the saved Trivia Question Pool from Firebase? This writes an intentional empty pool to /trivia/questionPool and does not create live Trivia gameplay state."
    );

    if (!clearConfirmed) {
      return;
    }

    adminUiState.isClearingQuestionPool = true;
    setQuestionPoolMessage();
    renderAdminContent();

    const emptyQuestionPoolPayload = buildTriviaQuestionPoolPayload({
      questions: [],
      updatedAt: new Date().toISOString(),
    });
    const clearSucceeded = await firebase.writeEventData(TRIVIA_QUESTION_POOL_PATH, emptyQuestionPoolPayload);

    adminUiState.isClearingQuestionPool = false;

    if (!clearSucceeded) {
      setQuestionPoolMessage(firebase.getStatus().message || "We could not clear the Trivia Question Pool right now. Please try again.", "error");
      renderAdminContent();
      return;
    }

    adminUiState.questionPool = normalizeTriviaQuestionPool(emptyQuestionPoolPayload);
    adminUiState.questionPoolDraft = reconstructTriviaQuestionPoolJson(adminUiState.questionPool);
    adminUiState.questionPoolValidationErrors = [];
    adminUiState.questionPoolPreview = null;
    setQuestionPoolMessage("Trivia Question Pool cleared from Firebase.", "success");
    renderAdminContent();
  }

  if (activeAdminRoot && activeAdminClickHandler) {
    activeAdminRoot.removeEventListener("click", activeAdminClickHandler);
  }

  if (activeAdminRoot && activeAdminInputHandler) {
    activeAdminRoot.removeEventListener("input", activeAdminInputHandler);
  }

  if (activeAdminRoot && activeAdminSubmitHandler) {
    activeAdminRoot.removeEventListener("submit", activeAdminSubmitHandler);
  }

  if (adminRoot) {
    activeAdminClickHandler = async (event) => {
      const actionNode = event.target.closest("[data-action]");

      if (!actionNode) {
        return;
      }

      if (actionNode.dataset.action === "select-static-page") {
        const nextPageKey = actionNode.dataset.pageKey;

        if (!STATIC_PAGE_DEFINITIONS.some((page) => page.key === nextPageKey)) {
          return;
        }

        adminUiState.activePageKey = nextPageKey;
        setPageMessage();
        renderAdminContent();
        return;
      }

      if (actionNode.dataset.action === "validate-trivia-question-pool") {
        const formNode = actionNode.closest('[data-admin-form="trivia-question-pool"]');

        if (formNode instanceof HTMLFormElement) {
          validateQuestionPool(formNode);
        }

        return;
      }

      if (actionNode.dataset.action === "clear-trivia-question-pool") {
        await clearQuestionPool();
        return;
      }

      if (actionNode.dataset.action === "validate-bottle-list") {
        const formNode = actionNode.closest('[data-admin-form="public-bottle-list"]');

        if (formNode instanceof HTMLFormElement) {
          validateBottleList(formNode);
        }

        return;
      }

      if (actionNode.dataset.action === "clear-bottle-list") {
        await clearBottleList();
      }
    };

    activeAdminInputHandler = (event) => {
      const inputNode = event.target;

      if (inputNode instanceof HTMLTextAreaElement && inputNode.dataset.triviaQuestionPoolInput !== undefined) {
        adminUiState.questionPoolDraft = inputNode.value;
        adminUiState.questionPoolValidationErrors = [];
        adminUiState.questionPoolPreview = null;
        setQuestionPoolMessage();
        return;
      }

      if (!(inputNode instanceof HTMLTextAreaElement) || inputNode.dataset.bottleListSourceInput === undefined) {
        return;
      }

      adminUiState.bottleListDraft = inputNode.value;
      adminUiState.bottleListValidationErrors = [];
      adminUiState.bottleListPreview = null;
      setBottleListMessage();
    };

    activeAdminSubmitHandler = async (event) => {
      const formNode = event.target;

      if (!(formNode instanceof HTMLFormElement)) {
        return;
      }

      if (formNode.dataset.adminForm === "static-page") {
        event.preventDefault();
        await saveActivePage(formNode);
        return;
      }

      if (formNode.dataset.adminForm === "review-links") {
        event.preventDefault();
        await saveReviewLinks(formNode);
        return;
      }

      if (formNode.dataset.adminForm === "trivia-question-pool") {
        event.preventDefault();
        await saveQuestionPool(formNode);
        return;
      }

      if (formNode.dataset.adminForm === "public-bottle-list") {
        event.preventDefault();
        await saveBottleList(formNode);
      }
    };

    adminRoot.addEventListener("click", activeAdminClickHandler);
    adminRoot.addEventListener("input", activeAdminInputHandler);
    adminRoot.addEventListener("submit", activeAdminSubmitHandler);
    activeAdminRoot = adminRoot;
  }

  return initRoleProtectedPage({
    role: "admin",
    rootSelector: ADMIN_ROOT_SELECTOR,
    state,
    firebase,
    renderStatus,
    pinFieldName: "adminPin",
    lockedIntroCopy: "Enter the Admin PIN to unlock high-privilege event tools for this browser session.",
    shellTitle: "Admin Console",
    shellCopy: "Admin keeps the full event-management surface, including future settings, exports, and data controls.",
    setupCopy: "Admin PIN setup is required before this page can be unlocked.",
    placeholderCards: ADMIN_RESERVED_CARDS,
    onUnlock() {
      void loadAdminContent();
    },
    onRenderUnlocked() {
      renderAdminContent();
    },
  });
}

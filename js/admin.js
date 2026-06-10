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
    title: "Question Pools",
    description: "Future trivia question management will appear here in a later slice.",
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

export function initAdminPage({ firebase, state, renderStatus }) {
  const adminRoot = document.querySelector(ADMIN_ROOT_SELECTOR);
  const adminUiState = {
    activePageKey: STATIC_PAGE_DEFINITIONS[0].key,
    isLoading: true,
    isSavingPage: false,
    isSavingReviewLinks: false,
    isSavingBottleList: false,
    isClearingBottleList: false,
    pages: normalizeStaticPages(null),
    reviewLinks: normalizeReviewLinks(null),
    bottleList: normalizeBottleList(null),
    bottleListDraft: "",
    bottleListPreview: null,
    bottleListValidationErrors: [],
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

  function readBottleListDraft(formNode) {
    const formData = new FormData(formNode);
    adminUiState.bottleListDraft = String(formData.get("sourceText") ?? "");
    return adminUiState.bottleListDraft;
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

    if (titleField instanceof HTMLInputElement) {
      titleField.value = activePage.title;
    }

    if (contentField instanceof HTMLTextAreaElement) {
      contentField.value = activePage.content;
    }

    const bottleListSourceField = contentNode.querySelector("[data-bottle-list-source-input]");

    if (bottleListSourceField instanceof HTMLTextAreaElement) {
      bottleListSourceField.value = adminUiState.bottleListDraft;
    }

    REVIEW_LINK_DEFINITIONS.forEach((linkDefinition) => {
      const inputNode = contentNode.querySelector(`[data-review-link-input="${linkDefinition.key}"]`);

      if (inputNode instanceof HTMLInputElement) {
        inputNode.value = adminUiState.reviewLinks[linkDefinition.key] || "";
      }
    });
  }

  async function loadAdminContent() {
    adminUiState.isLoading = true;
    setPageMessage();
    setReviewMessage();
    setBottleListMessage();
    renderAdminContent();

    const [pagesValue, reviewLinksValue, bottleListValue] = await Promise.all([
      firebase.readEventData("pages"),
      firebase.readEventData("reviewLinks"),
      firebase.readEventData(PUBLIC_BOTTLE_LIST_PATH),
    ]);

    adminUiState.pages = normalizeStaticPages(pagesValue);
    adminUiState.reviewLinks = normalizeReviewLinks(reviewLinksValue);
    adminUiState.bottleList = normalizeBottleList(bottleListValue);
    adminUiState.bottleListValidationErrors = [];
    adminUiState.bottleListPreview = null;

    const editableBottleList = getEditableBottleListSource(adminUiState.bottleList);
    adminUiState.bottleListDraft = editableBottleList.draft;

    if (editableBottleList.wasReconstructed) {
      setBottleListMessage("Loaded the saved bottle list by reconstructing editable text from structured data.", "info");
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

import { initRoleProtectedPage } from "./role-access.js";
import {
  escapeHtml,
  isValidAbsoluteHttpUrl,
  normalizeTextInput,
} from "./utils.js";
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
    title: "Bottle Lists",
    description: "Future bottle list setup and maintenance tools will stay in this console.",
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
    pages: normalizeStaticPages(null),
    reviewLinks: normalizeReviewLinks(null),
    pageMessage: {
      text: "",
      tone: "info",
    },
    reviewMessage: {
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
    renderAdminContent();

    const [pagesValue, reviewLinksValue] = await Promise.all([
      firebase.readEventData("pages"),
      firebase.readEventData("reviewLinks"),
    ]);

    adminUiState.pages = normalizeStaticPages(pagesValue);
    adminUiState.reviewLinks = normalizeReviewLinks(reviewLinksValue);
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

  if (activeAdminRoot && activeAdminClickHandler) {
    activeAdminRoot.removeEventListener("click", activeAdminClickHandler);
  }

  if (activeAdminRoot && activeAdminSubmitHandler) {
    activeAdminRoot.removeEventListener("submit", activeAdminSubmitHandler);
  }

  if (adminRoot) {
    activeAdminClickHandler = (event) => {
      const actionNode = event.target.closest("[data-action]");

      if (!actionNode || actionNode.dataset.action !== "select-static-page") {
        return;
      }

      const nextPageKey = actionNode.dataset.pageKey;

      if (!STATIC_PAGE_DEFINITIONS.some((page) => page.key === nextPageKey)) {
        return;
      }

      adminUiState.activePageKey = nextPageKey;
      setPageMessage();
      renderAdminContent();
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
      }
    };

    adminRoot.addEventListener("click", activeAdminClickHandler);
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

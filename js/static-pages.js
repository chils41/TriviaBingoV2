import { normalizeTextInput } from "./utils.js";

export const STATIC_PAGE_DEFINITIONS = [
  {
    key: "faq",
    label: "FAQ",
    defaultTitle: "FAQ",
    hubPanelId: "faq",
  },
  {
    key: "rules",
    label: "Rules & Alerts",
    defaultTitle: "Rules & Alerts",
    hubPanelId: "rules-alerts",
  },
  {
    key: "mystery",
    label: "Mystery Info",
    defaultTitle: "Mystery Info",
    hubPanelId: "mystery-info",
  },
  {
    key: "schedule",
    label: "Event Schedule",
    defaultTitle: "Event Schedule",
    hubPanelId: "event-schedule",
  },
];

export const REVIEW_LINK_DEFINITIONS = [
  {
    key: "google",
    label: "Google Review",
  },
  {
    key: "facebook",
    label: "Facebook Review",
  },
];

export const MISSING_STATIC_PAGE_MESSAGE = "Event information has not been posted yet.";

export function normalizeMultilineText(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n");
}

export function getStaticPageDefinition(pageKey) {
  return STATIC_PAGE_DEFINITIONS.find((page) => page.key === pageKey) || STATIC_PAGE_DEFINITIONS[0];
}

export function buildDefaultStaticPage(pageKey) {
  const pageDefinition = getStaticPageDefinition(pageKey);

  return {
    title: pageDefinition.defaultTitle,
    content: "",
    updatedAt: "",
  };
}

export function normalizeStaticPage(pageKey, pageValue) {
  const defaultPage = buildDefaultStaticPage(pageKey);

  return {
    title: normalizeTextInput(pageValue?.title) || defaultPage.title,
    content: normalizeMultilineText(pageValue?.content),
    updatedAt: normalizeTextInput(pageValue?.updatedAt),
  };
}

export function normalizeStaticPages(staticPagesValue) {
  return STATIC_PAGE_DEFINITIONS.reduce((pages, pageDefinition) => {
    pages[pageDefinition.key] = normalizeStaticPage(pageDefinition.key, staticPagesValue?.[pageDefinition.key]);
    return pages;
  }, {});
}

export function normalizeReviewLinks(reviewLinksValue) {
  return {
    google: normalizeTextInput(reviewLinksValue?.google),
    facebook: normalizeTextInput(reviewLinksValue?.facebook),
  };
}

export function hasStaticPageContent(pageValue) {
  return normalizeTextInput(pageValue?.content) !== "";
}

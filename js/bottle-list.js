import { normalizeTextInput } from "./utils.js";

export const PUBLIC_BOTTLE_LIST_PATH = "bottleList";
export const PUBLIC_BOTTLE_LIST_SCHEMA_VERSION = 1;
export const DEFAULT_PUBLIC_BOTTLE_LIST_TITLE = "Bottle List";
export const DEFAULT_PUBLIC_BOTTLE_GROUP_TITLE = "Bottle List";
export const PLAYER_EMPTY_BOTTLE_LIST_MESSAGE = "The bottle list has not been posted yet.";

function normalizeMultilineValue(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n");
}

function normalizeBottleItem(itemValue) {
  const name = normalizeTextInput(itemValue?.name);
  const quantityValue = Number.parseInt(String(itemValue?.quantity ?? ""), 10);
  const price = normalizeTextInput(itemValue?.price);

  if (!name || !Number.isInteger(quantityValue) || quantityValue < 1 || !price) {
    return null;
  }

  return {
    name,
    quantity: quantityValue,
    price,
  };
}

function normalizeBottleGroup(groupValue) {
  const items = Array.isArray(groupValue?.items)
    ? groupValue.items.map(normalizeBottleItem).filter(Boolean)
    : [];

  if (items.length === 0) {
    return null;
  }

  return {
    title: normalizeTextInput(groupValue?.title) || DEFAULT_PUBLIC_BOTTLE_GROUP_TITLE,
    items,
  };
}

export function hasBottleListItems(bottleListValue) {
  return Array.isArray(bottleListValue?.groups) && bottleListValue.groups.some((group) => group.items.length > 0);
}

export function normalizeBottleList(bottleListValue) {
  const groups = Array.isArray(bottleListValue?.groups)
    ? bottleListValue.groups.map(normalizeBottleGroup).filter(Boolean)
    : [];

  return {
    schemaVersion: PUBLIC_BOTTLE_LIST_SCHEMA_VERSION,
    title: normalizeTextInput(bottleListValue?.title) || DEFAULT_PUBLIC_BOTTLE_LIST_TITLE,
    sourceText: normalizeMultilineValue(bottleListValue?.sourceText),
    groups,
    updatedAt: normalizeTextInput(bottleListValue?.updatedAt),
  };
}

export function buildBottleListPayload({
  title = DEFAULT_PUBLIC_BOTTLE_LIST_TITLE,
  sourceText = "",
  groups = [],
  updatedAt = "",
} = {}) {
  const normalizedBottleList = normalizeBottleList({
    title,
    sourceText,
    groups,
    updatedAt,
  });

  return {
    schemaVersion: PUBLIC_BOTTLE_LIST_SCHEMA_VERSION,
    title: normalizedBottleList.title,
    sourceText: normalizedBottleList.sourceText,
    groups: normalizedBottleList.groups,
    updatedAt: normalizedBottleList.updatedAt,
  };
}

export function parseBottleListSource(sourceText) {
  const normalizedSourceText = normalizeMultilineValue(sourceText);
  const lines = normalizedSourceText.split("\n");
  const groups = [];
  const errors = [];
  let activeGroup = null;

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const trimmedLine = rawLine.trim();

    if (!trimmedLine) {
      return;
    }

    if (!rawLine.includes("|")) {
      activeGroup = {
        title: trimmedLine,
        items: [],
      };
      groups.push(activeGroup);
      return;
    }

    const fields = rawLine.split("|").map((field) => field.trim());

    if (fields.length !== 3) {
      errors.push({
        lineNumber,
        message: 'Bottle rows must use exactly "Bottle Name | Quantity | Price".',
      });
      return;
    }

    const [name, quantityText, price] = fields;
    let hasRowError = false;

    if (!name) {
      errors.push({
        lineNumber,
        message: "Bottle name is required.",
      });
      hasRowError = true;
    }

    if (!/^\d+$/.test(quantityText) || Number.parseInt(quantityText, 10) < 1) {
      errors.push({
        lineNumber,
        message: "Quantity must be a positive whole number.",
      });
      hasRowError = true;
    }

    if (!price) {
      errors.push({
        lineNumber,
        message: "Price is required.",
      });
      hasRowError = true;
    }

    if (hasRowError) {
      return;
    }

    if (!activeGroup) {
      activeGroup = {
        title: DEFAULT_PUBLIC_BOTTLE_GROUP_TITLE,
        items: [],
      };
      groups.push(activeGroup);
    }

    activeGroup.items.push({
      name,
      quantity: Number.parseInt(quantityText, 10),
      price,
    });
  });

  const normalizedGroups = normalizeBottleList({ groups }).groups;
  const itemCount = normalizedGroups.reduce((total, group) => total + group.items.length, 0);

  return {
    sourceText: normalizedSourceText,
    groups: normalizedGroups,
    errors,
    isValid: errors.length === 0,
    isEmpty: itemCount === 0,
    itemCount,
  };
}

export function reconstructBottleListSource(bottleListValue) {
  const normalizedBottleList = normalizeBottleList(bottleListValue);

  if (!hasBottleListItems(normalizedBottleList)) {
    return "";
  }

  return normalizedBottleList.groups
    .map((group) => {
      const lines = [group.title];

      group.items.forEach((item) => {
        lines.push(`${item.name} | ${item.quantity} | ${item.price}`);
      });

      return lines.join("\n");
    })
    .join("\n\n");
}

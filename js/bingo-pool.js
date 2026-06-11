import { normalizeTextInput, sanitizeFirebaseKey } from "./utils.js";

export const BINGO_SOURCE_POOL_PATH = "bingo/sourcePool";
export const BINGO_LIVE_CURRENT_ROUND_PATH = "bingo/live/currentRound";
export const BINGO_LIVE_CARDS_PATH = "bingo/live/cards";
export const BINGO_SOURCE_POOL_SCHEMA_VERSION = 1;
export const BINGO_CARD_ITEM_COUNT = 9;
export const BINGO_RECOMMENDED_MINIMUM_POOL_SIZE = 45;
export const BINGO_ROUND_STATUS_IDLE = "idle";
export const BINGO_ROUND_STATUS_CARDS_OPEN = "cards_open";

const BINGO_ROUND_STATUS_LABELS = {
  [BINGO_ROUND_STATUS_IDLE]: "Idle",
  [BINGO_ROUND_STATUS_CARDS_OPEN]: "Cards Open",
};

function normalizeMultilineValue(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n");
}

function createSourceItemId(index) {
  return `item_${String(index + 1).padStart(3, "0")}`;
}

function normalizePoolItemName(value) {
  return normalizeTextInput(value);
}

function normalizePoolItem(itemValue, index = 0) {
  const name = normalizePoolItemName(itemValue?.name);

  if (!name) {
    return null;
  }

  const normalizedId = normalizeTextInput(itemValue?.id) || createSourceItemId(index);

  return {
    id: sanitizeFirebaseKey(normalizedId),
    name,
  };
}

function normalizeRoundItem(itemValue) {
  const id = sanitizeFirebaseKey(itemValue?.id);
  const name = normalizePoolItemName(itemValue?.name);

  if (!id || id === "device_fallback" || !name) {
    return null;
  }

  return { id, name };
}

function normalizeCardItem(itemValue) {
  return normalizeRoundItem(itemValue);
}

function buildCountWarning(count) {
  if (count > 0 && count < BINGO_RECOMMENDED_MINIMUM_POOL_SIZE) {
    return `The Bingo pool has ${count} unique item${count === 1 ? "" : "s"}. Fewer than 45 items can still work for small events, but 45 is the smallest normal target size.`;
  }

  return "";
}

function collectUniqueItems(items, { allowGeneratedIds = false } = {}) {
  const normalizedItems = [];
  const errors = [];
  const nameLineLookup = new Map();
  const idLookup = new Set();

  items.forEach((itemValue, index) => {
    const normalizedItem = allowGeneratedIds
      ? normalizePoolItem(itemValue, index)
      : normalizeRoundItem(itemValue);

    if (!normalizedItem) {
      errors.push(`Item ${index + 1} is missing a valid ID or name.`);
      return;
    }

    const normalizedNameKey = normalizedItem.name.toLowerCase();

    if (nameLineLookup.has(normalizedNameKey)) {
      errors.push(`Item ${index + 1} duplicates item ${nameLineLookup.get(normalizedNameKey)} by name.`);
      return;
    }

    if (idLookup.has(normalizedItem.id)) {
      errors.push(`Item ${index + 1} duplicates an earlier item ID.`);
      return;
    }

    nameLineLookup.set(normalizedNameKey, index + 1);
    idLookup.add(normalizedItem.id);
    normalizedItems.push(normalizedItem);
  });

  return {
    items: normalizedItems,
    errors,
  };
}

export function parseBingoSourcePoolText(sourceText) {
  const normalizedSourceText = normalizeMultilineValue(sourceText);
  const lines = normalizedSourceText.split("\n");
  const errors = [];
  const items = [];
  const seenNames = new Map();

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const trimmedLine = normalizeTextInput(rawLine);

    if (!trimmedLine) {
      return;
    }

    const duplicateKey = trimmedLine.toLowerCase();

    if (seenNames.has(duplicateKey)) {
      errors.push({
        lineNumber,
        message: `Duplicate item matches line ${seenNames.get(duplicateKey)} after trimming.`,
      });
      return;
    }

    seenNames.set(duplicateKey, lineNumber);
    items.push({
      id: createSourceItemId(items.length),
      name: trimmedLine,
    });
  });

  return {
    sourceText: normalizedSourceText,
    items,
    count: items.length,
    errors,
    isValid: errors.length === 0,
    isEmpty: items.length === 0,
    hasMinimumItems: items.length >= BINGO_CARD_ITEM_COUNT,
    warning: buildCountWarning(items.length),
  };
}

export function reconstructBingoSourcePoolText(sourcePoolValue) {
  const normalizedSourcePool = normalizeBingoSourcePool(sourcePoolValue);

  if (normalizeTextInput(normalizedSourcePool.sourceText)) {
    return normalizedSourcePool.sourceText;
  }

  if (normalizedSourcePool.items.length === 0) {
    return "";
  }

  return normalizedSourcePool.items.map((item) => item.name).join("\n");
}

export function normalizeBingoSourcePool(sourcePoolValue) {
  const normalizedSourceText = normalizeMultilineValue(sourcePoolValue?.sourceText);
  const storedItems = Array.isArray(sourcePoolValue?.items) ? sourcePoolValue.items : [];
  const normalizedFromItems = collectUniqueItems(storedItems, { allowGeneratedIds: true });
  const parsedSourceText = normalizedSourceText
    ? parseBingoSourcePoolText(normalizedSourceText)
    : null;
  const items = normalizedFromItems.items.length > 0
    ? normalizedFromItems.items
    : parsedSourceText?.items || [];
  const errors = [
    ...normalizedFromItems.errors,
    ...(parsedSourceText?.errors.map((error) => `Line ${error.lineNumber}: ${error.message}`) || []),
  ];
  const count = items.length;

  return {
    schemaVersion: BINGO_SOURCE_POOL_SCHEMA_VERSION,
    sourceText: normalizedSourceText,
    items,
    count,
    updatedAt: normalizeTextInput(sourcePoolValue?.updatedAt),
    isValid: errors.length === 0,
    isEmpty: count === 0,
    hasMinimumItems: count >= BINGO_CARD_ITEM_COUNT,
    warning: buildCountWarning(count),
    errors,
  };
}

export function buildBingoSourcePoolPayload({
  sourceText = "",
  items = [],
  updatedAt = "",
} = {}) {
  const normalizedSourceText = normalizeMultilineValue(sourceText);
  const normalizedItems = items
    .map((itemValue, index) => normalizePoolItem(itemValue, index))
    .filter(Boolean)
    .map((itemValue, index) => ({
      id: createSourceItemId(index),
      name: itemValue.name,
    }));

  return {
    schemaVersion: BINGO_SOURCE_POOL_SCHEMA_VERSION,
    sourceText: normalizedSourceText,
    items: normalizedItems,
    count: normalizedItems.length,
    updatedAt: normalizeTextInput(updatedAt),
  };
}

export function countRegisteredPlayers(playersValue) {
  if (!playersValue || typeof playersValue !== "object" || Array.isArray(playersValue)) {
    return 0;
  }

  return Object.values(playersValue).reduce((total, playerValue) => {
    if (!playerValue || typeof playerValue !== "object" || Array.isArray(playerValue)) {
      return total;
    }

    const hasPlayerFields = Boolean(
      normalizeTextInput(playerValue.playerId)
      || normalizeTextInput(playerValue.deviceId)
      || normalizeTextInput(playerValue.name)
      || normalizeTextInput(playerValue.zip)
      || normalizeTextInput(playerValue.email)
      || normalizeTextInput(playerValue.checkedInAt)
    );

    return hasPlayerFields ? total + 1 : total;
  }, 0);
}

export function getBingoTargetPoolSize(playerCount) {
  const normalizedCount = Number.isInteger(playerCount) && playerCount > 0 ? playerCount : 0;

  if (normalizedCount >= 100) {
    return 90;
  }

  if (normalizedCount >= 51) {
    return 75;
  }

  if (normalizedCount >= 21) {
    return 60;
  }

  return 45;
}

function getRandomInt(maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 1) {
    return 0;
  }

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const randomValues = new Uint32Array(1);
    const maxUint32 = 0x100000000;
    const bucketSize = Math.floor(maxUint32 / maxExclusive) * maxExclusive;
    let randomValue = 0;

    do {
      crypto.getRandomValues(randomValues);
      randomValue = randomValues[0];
    } while (randomValue >= bucketSize);

    return randomValue % maxExclusive;
  }

  return Math.floor(Math.random() * maxExclusive);
}

export function shuffleBingoItems(items) {
  const nextItems = Array.isArray(items) ? items.slice() : [];

  for (let index = nextItems.length - 1; index > 0; index -= 1) {
    const swapIndex = getRandomInt(index + 1);
    const currentValue = nextItems[index];

    nextItems[index] = nextItems[swapIndex];
    nextItems[swapIndex] = currentValue;
  }

  return nextItems;
}

export function sampleBingoItems(items, count) {
  const normalizedCount = Number.isInteger(count) && count > 0 ? count : 0;

  if (normalizedCount === 0) {
    return [];
  }

  return shuffleBingoItems(items).slice(0, normalizedCount);
}

function normalizeBingoRoundStatus(statusValue) {
  return normalizeTextInput(statusValue).toLowerCase();
}

export function createEmptyBingoCurrentRound() {
  return {
    roundId: "",
    status: BINGO_ROUND_STATUS_IDLE,
    playerCountAtPreparation: 0,
    targetPoolSize: 0,
    actualPoolSize: 0,
    activePool: [],
    cardsLocked: false,
    preparedAt: "",
  };
}

function isEmptyRoundShape(roundShape) {
  return !roundShape.roundId
    && roundShape.status === BINGO_ROUND_STATUS_IDLE
    && roundShape.playerCountAtPreparation === 0
    && roundShape.targetPoolSize === 0
    && roundShape.actualPoolSize === 0
    && roundShape.activePool.length === 0
    && roundShape.cardsLocked === false
    && !roundShape.preparedAt;
}

export function createBingoRoundId() {
  const rawId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  return sanitizeFirebaseKey(`bingo_${rawId}`);
}

export function normalizeBingoCurrentRound(roundValue) {
  const baseRound = createEmptyBingoCurrentRound();

  if (!roundValue || typeof roundValue !== "object") {
    return {
      ...baseRound,
      isValid: true,
      isEmpty: true,
      errors: [],
    };
  }

  const collectedPool = collectUniqueItems(
    Array.isArray(roundValue.activePool) ? roundValue.activePool : []
  );
  const normalizedRound = {
    roundId: normalizeTextInput(roundValue.roundId),
    status: normalizeBingoRoundStatus(roundValue.status) || BINGO_ROUND_STATUS_IDLE,
    playerCountAtPreparation: Number.isInteger(roundValue.playerCountAtPreparation)
      ? roundValue.playerCountAtPreparation
      : 0,
    targetPoolSize: Number.isInteger(roundValue.targetPoolSize)
      ? roundValue.targetPoolSize
      : 0,
    actualPoolSize: Number.isInteger(roundValue.actualPoolSize)
      ? roundValue.actualPoolSize
      : collectedPool.items.length,
    activePool: collectedPool.items,
    cardsLocked: roundValue.cardsLocked === true,
    preparedAt: normalizeTextInput(roundValue.preparedAt),
  };

  if (isEmptyRoundShape(normalizedRound)) {
    return {
      ...baseRound,
      isValid: true,
      isEmpty: true,
      errors: [],
    };
  }

  const errors = [...collectedPool.errors];

  if (![BINGO_ROUND_STATUS_IDLE, BINGO_ROUND_STATUS_CARDS_OPEN].includes(normalizedRound.status)) {
    errors.push(`Round status "${normalizedRound.status || "(missing)"}" is invalid.`);
  }

  if (normalizedRound.status !== BINGO_ROUND_STATUS_IDLE) {
    if (!normalizedRound.roundId) {
      errors.push("Bingo round is missing roundId.");
    }

    if (!Number.isInteger(normalizedRound.playerCountAtPreparation) || normalizedRound.playerCountAtPreparation < 0) {
      errors.push("Bingo round is missing a valid playerCountAtPreparation.");
    }

    if (!Number.isInteger(normalizedRound.targetPoolSize) || normalizedRound.targetPoolSize < BINGO_CARD_ITEM_COUNT) {
      errors.push("Bingo round is missing a valid targetPoolSize.");
    }

    if (!Number.isInteger(normalizedRound.actualPoolSize) || normalizedRound.actualPoolSize < 1) {
      errors.push("Bingo round is missing a valid actualPoolSize.");
    }

    if (normalizedRound.actualPoolSize !== normalizedRound.activePool.length) {
      errors.push("Bingo round actualPoolSize does not match activePool length.");
    }

    if (normalizedRound.activePool.length === 0) {
      errors.push("Bingo round is missing its activePool snapshot.");
    }

    if (!normalizedRound.preparedAt) {
      errors.push("Bingo round is missing preparedAt.");
    }
  }

  if (errors.length > 0) {
    return {
      ...baseRound,
      ...normalizedRound,
      isValid: false,
      isEmpty: false,
      errors,
    };
  }

  return {
    ...normalizedRound,
    isValid: true,
    isEmpty: false,
    errors: [],
  };
}

export function buildBingoCurrentRoundPayload({
  roundId = "",
  playerCountAtPreparation = 0,
  targetPoolSize = 0,
  activePool = [],
  cardsLocked = false,
  preparedAt = "",
} = {}) {
  const normalizedActivePool = collectUniqueItems(activePool).items;
  const payload = {
    roundId: normalizeTextInput(roundId) || createBingoRoundId(),
    status: BINGO_ROUND_STATUS_CARDS_OPEN,
    playerCountAtPreparation,
    targetPoolSize,
    actualPoolSize: normalizedActivePool.length,
    activePool: normalizedActivePool,
    cardsLocked,
    preparedAt: normalizeTextInput(preparedAt) || new Date().toISOString(),
  };
  const normalizedRound = normalizeBingoCurrentRound(payload);

  if (!normalizedRound.isValid) {
    throw new Error(normalizedRound.errors[0] || "Bingo round payload is invalid.");
  }

  return {
    roundId: normalizedRound.roundId,
    status: normalizedRound.status,
    playerCountAtPreparation: normalizedRound.playerCountAtPreparation,
    targetPoolSize: normalizedRound.targetPoolSize,
    actualPoolSize: normalizedRound.actualPoolSize,
    activePool: normalizedRound.activePool.slice(),
    cardsLocked: normalizedRound.cardsLocked,
    preparedAt: normalizedRound.preparedAt,
  };
}

export function hasPreparedBingoRound(roundValue) {
  const normalizedRound = normalizeBingoCurrentRound(roundValue);

  return normalizedRound.isValid
    && normalizedRound.status !== BINGO_ROUND_STATUS_IDLE
    && !!normalizedRound.roundId;
}

export function isBingoRoundOpen(roundValue) {
  const normalizedRound = normalizeBingoCurrentRound(roundValue);

  return normalizedRound.isValid
    && normalizedRound.status === BINGO_ROUND_STATUS_CARDS_OPEN
    && normalizedRound.cardsLocked === false
    && !!normalizedRound.roundId;
}

export function getBingoRoundStatusLabel(statusValue) {
  const normalizedStatus = normalizeBingoRoundStatus(statusValue);
  return BINGO_ROUND_STATUS_LABELS[normalizedStatus] || "Unknown";
}

export function getBingoPlayerCardPath(roundId, playerId) {
  const normalizedRoundId = normalizeTextInput(roundId);
  const normalizedPlayerId = normalizeTextInput(playerId);

  if (!normalizedRoundId || !normalizedPlayerId) {
    return BINGO_LIVE_CARDS_PATH;
  }

  return `${BINGO_LIVE_CARDS_PATH}/${normalizedRoundId}/${normalizedPlayerId}`;
}

export function createEmptyBingoPlayerCard() {
  return {
    roundId: "",
    playerId: "",
    items: [],
    createdAt: "",
    updatedAt: "",
    shuffleCount: 0,
    isValid: true,
    isEmpty: true,
    errors: [],
  };
}

export function normalizeBingoPlayerCard(cardValue, roundValue = null, fallbackValues = {}) {
  const emptyCard = createEmptyBingoPlayerCard();
  const normalizedRound = roundValue ? normalizeBingoCurrentRound(roundValue) : null;

  if (!cardValue || typeof cardValue !== "object") {
    return {
      ...emptyCard,
      roundId: normalizeTextInput(fallbackValues.roundId),
      playerId: normalizeTextInput(fallbackValues.playerId),
    };
  }

  const items = Array.isArray(cardValue.items)
    ? cardValue.items.map(normalizeCardItem).filter(Boolean)
    : [];
  const normalizedCard = {
    roundId: normalizeTextInput(cardValue.roundId || fallbackValues.roundId),
    playerId: normalizeTextInput(cardValue.playerId || fallbackValues.playerId),
    items,
    createdAt: normalizeTextInput(cardValue.createdAt),
    updatedAt: normalizeTextInput(cardValue.updatedAt),
    shuffleCount: Number.isInteger(cardValue.shuffleCount) && cardValue.shuffleCount >= 0
      ? cardValue.shuffleCount
      : 0,
  };
  const errors = [];

  if (!normalizedCard.roundId) {
    errors.push("Bingo card is missing roundId.");
  }

  if (!normalizedCard.playerId) {
    errors.push("Bingo card is missing playerId.");
  }

  if (normalizedCard.items.length !== BINGO_CARD_ITEM_COUNT) {
    errors.push("Bingo card must contain exactly 9 items.");
  }

  const itemIds = new Set();

  normalizedCard.items.forEach((itemValue, index) => {
    if (itemIds.has(itemValue.id)) {
      errors.push(`Bingo card item ${index + 1} duplicates an earlier item.`);
      return;
    }

    itemIds.add(itemValue.id);
  });

  if (!normalizedCard.createdAt) {
    errors.push("Bingo card is missing createdAt.");
  }

  if (!normalizedCard.updatedAt) {
    errors.push("Bingo card is missing updatedAt.");
  }

  if (normalizedRound && normalizedRound.isValid && hasPreparedBingoRound(normalizedRound)) {
    const activePoolIds = new Set(normalizedRound.activePool.map((item) => item.id));

    if (normalizedCard.roundId !== normalizedRound.roundId) {
      errors.push("Bingo card roundId does not match the current round.");
    }

    normalizedCard.items.forEach((itemValue, index) => {
      if (!activePoolIds.has(itemValue.id)) {
        errors.push(`Bingo card item ${index + 1} is not present in the round active pool.`);
      }
    });
  }

  if (errors.length > 0) {
    return {
      ...emptyCard,
      roundId: normalizedCard.roundId,
      playerId: normalizedCard.playerId,
      createdAt: normalizedCard.createdAt,
      updatedAt: normalizedCard.updatedAt,
      shuffleCount: normalizedCard.shuffleCount,
      isValid: false,
      isEmpty: false,
      errors,
    };
  }

  return {
    ...normalizedCard,
    isValid: true,
    isEmpty: false,
    errors: [],
  };
}

export function buildBingoPlayerCardPayload({
  roundId,
  playerId,
  items,
  createdAt = "",
  updatedAt = "",
  shuffleCount = 0,
} = {}, roundValue = null) {
  const payload = {
    roundId: normalizeTextInput(roundId),
    playerId: normalizeTextInput(playerId),
    items: Array.isArray(items) ? items.map(normalizeCardItem).filter(Boolean) : [],
    createdAt: normalizeTextInput(createdAt) || new Date().toISOString(),
    updatedAt: normalizeTextInput(updatedAt) || new Date().toISOString(),
    shuffleCount: Number.isInteger(shuffleCount) && shuffleCount >= 0 ? shuffleCount : 0,
  };
  const normalizedCard = normalizeBingoPlayerCard(payload, roundValue);

  if (!normalizedCard.isValid) {
    throw new Error(normalizedCard.errors[0] || "Bingo card payload is invalid.");
  }

  return {
    roundId: normalizedCard.roundId,
    playerId: normalizedCard.playerId,
    items: normalizedCard.items.slice(),
    createdAt: normalizedCard.createdAt,
    updatedAt: normalizedCard.updatedAt,
    shuffleCount: normalizedCard.shuffleCount,
  };
}

export function isValidBingoPlayerCardForRound(cardValue, roundValue) {
  const normalizedRound = normalizeBingoCurrentRound(roundValue);
  const normalizedCard = normalizeBingoPlayerCard(cardValue, normalizedRound, {
    roundId: normalizedRound.roundId,
  });

  return normalizedRound.isValid
    && hasPreparedBingoRound(normalizedRound)
    && normalizedCard.isValid
    && normalizedCard.roundId === normalizedRound.roundId;
}

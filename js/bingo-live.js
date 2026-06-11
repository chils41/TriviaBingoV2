import {
  BINGO_CARD_ITEM_COUNT,
  BINGO_ROUND_STATUS_CARDS_LOCKED,
  BINGO_ROUND_STATUS_CARDS_OPEN,
  BINGO_ROUND_STATUS_ENDED,
  BINGO_ROUND_STATUS_IDLE,
  BINGO_ROUND_STATUS_IN_PROGRESS,
  createEmptyBingoCurrentRound,
  hasPreparedBingoRound,
  normalizeBingoCurrentRound,
  normalizeBingoPlayerCard,
} from "./bingo-pool.js";
import { normalizeTextInput, sanitizeFirebaseKey } from "./utils.js";

export const BINGO_LIVE_DRAWS_PATH = "bingo/live/draws";
export const BINGO_LIVE_WINNERS_PATH = "bingo/live/winners";
export const BINGO_DRAW_METHOD_RANDOM = "random";
export const BINGO_DRAW_METHOD_MANUAL = "manual";

export const BINGO_LINE_PATTERNS = [
  { key: "row_top", label: "Top Row", positions: [0, 1, 2] },
  { key: "row_middle", label: "Middle Row", positions: [3, 4, 5] },
  { key: "row_bottom", label: "Bottom Row", positions: [6, 7, 8] },
  { key: "column_left", label: "Left Column", positions: [0, 3, 6] },
  { key: "column_middle", label: "Middle Column", positions: [1, 4, 7] },
  { key: "column_right", label: "Right Column", positions: [2, 5, 8] },
  { key: "diagonal_down", label: "Down Diagonal", positions: [0, 4, 8] },
  { key: "diagonal_up", label: "Up Diagonal", positions: [2, 4, 6] },
];

const BINGO_LINE_LOOKUP = new Map(BINGO_LINE_PATTERNS.map((pattern) => [pattern.key, pattern]));
const MATCH_DISTRIBUTION_COUNTS = Array.from(
  { length: BINGO_CARD_ITEM_COUNT + 1 },
  (_, index) => BINGO_CARD_ITEM_COUNT - index
);

function createEmptyBingoWinnerRecord(fallbackValues = {}) {
  return {
    roundId: normalizeTextInput(fallbackValues.roundId),
    playerId: normalizeTextInput(fallbackValues.playerId),
    playerName: "",
    lineWinner: false,
    blackoutWinner: false,
    completedLines: [],
    firstLineAt: "",
    blackoutAt: "",
    updatedAt: "",
    isValid: true,
    isEmpty: true,
    errors: [],
  };
}

function normalizeBingoDrawMethod(methodValue) {
  const normalizedMethod = normalizeTextInput(methodValue).toLowerCase();

  if (normalizedMethod === BINGO_DRAW_METHOD_RANDOM || normalizedMethod === BINGO_DRAW_METHOD_MANUAL) {
    return normalizedMethod;
  }

  return "";
}

function compareDrawRecords(leftDraw, rightDraw) {
  const leftSequence = Number.isInteger(leftDraw?.sequence) ? leftDraw.sequence : 0;
  const rightSequence = Number.isInteger(rightDraw?.sequence) ? rightDraw.sequence : 0;

  if (leftSequence !== rightSequence) {
    return leftSequence - rightSequence;
  }

  const leftTime = normalizeTextInput(leftDraw?.drawnAt);
  const rightTime = normalizeTextInput(rightDraw?.drawnAt);

  if (leftTime !== rightTime) {
    return leftTime.localeCompare(rightTime);
  }

  return normalizeTextInput(leftDraw?.itemId).localeCompare(normalizeTextInput(rightDraw?.itemId));
}

function createDistributionTemplate() {
  return MATCH_DISTRIBUTION_COUNTS.map((matchCount) => ({
    matchCount,
    label: `${matchCount}/${BINGO_CARD_ITEM_COUNT}`,
    count: 0,
  }));
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

function normalizeCompletedLines(lineValues) {
  const normalizedLineSet = new Set(
    (Array.isArray(lineValues) ? lineValues : [])
      .map((lineValue) => normalizeTextInput(lineValue))
      .filter((lineValue) => BINGO_LINE_LOOKUP.has(lineValue))
  );

  return BINGO_LINE_PATTERNS
    .map((pattern) => pattern.key)
    .filter((lineKey) => normalizedLineSet.has(lineKey));
}

function normalizePlayerNameSnapshot(playerName) {
  return normalizeTextInput(playerName);
}

function buildDrawnItemIdSetFromOrderedDraws(orderedDraws) {
  return new Set((Array.isArray(orderedDraws) ? orderedDraws : []).map((drawRecord) => drawRecord.itemId));
}

function buildPlayerNameSnapshot(playersValue, playerId) {
  if (!playersValue || typeof playersValue !== "object" || Array.isArray(playersValue)) {
    return "";
  }

  return normalizePlayerNameSnapshot(playersValue[playerId]?.name);
}

export function createIdleBingoCurrentRound() {
  return createEmptyBingoCurrentRound();
}

export function canLockBingoRound(roundValue) {
  return normalizeBingoCurrentRound(roundValue).status === BINGO_ROUND_STATUS_CARDS_OPEN;
}

export function canStartBingoRound(roundValue) {
  return normalizeBingoCurrentRound(roundValue).status === BINGO_ROUND_STATUS_CARDS_LOCKED;
}

export function canDrawBingoRound(roundValue) {
  return normalizeBingoCurrentRound(roundValue).status === BINGO_ROUND_STATUS_IN_PROGRESS;
}

export function canEndBingoRound(roundValue) {
  const normalizedRound = normalizeBingoCurrentRound(roundValue);

  return normalizedRound.status === BINGO_ROUND_STATUS_CARDS_LOCKED
    || normalizedRound.status === BINGO_ROUND_STATUS_IN_PROGRESS;
}

export function canClearBingoRound(roundValue) {
  return normalizeBingoCurrentRound(roundValue).status !== BINGO_ROUND_STATUS_IDLE;
}

export function getBingoRoundDrawsPath(roundId) {
  const normalizedRoundId = normalizeTextInput(roundId);
  return normalizedRoundId ? `${BINGO_LIVE_DRAWS_PATH}/${normalizedRoundId}` : BINGO_LIVE_DRAWS_PATH;
}

export function getBingoRoundWinnersPath(roundId) {
  const normalizedRoundId = normalizeTextInput(roundId);
  return normalizedRoundId ? `${BINGO_LIVE_WINNERS_PATH}/${normalizedRoundId}` : BINGO_LIVE_WINNERS_PATH;
}

export function getBingoRoundWinnerPath(roundId, playerId) {
  const normalizedRoundId = normalizeTextInput(roundId);
  const normalizedPlayerId = normalizeTextInput(playerId);

  if (!normalizedRoundId || !normalizedPlayerId) {
    return getBingoRoundWinnersPath(normalizedRoundId);
  }

  return `${getBingoRoundWinnersPath(normalizedRoundId)}/${normalizedPlayerId}`;
}

export function getBingoLineLabel(lineKey) {
  return BINGO_LINE_LOOKUP.get(normalizeTextInput(lineKey))?.label || "Unknown Line";
}

export function normalizeBingoDrawRecord(drawValue, fallbackValues = {}) {
  if (!drawValue || typeof drawValue !== "object" || Array.isArray(drawValue)) {
    return null;
  }

  const roundId = normalizeTextInput(drawValue.roundId || fallbackValues.roundId);
  const itemId = sanitizeFirebaseKey(drawValue.itemId || fallbackValues.itemId);
  const name = normalizeTextInput(drawValue.name);
  const sequence = Number.isInteger(drawValue.sequence) && drawValue.sequence > 0
    ? drawValue.sequence
    : 0;
  const drawnAt = normalizeTextInput(drawValue.drawnAt);
  const method = normalizeBingoDrawMethod(drawValue.method);

  if (!roundId || !itemId || itemId === "device_fallback" || !name || !sequence || !drawnAt || !method) {
    return null;
  }

  return {
    roundId,
    itemId,
    name,
    sequence,
    drawnAt,
    method,
  };
}

export function normalizeBingoRoundDraws(drawsValue, roundValue = null) {
  const normalizedRound = roundValue ? normalizeBingoCurrentRound(roundValue) : null;
  const orderedDraws = [];
  const errors = [];
  const usedSequences = new Set();
  const validRoundId = normalizedRound?.roundId || "";
  const activePoolIds = normalizedRound?.isValid && hasPreparedBingoRound(normalizedRound)
    ? new Set(normalizedRound.activePool.map((item) => item.id))
    : null;

  if (drawsValue && typeof drawsValue === "object" && !Array.isArray(drawsValue)) {
    Object.entries(drawsValue).forEach(([itemKey, drawValue]) => {
      const expectedItemId = sanitizeFirebaseKey(itemKey);
      const normalizedDraw = normalizeBingoDrawRecord(drawValue, {
        roundId: validRoundId,
        itemId: expectedItemId,
      });

      if (!normalizedDraw) {
        errors.push(`Draw "${itemKey}" is invalid.`);
        return;
      }

      if (normalizedDraw.itemId !== expectedItemId) {
        errors.push(`Draw "${itemKey}" itemId does not match its Firebase child key.`);
        return;
      }

      if (validRoundId && normalizedDraw.roundId !== validRoundId) {
        errors.push(`Draw "${itemKey}" does not match the current roundId.`);
        return;
      }

      if (activePoolIds && !activePoolIds.has(normalizedDraw.itemId)) {
        errors.push(`Draw "${itemKey}" is not present in the frozen round active pool.`);
        return;
      }

      if (usedSequences.has(normalizedDraw.sequence)) {
        errors.push(`Draw "${itemKey}" duplicates sequence ${normalizedDraw.sequence}.`);
      }

      usedSequences.add(normalizedDraw.sequence);
      orderedDraws.push(normalizedDraw);
    });
  }

  orderedDraws.sort(compareDrawRecords);

  return {
    roundId: validRoundId,
    orderedDraws,
    drawCount: orderedDraws.length,
    lastDraw: orderedDraws.length > 0 ? orderedDraws[orderedDraws.length - 1] : null,
    drawnItemIds: buildDrawnItemIdSetFromOrderedDraws(orderedDraws),
    errors,
  };
}

export function getNextBingoDrawSequence(drawsValue, roundValue = null) {
  const normalizedDraws = normalizeBingoRoundDraws(drawsValue, roundValue);

  if (normalizedDraws.orderedDraws.length === 0) {
    return 1;
  }

  return normalizedDraws.orderedDraws.reduce(
    (highestSequence, drawRecord) => Math.max(highestSequence, drawRecord.sequence),
    0
  ) + 1;
}

export function getUndrawnBingoRoundItems(roundValue, drawsValue = null) {
  const normalizedRound = normalizeBingoCurrentRound(roundValue);

  if (!normalizedRound.isValid || !hasPreparedBingoRound(normalizedRound)) {
    return [];
  }

  const drawnItemIds = drawsValue instanceof Set
    ? drawsValue
    : normalizeBingoRoundDraws(drawsValue, normalizedRound).drawnItemIds;

  return normalizedRound.activePool.filter((item) => !drawnItemIds.has(item.id));
}

export function selectRandomUndrawnBingoItem(roundValue, drawsValue = null) {
  const undrawnItems = getUndrawnBingoRoundItems(roundValue, drawsValue);

  if (undrawnItems.length === 0) {
    return null;
  }

  return undrawnItems[getRandomInt(undrawnItems.length)] || null;
}

export function buildDrawnItemIdSet(drawsValue, roundValue = null) {
  return normalizeBingoRoundDraws(drawsValue, roundValue).drawnItemIds;
}

export function normalizeBingoRoundCards(cardsValue, roundValue) {
  const normalizedRound = normalizeBingoCurrentRound(roundValue);
  const cards = [];
  const errors = [];

  if (!normalizedRound.isValid || !hasPreparedBingoRound(normalizedRound)) {
    return {
      roundId: normalizedRound.roundId,
      cards,
      cardsByPlayerId: new Map(),
      errors,
    };
  }

  if (cardsValue && typeof cardsValue === "object" && !Array.isArray(cardsValue)) {
    Object.entries(cardsValue).forEach(([playerIdKey, cardValue]) => {
      const expectedPlayerId = normalizeTextInput(playerIdKey);

      if (!expectedPlayerId || !cardValue || typeof cardValue !== "object" || Array.isArray(cardValue)) {
        errors.push(`Card "${playerIdKey}" is invalid.`);
        return;
      }

      const normalizedCard = normalizeBingoPlayerCard(cardValue, normalizedRound, {
        roundId: normalizedRound.roundId,
      });

      if (!normalizedCard.isValid) {
        errors.push(`Card "${playerIdKey}" is malformed and was ignored.`);
        return;
      }

      if (normalizedCard.playerId !== expectedPlayerId) {
        errors.push(`Card "${playerIdKey}" playerId does not match its Firebase child key.`);
        return;
      }

      cards.push(normalizedCard);
    });
  }

  return {
    roundId: normalizedRound.roundId,
    cards,
    cardsByPlayerId: new Map(cards.map((cardRecord) => [cardRecord.playerId, cardRecord])),
    errors,
  };
}

export function calculateBingoCardMatchState(cardValue, drawsValue) {
  const cardItems = Array.isArray(cardValue?.items)
    ? cardValue.items
    : Array.isArray(cardValue)
      ? cardValue
      : [];
  const drawnItemIds = drawsValue instanceof Set
    ? drawsValue
    : buildDrawnItemIdSet(drawsValue);
  const matchedPositions = [];
  const matchedItemIds = [];

  cardItems.forEach((itemValue, index) => {
    const itemId = normalizeTextInput(itemValue?.id);

    if (itemId && drawnItemIds.has(itemId)) {
      matchedPositions.push(index);
      matchedItemIds.push(itemId);
    }
  });

  const matchedPositionSet = new Set(matchedPositions);
  const completedLines = BINGO_LINE_PATTERNS
    .filter((pattern) => pattern.positions.every((position) => matchedPositionSet.has(position)))
    .map((pattern) => pattern.key);
  const matchCount = matchedPositions.length;

  return {
    matchedItemIds,
    matchedPositions,
    matchedPositionSet,
    matchCount,
    completedLines,
    isLineWinner: completedLines.length > 0,
    isBlackout: matchCount === BINGO_CARD_ITEM_COUNT,
  };
}

export function calculateBingoWinnerMilestones(cardValue, orderedDrawsValue) {
  const orderedDraws = Array.isArray(orderedDrawsValue)
    ? orderedDrawsValue.slice().sort(compareDrawRecords)
    : normalizeBingoRoundDraws(orderedDrawsValue).orderedDraws;
  const drawnItemIds = new Set();
  let firstLineAt = "";
  let blackoutAt = "";
  let finalState = calculateBingoCardMatchState(cardValue, drawnItemIds);

  orderedDraws.forEach((drawRecord) => {
    drawnItemIds.add(drawRecord.itemId);
    finalState = calculateBingoCardMatchState(cardValue, drawnItemIds);

    if (!firstLineAt && finalState.isLineWinner) {
      firstLineAt = drawRecord.drawnAt;
    }

    if (!blackoutAt && finalState.isBlackout) {
      blackoutAt = drawRecord.drawnAt;
    }
  });

  return {
    ...finalState,
    firstLineAt,
    blackoutAt,
  };
}

export function normalizeBingoWinnerRecord(winnerValue, fallbackValues = {}) {
  const emptyRecord = createEmptyBingoWinnerRecord(fallbackValues);

  if (!winnerValue || typeof winnerValue !== "object" || Array.isArray(winnerValue)) {
    return emptyRecord;
  }

  const roundId = normalizeTextInput(winnerValue.roundId || fallbackValues.roundId);
  const playerId = normalizeTextInput(winnerValue.playerId || fallbackValues.playerId);
  const completedLines = normalizeCompletedLines(winnerValue.completedLines);
  const lineWinner = winnerValue.lineWinner === true || completedLines.length > 0;
  const blackoutWinner = winnerValue.blackoutWinner === true;
  const normalizedRecord = {
    roundId,
    playerId,
    playerName: normalizePlayerNameSnapshot(winnerValue.playerName),
    lineWinner: lineWinner || blackoutWinner,
    blackoutWinner,
    completedLines,
    firstLineAt: normalizeTextInput(winnerValue.firstLineAt),
    blackoutAt: normalizeTextInput(winnerValue.blackoutAt),
    updatedAt: normalizeTextInput(winnerValue.updatedAt),
  };
  const errors = [];

  if (!normalizedRecord.roundId) {
    errors.push("Winner record is missing roundId.");
  }

  if (!normalizedRecord.playerId) {
    errors.push("Winner record is missing playerId.");
  }

  if (!normalizedRecord.lineWinner && normalizedRecord.completedLines.length > 0) {
    errors.push("Winner record completedLines are present but lineWinner is false.");
  }

  if (normalizedRecord.blackoutWinner && !normalizedRecord.lineWinner) {
    errors.push("Winner record blackoutWinner requires lineWinner.");
  }

  if (errors.length > 0) {
    return {
      ...emptyRecord,
      roundId: normalizedRecord.roundId,
      playerId: normalizedRecord.playerId,
      playerName: normalizedRecord.playerName,
      completedLines: normalizedRecord.completedLines,
      firstLineAt: normalizedRecord.firstLineAt,
      blackoutAt: normalizedRecord.blackoutAt,
      updatedAt: normalizedRecord.updatedAt,
      isValid: false,
      isEmpty: false,
      errors,
    };
  }

  return {
    ...normalizedRecord,
    isValid: true,
    isEmpty: false,
    errors: [],
  };
}

export function normalizeBingoWinnerRecords(winnersValue, roundValue = null) {
  const normalizedRound = roundValue ? normalizeBingoCurrentRound(roundValue) : null;
  const winnerRecords = [];
  const winnerMap = new Map();
  const errors = [];
  const expectedRoundId = normalizedRound?.roundId || "";

  if (winnersValue && typeof winnersValue === "object" && !Array.isArray(winnersValue)) {
    Object.entries(winnersValue).forEach(([playerIdKey, winnerValue]) => {
      const expectedPlayerId = normalizeTextInput(playerIdKey);
      const normalizedWinner = normalizeBingoWinnerRecord(winnerValue, {
        roundId: expectedRoundId,
        playerId: expectedPlayerId,
      });

      if (!normalizedWinner.isValid) {
        errors.push(`Winner "${playerIdKey}" is invalid and was ignored.`);
        return;
      }

      if (normalizedWinner.playerId !== expectedPlayerId) {
        errors.push(`Winner "${playerIdKey}" playerId does not match its Firebase child key.`);
        return;
      }

      if (expectedRoundId && normalizedWinner.roundId !== expectedRoundId) {
        errors.push(`Winner "${playerIdKey}" does not match the current roundId.`);
        return;
      }

      winnerRecords.push(normalizedWinner);
      winnerMap.set(normalizedWinner.playerId, normalizedWinner);
    });
  }

  return {
    roundId: expectedRoundId,
    winnerRecords,
    winnerMap,
    errors,
  };
}

export function buildBingoWinnerRecordPayload({
  roundId,
  playerId,
  playerName = "",
  lineWinner = false,
  blackoutWinner = false,
  completedLines = [],
  firstLineAt = "",
  blackoutAt = "",
  existingWinner = null,
  updatedAt = "",
} = {}) {
  const normalizedExistingWinner = normalizeBingoWinnerRecord(existingWinner, {
    roundId,
    playerId,
  });
  const storedWinner = normalizedExistingWinner.isValid && !normalizedExistingWinner.isEmpty
    ? normalizedExistingWinner
    : null;
  const nextPlayerName = storedWinner?.playerName || normalizePlayerNameSnapshot(playerName);
  const nextCompletedLines = normalizeCompletedLines(completedLines);
  const nextLineWinner = lineWinner === true || blackoutWinner === true || nextCompletedLines.length > 0;
  const nextBlackoutWinner = blackoutWinner === true;
  const payload = {
    roundId: normalizeTextInput(roundId),
    playerId: normalizeTextInput(playerId),
    playerName: nextPlayerName,
    lineWinner: nextLineWinner,
    blackoutWinner: nextBlackoutWinner,
    completedLines: nextCompletedLines,
    firstLineAt: storedWinner?.firstLineAt || normalizeTextInput(firstLineAt),
    blackoutAt: storedWinner?.blackoutAt || normalizeTextInput(blackoutAt),
    updatedAt: normalizeTextInput(updatedAt) || new Date().toISOString(),
  };
  const normalizedPayload = normalizeBingoWinnerRecord(payload);

  if (!normalizedPayload.isValid) {
    throw new Error(normalizedPayload.errors[0] || "Winner payload is invalid.");
  }

  return {
    roundId: normalizedPayload.roundId,
    playerId: normalizedPayload.playerId,
    playerName: normalizedPayload.playerName,
    lineWinner: normalizedPayload.lineWinner,
    blackoutWinner: normalizedPayload.blackoutWinner,
    completedLines: normalizedPayload.completedLines.slice(),
    firstLineAt: normalizedPayload.firstLineAt,
    blackoutAt: normalizedPayload.blackoutAt,
    updatedAt: normalizedPayload.updatedAt,
  };
}

export function hasMeaningfulWinnerChange(existingWinner, nextWinner) {
  const normalizedExisting = normalizeBingoWinnerRecord(existingWinner, {
    roundId: nextWinner?.roundId,
    playerId: nextWinner?.playerId,
  });
  const normalizedNext = normalizeBingoWinnerRecord(nextWinner, {
    roundId: existingWinner?.roundId,
    playerId: existingWinner?.playerId,
  });

  if (!normalizedNext.isValid) {
    return false;
  }

  return normalizedExisting.lineWinner !== normalizedNext.lineWinner
    || normalizedExisting.blackoutWinner !== normalizedNext.blackoutWinner
    || normalizedExisting.playerName !== normalizedNext.playerName
    || normalizedExisting.firstLineAt !== normalizedNext.firstLineAt
    || normalizedExisting.blackoutAt !== normalizedNext.blackoutAt
    || normalizedExisting.completedLines.join("|") !== normalizedNext.completedLines.join("|");
}

export function getBingoWinnerGuardKey(roundId, playerId) {
  return `${normalizeTextInput(roundId)}:${normalizeTextInput(playerId)}`;
}

export function calculateBingoMatchDistribution(cards, drawnItemIds) {
  const distribution = createDistributionTemplate();
  const distributionLookup = new Map(distribution.map((entry) => [entry.matchCount, entry]));

  (Array.isArray(cards) ? cards : []).forEach((cardRecord) => {
    const matchState = calculateBingoCardMatchState(cardRecord, drawnItemIds);
    const distributionEntry = distributionLookup.get(matchState.matchCount);

    if (distributionEntry) {
      distributionEntry.count += 1;
    }
  });

  return distribution;
}

export function calculateBingoRoundStatistics({
  roundValue,
  cardsValue,
  drawsValue,
  winnersValue,
  playersValue,
} = {}) {
  const normalizedRound = normalizeBingoCurrentRound(roundValue);
  const drawState = normalizeBingoRoundDraws(drawsValue, normalizedRound);
  const cardState = normalizeBingoRoundCards(cardsValue, normalizedRound);
  const winnerState = normalizeBingoWinnerRecords(winnersValue, normalizedRound);
  const distribution = calculateBingoMatchDistribution(cardState.cards, drawState.drawnItemIds);
  const derivedWinnerCandidates = [];
  const winnerRows = [];

  cardState.cards.forEach((cardRecord) => {
    const matchState = calculateBingoWinnerMilestones(cardRecord, drawState.orderedDraws);
    const storedWinner = winnerState.winnerMap.get(cardRecord.playerId) || null;
    const playerNameSnapshot = buildPlayerNameSnapshot(playersValue, cardRecord.playerId) || storedWinner?.playerName || "";
    const nextWinnerRecord = buildBingoWinnerRecordPayload({
      roundId: normalizedRound.roundId,
      playerId: cardRecord.playerId,
      playerName: playerNameSnapshot,
      lineWinner: matchState.isLineWinner,
      blackoutWinner: matchState.isBlackout,
      completedLines: matchState.completedLines,
      firstLineAt: matchState.firstLineAt,
      blackoutAt: matchState.blackoutAt,
      existingWinner: storedWinner,
    });

    if (matchState.isLineWinner || matchState.isBlackout || !storedWinner?.isEmpty) {
      winnerRows.push({
        playerId: cardRecord.playerId,
        playerName: playerNameSnapshot,
        matchCount: matchState.matchCount,
        completedLines: matchState.completedLines.slice(),
        lineWinner: nextWinnerRecord.lineWinner,
        blackoutWinner: nextWinnerRecord.blackoutWinner,
        firstLineAt: nextWinnerRecord.firstLineAt,
        blackoutAt: nextWinnerRecord.blackoutAt,
      });
    }

    if (matchState.isLineWinner || matchState.isBlackout) {
      derivedWinnerCandidates.push({
        playerId: cardRecord.playerId,
        playerName: playerNameSnapshot,
        matchCount: matchState.matchCount,
        completedLines: matchState.completedLines.slice(),
        lineWinner: matchState.isLineWinner,
        blackoutWinner: matchState.isBlackout,
        firstLineAt: matchState.firstLineAt,
        blackoutAt: matchState.blackoutAt,
        storedWinner,
        nextWinnerRecord,
        hasMeaningfulChange: hasMeaningfulWinnerChange(storedWinner, nextWinnerRecord),
      });
    }
  });

  winnerRows.sort((leftWinner, rightWinner) => {
    if (leftWinner.blackoutWinner !== rightWinner.blackoutWinner) {
      return leftWinner.blackoutWinner ? -1 : 1;
    }

    if (leftWinner.lineWinner !== rightWinner.lineWinner) {
      return leftWinner.lineWinner ? -1 : 1;
    }

    if (leftWinner.matchCount !== rightWinner.matchCount) {
      return rightWinner.matchCount - leftWinner.matchCount;
    }

    const leftName = normalizePlayerNameSnapshot(leftWinner.playerName) || leftWinner.playerId;
    const rightName = normalizePlayerNameSnapshot(rightWinner.playerName) || rightWinner.playerId;
    return leftName.localeCompare(rightName);
  });

  return {
    round: normalizedRound,
    orderedDraws: drawState.orderedDraws,
    drawnItemIds: drawState.drawnItemIds,
    lastDraw: drawState.lastDraw,
    drawCount: drawState.drawCount,
    remainingUndrawnItems: normalizedRound.activePool.length > drawState.drawCount
      ? normalizedRound.activePool.length - drawState.drawCount
      : 0,
    undrawnItems: getUndrawnBingoRoundItems(normalizedRound, drawState.drawnItemIds),
    activeCards: cardState.cards,
    activeCardCount: cardState.cards.length,
    distribution,
    lineWinnerCount: derivedWinnerCandidates.filter((winnerRecord) => winnerRecord.lineWinner).length,
    blackoutWinnerCount: derivedWinnerCandidates.filter((winnerRecord) => winnerRecord.blackoutWinner).length,
    winnerRows,
    derivedWinnerCandidates,
    drawErrors: drawState.errors,
    cardErrors: cardState.errors,
    winnerErrors: winnerState.errors,
  };
}

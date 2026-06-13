import { BINGO_LINE_PATTERNS } from "./bingo-live.js";
import {
  BINGO_ROUND_STATUS_IDLE,
  normalizeBingoCurrentRound,
} from "./bingo-pool.js";
import { normalizeEmailInput, normalizeTextInput } from "./utils.js";

const CHECKED_IN_PLAYERS_EXPORT_COLUMNS = [
  "playerId",
  "name",
  "email",
  "zip",
  "checkedInAt",
  "eventId",
];

const BINGO_WINNERS_EXPORT_COLUMNS = [
  "roundId",
  "playerId",
  "playerName",
  "lineWinner",
  "lineCount",
  "completedLines",
  "blackoutWinner",
  "firstLineAt",
  "blackoutAt",
  "suggestedAwardType",
  "exportedAt",
];

const DANGEROUS_CSV_PREFIX_PATTERN = /^[\t\r\n ]*[=+\-@]/;
const BINGO_LINE_KEY_SET = new Set(BINGO_LINE_PATTERNS.map((pattern) => pattern.key));

function padDatePart(value) {
  return String(value).padStart(2, "0");
}

function buildFilenameTimestamp(date = new Date()) {
  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join("-") + `-${padDatePart(date.getHours())}${padDatePart(date.getMinutes())}`;
}

function buildCsvFilename(prefix, date = new Date()) {
  return `${prefix}-${buildFilenameTimestamp(date)}.csv`;
}

function protectCsvFormulaValue(value) {
  const stringValue = value === null || value === undefined ? "" : String(value);

  // Spreadsheet apps may evaluate cells even when the formula trigger appears after leading whitespace.
  return DANGEROUS_CSV_PREFIX_PATTERN.test(stringValue)
    ? `'${stringValue}`
    : stringValue;
}

function escapeCsvCell(value) {
  const protectedValue = protectCsvFormulaValue(value);
  const escapedValue = protectedValue.replace(/"/g, "\"\"");

  return /[",\r\n]/.test(escapedValue)
    ? `"${escapedValue}"`
    : escapedValue;
}

function buildCsvContent(columns, rows) {
  const headerRow = columns.map((column) => escapeCsvCell(column)).join(",");
  const dataRows = rows.map((row) => columns.map((column) => escapeCsvCell(row[column] ?? "")).join(","));

  return `\uFEFF${[headerRow, ...dataRows].join("\r\n")}`;
}

function triggerCsvDownload(filename, csvContent) {
  const downloadBlob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const downloadUrl = URL.createObjectURL(downloadBlob);
  const downloadLink = document.createElement("a");

  downloadLink.href = downloadUrl;
  downloadLink.download = filename;
  downloadLink.rel = "noopener";
  document.body.append(downloadLink);
  downloadLink.click();
  downloadLink.remove();

  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
}

function createExportResult({
  ok = false,
  tone = ok ? "success" : "warning",
  message = "",
  filename = "",
  rowCount = 0,
} = {}) {
  return {
    ok,
    tone,
    message,
    filename,
    rowCount,
  };
}

function compareTextAscending(leftValue, rightValue) {
  const leftText = normalizeTextInput(leftValue);
  const rightText = normalizeTextInput(rightValue);

  if (!leftText && !rightText) {
    return 0;
  }

  if (!leftText) {
    return 1;
  }

  if (!rightText) {
    return -1;
  }

  return leftText.localeCompare(rightText);
}

function normalizeCheckedInPlayerRecord(playerKey, playerValue, fallbackEventId) {
  if (!playerValue || typeof playerValue !== "object" || Array.isArray(playerValue)) {
    return null;
  }

  const normalizedPlayerKey = normalizeTextInput(playerKey);
  const playerId = normalizeTextInput(playerValue.playerId || normalizedPlayerKey) || normalizedPlayerKey;

  if (!playerId) {
    return null;
  }

  return {
    playerId,
    name: normalizeTextInput(playerValue.name),
    email: normalizeEmailInput(playerValue.email),
    zip: normalizeTextInput(playerValue.zip),
    checkedInAt: normalizeTextInput(playerValue.checkedInAt),
    eventId: normalizeTextInput(playerValue.eventId || fallbackEventId) || fallbackEventId,
  };
}

function normalizeCompletedLinesForExport(lineValues) {
  const normalizedLineKeys = new Set(
    (Array.isArray(lineValues) ? lineValues : [])
      .map((lineValue) => normalizeTextInput(lineValue))
      .filter((lineValue) => BINGO_LINE_KEY_SET.has(lineValue))
  );

  return BINGO_LINE_PATTERNS
    .map((pattern) => pattern.key)
    .filter((lineKey) => normalizedLineKeys.has(lineKey));
}

function normalizeStoredWinnerRecordForExport(roundId, playerKey, winnerValue, exportedAt) {
  if (!winnerValue || typeof winnerValue !== "object" || Array.isArray(winnerValue)) {
    return null;
  }

  const normalizedPlayerKey = normalizeTextInput(playerKey);

  if (!normalizedPlayerKey) {
    return null;
  }

  const storedRoundId = normalizeTextInput(winnerValue.roundId);
  const storedPlayerId = normalizeTextInput(winnerValue.playerId);

  if (storedRoundId && storedRoundId !== roundId) {
    return null;
  }

  if (storedPlayerId && storedPlayerId !== normalizedPlayerKey) {
    return null;
  }

  const lineWinner = winnerValue.lineWinner === true;
  const blackoutWinner = winnerValue.blackoutWinner === true;

  if (!lineWinner && !blackoutWinner) {
    return null;
  }

  const completedLines = normalizeCompletedLinesForExport(winnerValue.completedLines);

  return {
    roundId,
    playerId: storedPlayerId || normalizedPlayerKey,
    playerName: normalizeTextInput(winnerValue.playerName),
    lineWinner,
    lineCount: completedLines.length,
    completedLines: completedLines.join("|"),
    blackoutWinner,
    firstLineAt: normalizeTextInput(winnerValue.firstLineAt),
    blackoutAt: normalizeTextInput(winnerValue.blackoutAt),
    suggestedAwardType: blackoutWinner ? "Blackout" : "Line",
    exportedAt,
  };
}

function didReadEventPathFail(firebase, relativePath, previousError, nextValue) {
  if (nextValue !== null) {
    return false;
  }

  const firebaseStatus = firebase.getStatus();

  if (!firebaseStatus.isConnected) {
    return true;
  }

  const eventPath = typeof firebase.getEventPath === "function"
    ? firebase.getEventPath(relativePath)
    : relativePath;
  const nextError = String(firebaseStatus.error || "");

  return Boolean(nextError && nextError !== String(previousError || "") && nextError.includes(eventPath));
}

async function readEventPath(firebase, relativePath) {
  const previousError = firebase.getStatus().error;
  const value = await firebase.readEventData(relativePath);
  const status = firebase.getStatus();

  return {
    value,
    status,
    failed: didReadEventPathFail(firebase, relativePath, previousError, value),
  };
}

function downloadCsvExport({ columns, rows, filenamePrefix, exportedAt = new Date() }) {
  const filename = buildCsvFilename(filenamePrefix, exportedAt);
  const csvContent = buildCsvContent(columns, rows);

  triggerCsvDownload(filename, csvContent);
  return filename;
}

export function getExportCapabilities(role) {
  return {
    allowed: role === "admin",
  };
}

export async function downloadCheckedInPlayersCsv({
  firebase,
  eventId = "",
} = {}) {
  const { value: playersValue, failed, status } = await readEventPath(firebase, "players");

  if (failed) {
    return createExportResult({
      message: status.message || "Checked-in players could not be loaded right now.",
      tone: "error",
    });
  }

  const normalizedEventId = normalizeTextInput(eventId || firebase.getEventId()) || firebase.getEventId();
  const playerRows = [];

  if (playersValue && typeof playersValue === "object" && !Array.isArray(playersValue)) {
    Object.entries(playersValue).forEach(([playerKey, playerValue]) => {
      const normalizedPlayer = normalizeCheckedInPlayerRecord(playerKey, playerValue, normalizedEventId);

      if (normalizedPlayer) {
        playerRows.push(normalizedPlayer);
      }
    });
  }

  playerRows.sort((leftPlayer, rightPlayer) => {
    const leftCheckedInAt = normalizeTextInput(leftPlayer.checkedInAt);
    const rightCheckedInAt = normalizeTextInput(rightPlayer.checkedInAt);

    if (leftCheckedInAt && rightCheckedInAt && leftCheckedInAt !== rightCheckedInAt) {
      return leftCheckedInAt.localeCompare(rightCheckedInAt);
    }

    if (leftCheckedInAt !== rightCheckedInAt) {
      return leftCheckedInAt ? -1 : 1;
    }

    const nameComparison = compareTextAscending(leftPlayer.name, rightPlayer.name);

    if (nameComparison !== 0) {
      return nameComparison;
    }

    return compareTextAscending(leftPlayer.playerId, rightPlayer.playerId);
  });

  if (playerRows.length === 0) {
    return createExportResult({
      message: "No checked-in players are available to export yet.",
      tone: "warning",
    });
  }

  const exportedAt = new Date();
  const filename = downloadCsvExport({
    columns: CHECKED_IN_PLAYERS_EXPORT_COLUMNS,
    rows: playerRows,
    filenamePrefix: "event-engine-players",
    exportedAt,
  });

  return createExportResult({
    ok: true,
    tone: "success",
    message: `Checked-In Players CSV downloaded (${playerRows.length} ${playerRows.length === 1 ? "row" : "rows"}).`,
    filename,
    rowCount: playerRows.length,
  });
}

export async function downloadBingoWinnersCsv({
  firebase,
  eventId = "",
} = {}) {
  const currentRoundRead = await readEventPath(firebase, "bingo/live/currentRound");

  if (currentRoundRead.failed) {
    return createExportResult({
      message: currentRoundRead.status.message || "The current Bingo round could not be loaded right now.",
      tone: "error",
    });
  }

  const currentRound = normalizeBingoCurrentRound(currentRoundRead.value);

  if (
    !currentRound.isValid
    || !currentRound.roundId
    || currentRound.status === BINGO_ROUND_STATUS_IDLE
  ) {
    return createExportResult({
      message: "No current or ended Bingo round is available to export. Idle or missing rounds do not create a winners CSV.",
      tone: "warning",
    });
  }

  const winnersPath = `bingo/live/winners/${currentRound.roundId}`;
  const winnersRead = await readEventPath(firebase, winnersPath);

  if (winnersRead.failed) {
    return createExportResult({
      message: winnersRead.status.message || "Stored Bingo winner records could not be loaded right now.",
      tone: "error",
    });
  }

  const normalizedEventId = normalizeTextInput(eventId || firebase.getEventId()) || firebase.getEventId();
  const exportedAt = new Date().toISOString();
  const winnerRows = [];

  if (winnersRead.value && typeof winnersRead.value === "object" && !Array.isArray(winnersRead.value)) {
    Object.entries(winnersRead.value).forEach(([playerKey, winnerValue]) => {
      const normalizedWinner = normalizeStoredWinnerRecordForExport(
        currentRound.roundId,
        playerKey,
        winnerValue,
        exportedAt
      );

      if (normalizedWinner) {
        winnerRows.push(normalizedWinner);
      }
    });
  }

  winnerRows.sort((leftWinner, rightWinner) => {
    if (leftWinner.blackoutWinner !== rightWinner.blackoutWinner) {
      return leftWinner.blackoutWinner ? -1 : 1;
    }

    if (leftWinner.lineWinner !== rightWinner.lineWinner) {
      return leftWinner.lineWinner ? -1 : 1;
    }

    if (leftWinner.lineCount !== rightWinner.lineCount) {
      return rightWinner.lineCount - leftWinner.lineCount;
    }

    const playerNameComparison = compareTextAscending(leftWinner.playerName, rightWinner.playerName);

    if (playerNameComparison !== 0) {
      return playerNameComparison;
    }

    return compareTextAscending(leftWinner.playerId, rightWinner.playerId);
  });

  if (winnerRows.length === 0) {
    return createExportResult({
      message: `No qualifying Bingo winners are stored for round ${currentRound.roundId} yet.`,
      tone: "warning",
    });
  }

  const filename = downloadCsvExport({
    columns: BINGO_WINNERS_EXPORT_COLUMNS,
    rows: winnerRows,
    filenamePrefix: "event-engine-bingo-winners",
    exportedAt: new Date(),
  });

  return createExportResult({
    ok: true,
    tone: "success",
    message: `Bingo Winners CSV downloaded for round ${currentRound.roundId} (${winnerRows.length} ${winnerRows.length === 1 ? "row" : "rows"}).`,
    filename,
    rowCount: winnerRows.length,
    eventId: normalizedEventId,
  });
}

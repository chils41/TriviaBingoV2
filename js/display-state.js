import {
  TRIVIA_ROUND_STATUS_REVEALED,
  hasActiveTriviaRound,
  normalizeTriviaCurrentRound,
} from "./trivia-live.js";
import { normalizeTextInput } from "./utils.js";

export const DISPLAY_PATH = "display";
export const DISPLAY_SCHEMA_VERSION = 1;
export const DISPLAY_MODE_WAITING = "waiting";
export const DISPLAY_MODE_TRIVIA = "trivia";
export const DISPLAY_MODE_TRIVIA_REVEAL = "trivia_reveal";
export const DISPLAY_MODE_BINGO = "bingo";
export const DISPLAY_MODE_WINNER = "winner";
export const DISPLAY_MODE_ANNOUNCEMENT = "announcement";
export const DISPLAY_MODES = [
  DISPLAY_MODE_WAITING,
  DISPLAY_MODE_TRIVIA,
  DISPLAY_MODE_TRIVIA_REVEAL,
  DISPLAY_MODE_BINGO,
  DISPLAY_MODE_WINNER,
  DISPLAY_MODE_ANNOUNCEMENT,
];

export const DISPLAY_WAITING_STATUS_MAX_LENGTH = 200;
export const DISPLAY_MESSAGE_TITLE_MAX_LENGTH = 100;
export const DISPLAY_MESSAGE_BODY_MAX_LENGTH = 500;
export const DEFAULT_WAITING_STATUS_MESSAGE = "Waiting for the next round...";

function normalizeDisplayMode(modeValue) {
  const normalizedMode = normalizeTextInput(modeValue).toLowerCase();
  return DISPLAY_MODES.includes(normalizedMode)
    ? normalizedMode
    : "";
}

function normalizeLimitedText(value, maxLength) {
  return normalizeTextInput(value).slice(0, maxLength);
}

function normalizeDisplayRole(roleValue) {
  const normalizedRole = normalizeTextInput(roleValue).toLowerCase();

  if (normalizedRole === "host" || normalizedRole === "admin") {
    return normalizedRole;
  }

  return normalizedRole;
}

function normalizeDisplayMessage(messageValue) {
  if (!messageValue || typeof messageValue !== "object" || Array.isArray(messageValue)) {
    return {
      title: "",
      message: "",
    };
  }

  return {
    title: normalizeLimitedText(messageValue.title, DISPLAY_MESSAGE_TITLE_MAX_LENGTH),
    message: normalizeLimitedText(messageValue.message, DISPLAY_MESSAGE_BODY_MAX_LENGTH),
  };
}

export function getWaitingStatusFallback(eventConfig = null) {
  return normalizeLimitedText(
    eventConfig?.eventStatus,
    DISPLAY_WAITING_STATUS_MAX_LENGTH
  ) || DEFAULT_WAITING_STATUS_MESSAGE;
}

export function getDisplayMessageTitle(messageValue, fallbackTitle) {
  return normalizeLimitedText(messageValue?.title, DISPLAY_MESSAGE_TITLE_MAX_LENGTH) || fallbackTitle;
}

export function hasWinnerDisplayMessage(displayState) {
  return normalizeLimitedText(displayState?.winner?.message, DISPLAY_MESSAGE_BODY_MAX_LENGTH).length > 0;
}

export function hasAnnouncementDisplayMessage(displayState) {
  return normalizeLimitedText(displayState?.announcement?.message, DISPLAY_MESSAGE_BODY_MAX_LENGTH).length > 0;
}

export function isDisplayTriviaMode(modeValue) {
  const normalizedMode = normalizeDisplayMode(modeValue);
  return normalizedMode === DISPLAY_MODE_TRIVIA || normalizedMode === DISPLAY_MODE_TRIVIA_REVEAL;
}

export function createLocalDisplayState(eventConfig = null) {
  return {
    schemaVersion: DISPLAY_SCHEMA_VERSION,
    mode: DISPLAY_MODE_WAITING,
    statusMessage: getWaitingStatusFallback(eventConfig),
    announcement: {
      title: "",
      message: "",
    },
    winner: {
      title: "",
      message: "",
    },
    triviaRoundId: "",
    updatedAt: "",
    updatedByRole: "",
    isMissing: true,
    isValid: true,
    errors: [],
  };
}

export function normalizeDisplayState(displayValue, eventConfig = null) {
  const localDisplayState = createLocalDisplayState(eventConfig);

  if (!displayValue || typeof displayValue !== "object" || Array.isArray(displayValue)) {
    return localDisplayState;
  }

  const errors = [];
  const normalizedMode = normalizeDisplayMode(displayValue.mode) || DISPLAY_MODE_WAITING;
  const normalizedState = {
    schemaVersion: Number.isInteger(displayValue.schemaVersion)
      ? displayValue.schemaVersion
      : DISPLAY_SCHEMA_VERSION,
    mode: normalizedMode,
    statusMessage: normalizeLimitedText(
      displayValue.statusMessage,
      DISPLAY_WAITING_STATUS_MAX_LENGTH
    ) || getWaitingStatusFallback(eventConfig),
    announcement: normalizeDisplayMessage(displayValue.announcement),
    winner: normalizeDisplayMessage(displayValue.winner),
    triviaRoundId: normalizeTextInput(displayValue.triviaRoundId),
    updatedAt: normalizeTextInput(displayValue.updatedAt),
    updatedByRole: normalizeDisplayRole(displayValue.updatedByRole),
    isMissing: false,
    isValid: true,
    errors: [],
  };

  if (!normalizeDisplayMode(displayValue.mode)) {
    errors.push(`Display mode "${normalizeTextInput(displayValue.mode) || "(missing)"}" is invalid.`);
  }

  if (
    normalizedState.mode !== DISPLAY_MODE_TRIVIA
    && normalizedState.mode !== DISPLAY_MODE_TRIVIA_REVEAL
    && normalizedState.triviaRoundId
  ) {
    normalizedState.triviaRoundId = "";
  }

  normalizedState.isValid = errors.length === 0;
  normalizedState.errors = errors;
  return normalizedState;
}

function buildMetadataPatch(updatedByRole) {
  return {
    schemaVersion: DISPLAY_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    updatedByRole: normalizeDisplayRole(updatedByRole),
  };
}

export function buildDisplayModePatch({
  mode,
  updatedByRole,
  triviaRoundId = "",
} = {}) {
  const normalizedMode = normalizeDisplayMode(mode) || DISPLAY_MODE_WAITING;

  return {
    mode: normalizedMode,
    triviaRoundId: isDisplayTriviaMode(normalizedMode)
      ? normalizeTextInput(triviaRoundId)
      : "",
    ...buildMetadataPatch(updatedByRole),
  };
}

export function buildWaitingDisplayPatch({
  statusMessage,
  eventConfig = null,
  updatedByRole,
} = {}) {
  return {
    mode: DISPLAY_MODE_WAITING,
    statusMessage: normalizeLimitedText(statusMessage, DISPLAY_WAITING_STATUS_MAX_LENGTH)
      || getWaitingStatusFallback(eventConfig),
    triviaRoundId: "",
    ...buildMetadataPatch(updatedByRole),
  };
}

export function buildAnnouncementDisplayPatch({
  title,
  message,
  updatedByRole,
} = {}) {
  return {
    mode: DISPLAY_MODE_ANNOUNCEMENT,
    announcement: {
      title: normalizeLimitedText(title, DISPLAY_MESSAGE_TITLE_MAX_LENGTH),
      message: normalizeLimitedText(message, DISPLAY_MESSAGE_BODY_MAX_LENGTH),
    },
    triviaRoundId: "",
    ...buildMetadataPatch(updatedByRole),
  };
}

export function buildWinnerDisplayPatch({
  title,
  message,
  updatedByRole,
} = {}) {
  return {
    mode: DISPLAY_MODE_WINNER,
    winner: {
      title: normalizeLimitedText(title, DISPLAY_MESSAGE_TITLE_MAX_LENGTH),
      message: normalizeLimitedText(message, DISPLAY_MESSAGE_BODY_MAX_LENGTH),
    },
    triviaRoundId: "",
    ...buildMetadataPatch(updatedByRole),
  };
}

export function validateAnnouncementDraft({ title, message } = {}) {
  const normalizedTitle = normalizeLimitedText(title, DISPLAY_MESSAGE_TITLE_MAX_LENGTH);
  const normalizedMessage = normalizeLimitedText(message, DISPLAY_MESSAGE_BODY_MAX_LENGTH);

  if (!normalizedMessage) {
    return {
      ok: false,
      message: "Announcement text is required before the public display can switch to Announcement mode.",
    };
  }

  return {
    ok: true,
    title: normalizedTitle,
    message: normalizedMessage,
  };
}

export function validateWinnerDraft({ title, message } = {}) {
  const normalizedTitle = normalizeLimitedText(title, DISPLAY_MESSAGE_TITLE_MAX_LENGTH);
  const normalizedMessage = normalizeLimitedText(message, DISPLAY_MESSAGE_BODY_MAX_LENGTH);

  if (!normalizedMessage) {
    return {
      ok: false,
      message: "Winner text is required before the public display can switch to Winner mode.",
    };
  }

  return {
    ok: true,
    title: normalizedTitle,
    message: normalizedMessage,
  };
}

export function canDisplayTriviaRound(roundValue) {
  const normalizedRound = normalizeTriviaCurrentRound(roundValue);

  return normalizedRound.isValid && hasActiveTriviaRound(normalizedRound);
}

export function canDisplayTriviaRevealRound(roundValue) {
  const normalizedRound = normalizeTriviaCurrentRound(roundValue);

  return normalizedRound.isValid
    && hasActiveTriviaRound(normalizedRound)
    && normalizedRound.status === TRIVIA_ROUND_STATUS_REVEALED;
}

export function doesDisplayTriviaRoundMatch(displayState, roundValue) {
  const normalizedRound = normalizeTriviaCurrentRound(roundValue);
  const normalizedDisplayState = normalizeDisplayState(displayState);

  return canDisplayTriviaRound(normalizedRound)
    && normalizedDisplayState.triviaRoundId
    && normalizedDisplayState.triviaRoundId === normalizedRound.roundId;
}

export function formatDisplayModeLabel(modeValue) {
  const normalizedMode = normalizeDisplayMode(modeValue);

  switch (normalizedMode) {
    case DISPLAY_MODE_WAITING:
      return "Waiting";
    case DISPLAY_MODE_TRIVIA:
      return "Trivia";
    case DISPLAY_MODE_TRIVIA_REVEAL:
      return "Trivia Reveal";
    case DISPLAY_MODE_BINGO:
      return "Bingo";
    case DISPLAY_MODE_WINNER:
      return "Winner";
    case DISPLAY_MODE_ANNOUNCEMENT:
      return "Announcement";
    default:
      return "Waiting";
  }
}

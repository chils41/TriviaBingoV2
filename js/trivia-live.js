import { normalizeTextInput, sanitizeFirebaseKey } from "./utils.js";

export const TRIVIA_LIVE_ROOT_PATH = "trivia/live";
export const TRIVIA_CURRENT_ROUND_PATH = `${TRIVIA_LIVE_ROOT_PATH}/currentRound`;
export const TRIVIA_ANSWERS_PATH = `${TRIVIA_LIVE_ROOT_PATH}/answers`;

export const TRIVIA_ROUND_STATUS_IDLE = "idle";
export const TRIVIA_ROUND_STATUS_QUESTION_LIVE = "question_live";
export const TRIVIA_ROUND_STATUS_LOCKED = "locked";
export const TRIVIA_ROUND_STATUS_REVEALED = "revealed";
export const TRIVIA_ROUND_STATUSES = [
  TRIVIA_ROUND_STATUS_IDLE,
  TRIVIA_ROUND_STATUS_QUESTION_LIVE,
  TRIVIA_ROUND_STATUS_LOCKED,
  TRIVIA_ROUND_STATUS_REVEALED,
];

const TRIVIA_ROUND_STATUS_LABELS = {
  [TRIVIA_ROUND_STATUS_IDLE]: "Idle",
  [TRIVIA_ROUND_STATUS_QUESTION_LIVE]: "Question Live",
  [TRIVIA_ROUND_STATUS_LOCKED]: "Locked",
  [TRIVIA_ROUND_STATUS_REVEALED]: "Revealed",
};

function normalizeTriviaStatus(statusValue) {
  return normalizeTextInput(statusValue).toLowerCase();
}

function normalizeTriviaOptions(optionValues) {
  return Array.isArray(optionValues)
    ? optionValues.map((optionValue) => normalizeTextInput(optionValue))
    : [];
}

function isEmptyRoundShape(roundShape) {
  return !roundShape.roundId
    && !roundShape.questionId
    && !roundShape.difficulty
    && !roundShape.question
    && roundShape.options.length === 0
    && roundShape.correctAnswer === null
    && !roundShape.pushedAt
    && !roundShape.lockedAt
    && !roundShape.revealedAt;
}

export function createEmptyTriviaCurrentRound() {
  return {
    roundId: "",
    status: TRIVIA_ROUND_STATUS_IDLE,
    questionId: "",
    difficulty: "",
    question: "",
    options: [],
    correctAnswer: null,
    pushedAt: "",
    lockedAt: "",
    revealedAt: "",
  };
}

export function normalizeTriviaCurrentRound(roundValue) {
  const baseRound = createEmptyTriviaCurrentRound();

  if (!roundValue || typeof roundValue !== "object") {
    return {
      ...baseRound,
      isValid: true,
      isEmpty: true,
      errors: [],
    };
  }

  const normalizedRound = {
    roundId: normalizeTextInput(roundValue.roundId),
    status: normalizeTriviaStatus(roundValue.status) || TRIVIA_ROUND_STATUS_IDLE,
    questionId: normalizeTextInput(roundValue.questionId),
    difficulty: normalizeTextInput(roundValue.difficulty).toLowerCase(),
    question: normalizeTextInput(roundValue.question),
    options: normalizeTriviaOptions(roundValue.options),
    correctAnswer: Number.isInteger(roundValue.correctAnswer) ? roundValue.correctAnswer : null,
    pushedAt: normalizeTextInput(roundValue.pushedAt),
    lockedAt: normalizeTextInput(roundValue.lockedAt),
    revealedAt: normalizeTextInput(roundValue.revealedAt),
  };

  if (isEmptyRoundShape(normalizedRound)) {
    return {
      ...baseRound,
      isValid: true,
      isEmpty: true,
      errors: [],
    };
  }

  const errors = [];

  if (!TRIVIA_ROUND_STATUSES.includes(normalizedRound.status)) {
    errors.push(`Round status "${normalizedRound.status || "(missing)"}" is invalid.`);
  }

  if (normalizedRound.status !== TRIVIA_ROUND_STATUS_IDLE) {
    if (!normalizedRound.roundId) {
      errors.push("Live Trivia round is missing roundId.");
    }

    if (!normalizedRound.questionId) {
      errors.push("Live Trivia round is missing questionId.");
    }

    if (!normalizedRound.question) {
      errors.push("Live Trivia round is missing question text.");
    }

    if (normalizedRound.options.length < 2) {
      errors.push("Live Trivia round must include at least two answer options.");
    }

    if (!Number.isInteger(normalizedRound.correctAnswer)) {
      errors.push("Live Trivia round is missing a valid correct answer index.");
    } else if (normalizedRound.correctAnswer < 0 || normalizedRound.correctAnswer >= normalizedRound.options.length) {
      errors.push("Live Trivia round correct answer index is outside the options array.");
    }

    if (!normalizedRound.pushedAt) {
      errors.push("Live Trivia round is missing pushedAt.");
    }
  }

  if (normalizedRound.status === TRIVIA_ROUND_STATUS_REVEALED && !normalizedRound.lockedAt) {
    errors.push("Revealed Live Trivia round is missing lockedAt.");
  }

  if (errors.length > 0) {
    return {
      ...baseRound,
      isValid: false,
      isEmpty: false,
      errors,
    };
  }

  return {
    ...normalizedRound,
    isValid: true,
    isEmpty: normalizedRound.status === TRIVIA_ROUND_STATUS_IDLE && isEmptyRoundShape(normalizedRound),
    errors: [],
  };
}

export function createTriviaRoundId() {
  const rawId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  return sanitizeFirebaseKey(`trivia_${rawId}`);
}

export function buildLiveTriviaRoundPayload(question, options = {}) {
  const questionOptions = normalizeTriviaOptions(question?.options);
  const correctAnswer = Number.isInteger(question?.answer)
    ? question.answer
    : Number.isInteger(question?.correctAnswer)
      ? question.correctAnswer
      : null;
  const payload = {
    roundId: normalizeTextInput(options.roundId) || createTriviaRoundId(),
    status: TRIVIA_ROUND_STATUS_QUESTION_LIVE,
    questionId: normalizeTextInput(question?.id || question?.questionId),
    difficulty: normalizeTextInput(question?.difficulty).toLowerCase(),
    question: normalizeTextInput(question?.question),
    options: questionOptions,
    correctAnswer,
    pushedAt: normalizeTextInput(options.pushedAt) || new Date().toISOString(),
    lockedAt: "",
    revealedAt: "",
  };
  const normalizedPayload = normalizeTriviaCurrentRound(payload);

  if (!normalizedPayload.isValid) {
    throw new Error(normalizedPayload.errors[0] || "Live Trivia round payload is invalid.");
  }

  return {
    roundId: normalizedPayload.roundId,
    status: normalizedPayload.status,
    questionId: normalizedPayload.questionId,
    difficulty: normalizedPayload.difficulty,
    question: normalizedPayload.question,
    options: normalizedPayload.options.slice(),
    correctAnswer: normalizedPayload.correctAnswer,
    pushedAt: normalizedPayload.pushedAt,
    lockedAt: normalizedPayload.lockedAt,
    revealedAt: normalizedPayload.revealedAt,
  };
}

export function hasActiveTriviaRound(roundValue) {
  const normalizedRound = normalizeTriviaCurrentRound(roundValue);
  return normalizedRound.isValid
    && normalizedRound.status !== TRIVIA_ROUND_STATUS_IDLE
    && !!normalizedRound.roundId;
}

export function isTriviaRoundLive(roundValue) {
  return normalizeTriviaCurrentRound(roundValue).status === TRIVIA_ROUND_STATUS_QUESTION_LIVE;
}

export function canLockTriviaRound(roundValue) {
  return isTriviaRoundLive(roundValue);
}

export function canRevealTriviaRound(roundValue) {
  return normalizeTriviaCurrentRound(roundValue).status === TRIVIA_ROUND_STATUS_LOCKED;
}

export function canEndTriviaRound(roundValue) {
  return hasActiveTriviaRound(roundValue);
}

export function getTriviaRoundStatusLabel(statusValue) {
  const normalizedStatus = normalizeTriviaStatus(statusValue);
  return TRIVIA_ROUND_STATUS_LABELS[normalizedStatus] || "Unknown";
}

export function getTriviaRoundAnswersPath(roundId) {
  const normalizedRoundId = normalizeTextInput(roundId);
  return normalizedRoundId ? `${TRIVIA_ANSWERS_PATH}/${normalizedRoundId}` : TRIVIA_ANSWERS_PATH;
}

export function getTriviaPlayerAnswerPath(roundId, playerId) {
  const normalizedRoundId = normalizeTextInput(roundId);
  const normalizedPlayerId = normalizeTextInput(playerId);

  if (!normalizedRoundId || !normalizedPlayerId) {
    return TRIVIA_ANSWERS_PATH;
  }

  return `${TRIVIA_ANSWERS_PATH}/${normalizedRoundId}/${normalizedPlayerId}`;
}

export function createEmptyTriviaAnswerRecord() {
  return {
    roundId: "",
    playerId: "",
    answer: null,
    submittedAt: "",
    updatedAt: "",
    isValid: true,
    isEmpty: true,
    errors: [],
  };
}

export function normalizeTriviaAnswerRecord(answerValue, fallbackValues = {}) {
  const emptyRecord = createEmptyTriviaAnswerRecord();

  if (!answerValue || typeof answerValue !== "object") {
    return {
      ...emptyRecord,
      roundId: normalizeTextInput(fallbackValues.roundId),
      playerId: normalizeTextInput(fallbackValues.playerId),
    };
  }

  const normalizedRecord = {
    roundId: normalizeTextInput(answerValue.roundId || fallbackValues.roundId),
    playerId: normalizeTextInput(answerValue.playerId || fallbackValues.playerId),
    answer: Number.isInteger(answerValue.answer) ? answerValue.answer : null,
    submittedAt: normalizeTextInput(answerValue.submittedAt),
    updatedAt: normalizeTextInput(answerValue.updatedAt),
  };
  const errors = [];

  if (!normalizedRecord.roundId) {
    errors.push("Trivia answer is missing roundId.");
  }

  if (!normalizedRecord.playerId) {
    errors.push("Trivia answer is missing playerId.");
  }

  if (!Number.isInteger(normalizedRecord.answer) || normalizedRecord.answer < 0) {
    errors.push("Trivia answer is missing a valid answer index.");
  }

  if (errors.length > 0) {
    return {
      ...emptyRecord,
      roundId: normalizedRecord.roundId,
      playerId: normalizedRecord.playerId,
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

export function buildTriviaAnswerPayload({
  roundId,
  playerId,
  answer,
  submittedAt = "",
  updatedAt = "",
}) {
  const payload = {
    roundId: normalizeTextInput(roundId),
    playerId: normalizeTextInput(playerId),
    answer,
    submittedAt: normalizeTextInput(submittedAt),
    updatedAt: normalizeTextInput(updatedAt) || new Date().toISOString(),
  };
  const normalizedPayload = normalizeTriviaAnswerRecord(payload);

  if (!normalizedPayload.isValid) {
    throw new Error(normalizedPayload.errors[0] || "Trivia answer payload is invalid.");
  }

  return {
    roundId: normalizedPayload.roundId,
    playerId: normalizedPayload.playerId,
    answer: normalizedPayload.answer,
    submittedAt: normalizedPayload.submittedAt || normalizedPayload.updatedAt,
    updatedAt: normalizedPayload.updatedAt,
  };
}

export function isValidTriviaAnswerForRound(answerValue, roundValue) {
  const normalizedRound = normalizeTriviaCurrentRound(roundValue);
  const normalizedAnswer = normalizeTriviaAnswerRecord(answerValue, {
    roundId: normalizedRound.roundId,
  });

  return normalizedRound.isValid
    && hasActiveTriviaRound(normalizedRound)
    && normalizedAnswer.isValid
    && normalizedAnswer.roundId === normalizedRound.roundId
    && normalizedAnswer.answer >= 0
    && normalizedAnswer.answer < normalizedRound.options.length;
}

export function createEmptyTriviaAnswerStats(roundValue) {
  const normalizedRound = normalizeTriviaCurrentRound(roundValue);

  return {
    roundId: normalizedRound.roundId,
    totalSubmitted: 0,
    optionStats: normalizedRound.options.map((optionLabel, optionIndex) => ({
      index: optionIndex,
      label: optionLabel,
      count: 0,
      percentage: 0,
      isCorrect: optionIndex === normalizedRound.correctAnswer,
    })),
  };
}

export function calculateTriviaAnswerStats(answerRecordsValue, roundValue) {
  const normalizedRound = normalizeTriviaCurrentRound(roundValue);
  const emptyStats = createEmptyTriviaAnswerStats(normalizedRound);

  if (!normalizedRound.isValid || !hasActiveTriviaRound(normalizedRound)) {
    return emptyStats;
  }

  const counts = normalizedRound.options.map(() => 0);
  const answerRecords = answerRecordsValue && typeof answerRecordsValue === "object"
    ? Object.values(answerRecordsValue)
    : [];

  answerRecords.forEach((answerRecord) => {
    const normalizedAnswer = normalizeTriviaAnswerRecord(answerRecord);

    if (!normalizedAnswer.isValid) {
      return;
    }

    if (normalizedAnswer.roundId !== normalizedRound.roundId) {
      return;
    }

    if (normalizedAnswer.answer < 0 || normalizedAnswer.answer >= counts.length) {
      return;
    }

    counts[normalizedAnswer.answer] += 1;
  });

  const totalSubmitted = counts.reduce((runningTotal, count) => runningTotal + count, 0);

  return {
    roundId: normalizedRound.roundId,
    totalSubmitted,
    optionStats: normalizedRound.options.map((optionLabel, optionIndex) => ({
      index: optionIndex,
      label: optionLabel,
      count: counts[optionIndex],
      percentage: totalSubmitted > 0 ? Math.round((counts[optionIndex] / totalSubmitted) * 100) : 0,
      isCorrect: optionIndex === normalizedRound.correctAnswer,
    })),
  };
}

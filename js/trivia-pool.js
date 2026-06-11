import { normalizeTextInput } from "./utils.js";

export const TRIVIA_QUESTION_POOL_PATH = "trivia/questionPool";
export const TRIVIA_QUESTION_POOL_SCHEMA_VERSION = 1;
export const TRIVIA_DIFFICULTIES = ["easy", "medium", "hard"];
export const TRIVIA_QUESTION_POOL_SAFE_EXAMPLE_JSON = JSON.stringify(
  [
    {
      id: "q1",
      difficulty: "easy",
      question: "Which bourbon brand uses a horse and jockey stopper?",
      options: [
        "Weller",
        "Blanton's",
        "Eagle Rare",
        "Buffalo Trace",
      ],
      answer: 1,
    },
    {
      id: "q2",
      difficulty: "medium",
      question: "Which mash bill is commonly associated with Maker's Mark?",
      options: [
        "High-rye bourbon",
        "Wheated bourbon",
        "Corn whiskey",
        "Tennessee whiskey",
      ],
      answer: 1,
    },
  ],
  null,
  2
);

const FIREBASE_KEY_UNSAFE_PATTERN = /[.#$\[\]\/]/;

function normalizeDifficulty(value) {
  return normalizeTextInput(value).toLowerCase();
}

function createEmptyCounts() {
  return {
    easy: 0,
    medium: 0,
    hard: 0,
    total: 0,
  };
}

function createEmptyQuestionPool(updatedAt = "") {
  return {
    schemaVersion: TRIVIA_QUESTION_POOL_SCHEMA_VERSION,
    questions: {},
    order: [],
    counts: createEmptyCounts(),
    updatedAt: normalizeTextInput(updatedAt),
  };
}

function createQuestionError(questionIndex, questionId, message) {
  const label = normalizeTextInput(questionId);
  return `Question ${questionIndex + 1}${label ? ` (${label})` : ""}: ${message}`;
}

function buildCounts(questions) {
  return questions.reduce((counts, question) => {
    counts[question.difficulty] += 1;
    counts.total += 1;
    return counts;
  }, createEmptyCounts());
}

function buildQuestionMap(questions) {
  return questions.reduce((questionMap, question) => {
    questionMap[question.id] = {
      id: question.id,
      difficulty: question.difficulty,
      question: question.question,
      options: question.options.slice(),
      answer: question.answer,
    };
    return questionMap;
  }, {});
}

function normalizeQuestion(questionValue) {
  const options = Array.isArray(questionValue?.options)
    ? questionValue.options.map((optionValue) => normalizeTextInput(optionValue))
    : [];

  return {
    id: normalizeTextInput(questionValue?.id),
    difficulty: normalizeDifficulty(questionValue?.difficulty),
    question: normalizeTextInput(questionValue?.question),
    options,
    answer: questionValue?.answer,
  };
}

function buildValidatedQuestionResult(questions) {
  return {
    questions,
    order: questions.map((question) => question.id),
    questionMap: buildQuestionMap(questions),
    counts: buildCounts(questions),
  };
}

export function validateTriviaQuestions(questionValues) {
  if (!Array.isArray(questionValues)) {
    return {
      ...buildValidatedQuestionResult([]),
      errors: ["Trivia Question Pool input must be a JSON array of question objects."],
      isValid: false,
      isEmpty: true,
    };
  }

  const errors = [];
  const normalizedQuestions = [];
  const seenIds = new Set();

  questionValues.forEach((questionValue, questionIndex) => {
    const normalizedQuestion = normalizeQuestion(questionValue);
    const questionId = normalizedQuestion.id;
    const rawOptions = questionValue?.options;
    const answerValue = questionValue?.answer;
    const duplicateOptionKeys = new Set();

    if (!questionId) {
      errors.push(createQuestionError(questionIndex, "", "id is required."));
    } else {
      if (FIREBASE_KEY_UNSAFE_PATTERN.test(questionId)) {
        errors.push(createQuestionError(questionIndex, questionId, 'id must not contain . # $ [ ] or /.'));
      }

      if (seenIds.has(questionId)) {
        errors.push(createQuestionError(questionIndex, questionId, "id must be unique within the pool."));
      } else {
        seenIds.add(questionId);
      }
    }

    if (!TRIVIA_DIFFICULTIES.includes(normalizedQuestion.difficulty)) {
      errors.push(createQuestionError(questionIndex, questionId, "difficulty must be easy, medium, or hard."));
    }

    if (!normalizedQuestion.question) {
      errors.push(createQuestionError(questionIndex, questionId, "question is required."));
    }

    if (!Array.isArray(rawOptions)) {
      errors.push(createQuestionError(questionIndex, questionId, "options must be an array."));
    } else {
      if (normalizedQuestion.options.length < 2 || normalizedQuestion.options.length > 6) {
        errors.push(createQuestionError(questionIndex, questionId, "options must contain between 2 and 6 entries."));
      }

      normalizedQuestion.options.forEach((optionValue, optionIndex) => {
        if (!optionValue) {
          errors.push(createQuestionError(questionIndex, questionId, `option ${optionIndex + 1} must be a non-empty string.`));
          return;
        }

        const duplicateKey = optionValue.toLowerCase();

        if (duplicateOptionKeys.has(duplicateKey)) {
          errors.push(createQuestionError(questionIndex, questionId, `options contain a duplicate value "${optionValue}".`));
          return;
        }

        duplicateOptionKeys.add(duplicateKey);
      });
    }

    if (!Number.isInteger(answerValue)) {
      errors.push(createQuestionError(questionIndex, questionId, "answer must be an integer zero-based option index."));
    } else if (answerValue < 0) {
      errors.push(createQuestionError(questionIndex, questionId, "answer must be greater than or equal to 0."));
    } else if (Array.isArray(rawOptions) && answerValue >= normalizedQuestion.options.length) {
      errors.push(createQuestionError(questionIndex, questionId, `answer index ${answerValue} is outside the options array.`));
    }

    normalizedQuestions.push({
      id: normalizedQuestion.id,
      difficulty: normalizedQuestion.difficulty,
      question: normalizedQuestion.question,
      options: normalizedQuestion.options,
      answer: answerValue,
    });
  });

  if (errors.length > 0) {
    return {
      ...buildValidatedQuestionResult([]),
      errors,
      isValid: false,
      isEmpty: questionValues.length === 0,
    };
  }

  return {
    ...buildValidatedQuestionResult(normalizedQuestions),
    errors: [],
    isValid: true,
    isEmpty: normalizedQuestions.length === 0,
  };
}

export function parseTriviaQuestionPoolJson(sourceText) {
  const normalizedSourceText = String(sourceText ?? "").replace(/\r\n?/g, "\n");

  if (!normalizeTextInput(normalizedSourceText)) {
    return {
      sourceText: normalizedSourceText,
      ...buildValidatedQuestionResult([]),
      errors: ["Paste a JSON array of trivia questions before validating or replacing the pool."],
      isValid: false,
      isEmpty: true,
    };
  }

  let parsedValue;

  try {
    parsedValue = JSON.parse(normalizedSourceText);
  } catch (error) {
    return {
      sourceText: normalizedSourceText,
      ...buildValidatedQuestionResult([]),
      errors: [`Trivia Question Pool JSON is invalid: ${error.message}.`],
      isValid: false,
      isEmpty: true,
    };
  }

  const validationResult = validateTriviaQuestions(parsedValue);

  return {
    sourceText: normalizedSourceText,
    ...validationResult,
  };
}

export function buildTriviaQuestionPoolPayload({ questions = [], updatedAt = "" } = {}) {
  const validationResult = validateTriviaQuestions(questions);

  if (!validationResult.isValid) {
    throw new Error(validationResult.errors[0] || "Trivia Question Pool payload is invalid.");
  }

  return {
    schemaVersion: TRIVIA_QUESTION_POOL_SCHEMA_VERSION,
    questions: validationResult.questionMap,
    order: validationResult.order,
    counts: validationResult.counts,
    updatedAt: normalizeTextInput(updatedAt),
  };
}

export function normalizeTriviaQuestionPool(questionPoolValue) {
  const updatedAt = normalizeTextInput(questionPoolValue?.updatedAt);

  if (!questionPoolValue || typeof questionPoolValue !== "object") {
    return {
      ...createEmptyQuestionPool(updatedAt),
      orderedQuestions: [],
      errors: [],
      isValid: true,
    };
  }

  const questionMap = questionPoolValue.questions && typeof questionPoolValue.questions === "object"
    ? questionPoolValue.questions
    : {};
  const order = Array.isArray(questionPoolValue.order)
    ? questionPoolValue.order.map((questionId) => normalizeTextInput(questionId))
    : [];

  if (order.length === 0 && Object.keys(questionMap).length === 0) {
    return {
      ...createEmptyQuestionPool(updatedAt),
      orderedQuestions: [],
      errors: [],
      isValid: true,
    };
  }

  const structureErrors = [];
  const orderedQuestions = [];
  const seenOrderIds = new Set();

  order.forEach((questionId, orderIndex) => {
    if (!questionId) {
      structureErrors.push(`Saved question order entry ${orderIndex + 1} is missing an id.`);
      return;
    }

    if (seenOrderIds.has(questionId)) {
      structureErrors.push(`Saved question order contains duplicate id "${questionId}".`);
      return;
    }

    const storedQuestion = questionMap[questionId];

    if (!storedQuestion || typeof storedQuestion !== "object") {
      structureErrors.push(`Saved question "${questionId}" is missing from the question map.`);
      return;
    }

    seenOrderIds.add(questionId);
    orderedQuestions.push(storedQuestion);
  });

  Object.keys(questionMap).forEach((questionId) => {
    if (!seenOrderIds.has(questionId)) {
      structureErrors.push(`Saved question "${questionId}" is missing from the order array.`);
    }
  });

  if (structureErrors.length > 0) {
    return {
      ...createEmptyQuestionPool(updatedAt),
      orderedQuestions: [],
      errors: structureErrors,
      isValid: false,
    };
  }

  const validationResult = validateTriviaQuestions(orderedQuestions);

  if (!validationResult.isValid) {
    return {
      ...createEmptyQuestionPool(updatedAt),
      orderedQuestions: [],
      errors: validationResult.errors,
      isValid: false,
    };
  }

  return {
    schemaVersion: TRIVIA_QUESTION_POOL_SCHEMA_VERSION,
    questions: validationResult.questionMap,
    order: validationResult.order,
    counts: validationResult.counts,
    updatedAt,
    orderedQuestions: validationResult.questions,
    errors: [],
    isValid: true,
  };
}

export function reconstructTriviaQuestionPoolJson(questionPoolValue) {
  const normalizedPool = normalizeTriviaQuestionPool(questionPoolValue);

  if (!normalizedPool.isValid) {
    return "[]";
  }

  return JSON.stringify(normalizedPool.orderedQuestions, null, 2);
}

export function filterQuestionsByDifficulty(questionSource, difficulty = "all") {
  const normalizedDifficulty = normalizeDifficulty(difficulty);
  const questions = Array.isArray(questionSource)
    ? questionSource.slice()
    : normalizeTriviaQuestionPool(questionSource).orderedQuestions.slice();

  if (!normalizedDifficulty || normalizedDifficulty === "all") {
    return questions;
  }

  if (!TRIVIA_DIFFICULTIES.includes(normalizedDifficulty)) {
    return [];
  }

  return questions.filter((question) => question.difficulty === normalizedDifficulty);
}

export function getRandomQuestion(questionSource, difficulty = "all") {
  const questions = filterQuestionsByDifficulty(questionSource, difficulty);

  if (questions.length === 0) {
    return null;
  }

  const randomIndex = Math.floor(Math.random() * questions.length);
  return questions[randomIndex];
}

export function hasTriviaQuestions(questionSource) {
  if (Array.isArray(questionSource)) {
    return questionSource.length > 0;
  }

  const normalizedPool = normalizeTriviaQuestionPool(questionSource);
  return normalizedPool.isValid && normalizedPool.order.length > 0;
}

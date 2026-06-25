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
  BINGO_CARD_ITEM_COUNT,
  BINGO_RECOMMENDED_MINIMUM_POOL_SIZE,
  BINGO_SOURCE_POOL_PATH,
  buildBingoSourcePoolPayload,
  normalizeBingoSourcePool,
  parseBingoSourcePoolText,
  reconstructBingoSourcePoolText,
} from "./bingo-pool.js";
import {
  buildTriviaQuestionPoolPayload,
  normalizeTriviaQuestionPool,
  parseTriviaQuestionPoolJson,
  reconstructTriviaQuestionPoolJson,
  TRIVIA_QUESTION_POOL_PATH,
  TRIVIA_QUESTION_POOL_SAFE_EXAMPLE_JSON,
} from "./trivia-pool.js";
import {
  REVIEW_LINK_DEFINITIONS,
  STATIC_PAGE_DEFINITIONS,
  normalizeMultilineText,
  normalizeReviewLinks,
  normalizeStaticPages,
} from "./static-pages.js";
import { createDisplayControlsManager } from "./display-controls.js";
import {
  downloadBingoWinnersCsv,
  downloadCheckedInPlayersCsv,
  getExportCapabilities,
} from "./export.js";

const ADMIN_ROOT_SELECTOR = "#admin-app";

let activeAdminRoot = null;
let activeAdminClickHandler = null;
let activeAdminInputHandler = null;
let activeAdminChangeHandler = null;
let activeAdminSubmitHandler = null;
let activeAdminDisplayControls = null;
let hasBoundAdminBeforeUnload = false;

const ADMIN_RESERVED_CARDS = [
  {
    title: "Event Settings",
    description: "Future event-level settings and scheduling controls will live here.",
  },
  {
    title: "Player Management",
    description: "Future player lookup and record maintenance tools will stay in the Admin area.",
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

function renderTriviaQuestionValidationErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) {
    return "";
  }

  const errorItemsMarkup = errors
    .map((error) => `<li>${escapeHtml(error)}</li>`)
    .join("");

  return `
    <div class="notice-panel validation-panel" data-tone="error" aria-live="polite">
      <p class="validation-title">Fix these Trivia Question Pool issues before replacing:</p>
      <ul class="validation-list">
        ${errorItemsMarkup}
      </ul>
    </div>
  `;
}

function renderBingoSourcePoolValidationErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) {
    return "";
  }

  const errorItemsMarkup = errors
    .map((error) => `<li>Line ${escapeHtml(error.lineNumber)}: ${escapeHtml(error.message)}</li>`)
    .join("");

  return `
    <div class="notice-panel validation-panel" data-tone="error" aria-live="polite">
      <p class="validation-title">Fix these Bingo pool lines before replacing:</p>
      <ul class="validation-list">
        ${errorItemsMarkup}
      </ul>
    </div>
  `;
}

function renderAdminImportFeedback(message, issues = []) {
  const noticeMarkup = message?.text
    ? `
      <div class="notice-panel admin-import-notice" data-tone="${escapeHtml(message.tone || "info")}" aria-live="polite">
        ${escapeHtml(message.text)}
      </div>
    `
    : "";

  if (!Array.isArray(issues) || issues.length === 0) {
    return noticeMarkup ? `<div class="admin-import-feedback">${noticeMarkup}</div>` : "";
  }

  const issueTone = issues.some((issue) => issue.tone === "error") ? "error" : "warning";
  const issueTitle = issueTone === "error"
    ? "Fix these CSV import issues before trying again:"
    : "CSV import warnings:";
  const issueItemsMarkup = issues
    .map((issue) => {
      const rowPrefix = Number.isInteger(issue.rowNumber) ? `Row ${issue.rowNumber}: ` : "";
      return `<li>${escapeHtml(`${rowPrefix}${issue.message}`)}</li>`;
    })
    .join("");

  return `
    <div class="admin-import-feedback">
      ${noticeMarkup}
      <div class="notice-panel validation-panel admin-import-issues" data-tone="${escapeHtml(issueTone)}" aria-live="polite">
        <p class="validation-title">${issueTitle}</p>
        <ul class="validation-list">
          ${issueItemsMarkup}
        </ul>
      </div>
    </div>
  `;
}

function createImportIssue(message, tone = "error", rowNumber = null) {
  return {
    message: normalizeTextInput(message) || "Unknown CSV import issue.",
    tone: tone === "warning" ? "warning" : "error",
    rowNumber: Number.isInteger(rowNumber) ? rowNumber : null,
  };
}

function normalizeCsvHeaderKey(value) {
  return normalizeTextInput(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function trimTrailingEmptyCsvFields(values) {
  const normalizedValues = Array.isArray(values) ? values.slice() : [];

  while (normalizedValues.length > 1 && !normalizeTextInput(normalizedValues[normalizedValues.length - 1])) {
    normalizedValues.pop();
  }

  return normalizedValues;
}

function isCsvRowBlank(values) {
  return values.every((value) => !normalizeTextInput(value));
}

function formatImportCount(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function parseCsvText(sourceText) {
  const text = String(sourceText ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let currentRow = [];
  let currentField = "";
  let inQuotes = false;
  let currentRecordLineNumber = 1;
  let physicalLineNumber = 1;
  let lastCharWasRowDelimiter = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    lastCharWasRowDelimiter = false;

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          currentField += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
        continue;
      }

      if (character === "\r") {
        if (text[index + 1] === "\n") {
          index += 1;
        }
        currentField += "\n";
        physicalLineNumber += 1;
        continue;
      }

      if (character === "\n") {
        currentField += "\n";
        physicalLineNumber += 1;
        continue;
      }

      currentField += character;
      continue;
    }

    if (character === '"') {
      if (!currentField) {
        inQuotes = true;
      } else {
        currentField += character;
      }
      continue;
    }

    if (character === ",") {
      currentRow.push(currentField);
      currentField = "";
      continue;
    }

    if (character === "\r" || character === "\n") {
      if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
      }

      currentRow.push(currentField);
      rows.push({
        rowNumber: currentRecordLineNumber,
        values: trimTrailingEmptyCsvFields(currentRow),
      });
      currentRow = [];
      currentField = "";
      physicalLineNumber += 1;
      currentRecordLineNumber = physicalLineNumber;
      lastCharWasRowDelimiter = true;
      continue;
    }

    currentField += character;
  }

  if (inQuotes) {
    return {
      rows: [],
      issues: [createImportIssue("CSV contains an unclosed quoted field.")],
    };
  }

  if (!lastCharWasRowDelimiter || currentRow.length > 0 || currentField !== "") {
    currentRow.push(currentField);
    rows.push({
      rowNumber: currentRecordLineNumber,
      values: trimTrailingEmptyCsvFields(currentRow),
    });
  }

  return {
    rows,
    issues: [],
  };
}

function buildCsvTable(sourceText) {
  const parseResult = parseCsvText(sourceText);

  if (parseResult.issues.length > 0) {
    return {
      isValid: false,
      headers: [],
      dataRows: [],
      issues: parseResult.issues,
    };
  }

  const headerRowIndex = parseResult.rows.findIndex((row) => !isCsvRowBlank(row.values));

  if (headerRowIndex < 0) {
    return {
      isValid: false,
      headers: [],
      dataRows: [],
      issues: [createImportIssue("CSV is empty or missing a header row.")],
    };
  }

  const headerRow = parseResult.rows[headerRowIndex];
  const headers = headerRow.values.map((value) => normalizeTextInput(value));
  const dataRows = parseResult.rows
    .slice(headerRowIndex + 1)
    .map((row) => ({
      rowNumber: row.rowNumber,
      values: trimTrailingEmptyCsvFields(row.values),
    }))
    .filter((row) => !isCsvRowBlank(row.values));

  return {
    isValid: true,
    headers,
    dataRows,
    issues: [],
  };
}

function buildCsvHeaderIndex(headers) {
  return headers.reduce((headerIndex, headerValue, index) => {
    const normalizedKey = normalizeCsvHeaderKey(headerValue);

    if (normalizedKey && !headerIndex.has(normalizedKey)) {
      headerIndex.set(normalizedKey, index);
    }

    return headerIndex;
  }, new Map());
}

function getCsvHeaderPosition(headerIndex, aliases) {
  for (const alias of aliases) {
    const normalizedAlias = normalizeCsvHeaderKey(alias);

    if (headerIndex.has(normalizedAlias)) {
      return headerIndex.get(normalizedAlias);
    }
  }

  return -1;
}

function getCsvCellValue(row, columnIndex) {
  if (columnIndex < 0) {
    return "";
  }

  return normalizeTextInput(row.values[columnIndex] ?? "");
}

function resolveTriviaAnswerIndex(value, options) {
  const normalizedValue = normalizeTextInput(value);

  if (!normalizedValue) {
    return null;
  }

  const letterMatch = normalizedValue.match(/^(?:option\s*)?([a-d])$/i);

  if (letterMatch) {
    return letterMatch[1].toUpperCase().charCodeAt(0) - 65;
  }

  const numberMatch = normalizedValue.match(/^(?:option\s*)?([1-4])$/i);

  if (numberMatch) {
    return Number(numberMatch[1]) - 1;
  }

  const normalizedOptionText = normalizedValue.toLowerCase();
  const optionIndex = options.findIndex((optionValue) => optionValue.toLowerCase() === normalizedOptionText);

  return optionIndex >= 0 ? optionIndex : null;
}

function convertTriviaCsvToDraft(sourceText) {
  const tableResult = buildCsvTable(sourceText);

  if (!tableResult.isValid) {
    return {
      isValid: false,
      draft: "",
      count: 0,
      issues: tableResult.issues,
      message: `Trivia CSV has ${formatImportCount(tableResult.issues.length, "error")}. Fix the file and try again.`,
      tone: "error",
    };
  }

  const headerIndex = buildCsvHeaderIndex(tableResult.headers);
  const idColumnIndex = getCsvHeaderPosition(headerIndex, ["id"]);
  const difficultyColumnIndex = getCsvHeaderPosition(headerIndex, ["difficulty"]);
  const questionColumnIndex = getCsvHeaderPosition(headerIndex, ["question"]);
  const optionAColumnIndex = getCsvHeaderPosition(headerIndex, ["optionA"]);
  const optionBColumnIndex = getCsvHeaderPosition(headerIndex, ["optionB"]);
  const optionCColumnIndex = getCsvHeaderPosition(headerIndex, ["optionC"]);
  const optionDColumnIndex = getCsvHeaderPosition(headerIndex, ["optionD"]);
  const correctOptionColumnIndex = getCsvHeaderPosition(headerIndex, ["correctOption"]);
  const answerColumnIndex = getCsvHeaderPosition(headerIndex, ["answer"]);
  const missingHeaders = [
    idColumnIndex < 0 ? "id" : "",
    difficultyColumnIndex < 0 ? "difficulty" : "",
    questionColumnIndex < 0 ? "question" : "",
    optionAColumnIndex < 0 ? "optionA" : "",
    optionBColumnIndex < 0 ? "optionB" : "",
    optionCColumnIndex < 0 ? "optionC" : "",
    optionDColumnIndex < 0 ? "optionD" : "",
  ].filter(Boolean);

  if (correctOptionColumnIndex < 0 && answerColumnIndex < 0) {
    missingHeaders.push("correctOption or answer");
  }

  if (missingHeaders.length > 0) {
    const issues = missingHeaders.map((headerLabel) => createImportIssue(`Missing required CSV header: ${headerLabel}.`));

    return {
      isValid: false,
      draft: "",
      count: 0,
      issues,
      message: `Trivia CSV has ${formatImportCount(issues.length, "error")}. Fix the file and try again.`,
      tone: "error",
    };
  }

  if (tableResult.dataRows.length === 0) {
    return {
      isValid: false,
      draft: "",
      count: 0,
      issues: [createImportIssue("Trivia CSV does not contain any question rows.")],
      message: "Trivia CSV has 1 error. Fix the file and try again.",
      tone: "error",
    };
  }

  const questions = [];
  const issues = [];
  const seenIds = new Set();

  tableResult.dataRows.forEach((row) => {
    const questionId = getCsvCellValue(row, idColumnIndex);
    const difficulty = getCsvCellValue(row, difficultyColumnIndex).toLowerCase();
    const questionText = getCsvCellValue(row, questionColumnIndex);
    const options = [
      getCsvCellValue(row, optionAColumnIndex),
      getCsvCellValue(row, optionBColumnIndex),
      getCsvCellValue(row, optionCColumnIndex),
      getCsvCellValue(row, optionDColumnIndex),
    ];
    const correctOptionValue = getCsvCellValue(row, correctOptionColumnIndex);
    const answerValue = getCsvCellValue(row, answerColumnIndex);

    if (!questionId) {
      issues.push(createImportIssue("id is required.", "error", row.rowNumber));
    } else if (seenIds.has(questionId)) {
      issues.push(createImportIssue(`id "${questionId}" is duplicated in this CSV.`, "error", row.rowNumber));
    } else {
      seenIds.add(questionId);
    }

    if (!difficulty || !["easy", "medium", "hard"].includes(difficulty)) {
      issues.push(createImportIssue("difficulty must be easy, medium, or hard.", "error", row.rowNumber));
    }

    if (!questionText) {
      issues.push(createImportIssue("question is required.", "error", row.rowNumber));
    }

    options.forEach((optionValue, optionIndex) => {
      if (!optionValue) {
        issues.push(createImportIssue(`option${String.fromCharCode(65 + optionIndex)} is required.`, "error", row.rowNumber));
      }
    });

    const resolvedCorrectOptionIndex = resolveTriviaAnswerIndex(correctOptionValue, options);
    const resolvedAnswerIndex = resolveTriviaAnswerIndex(answerValue, options);
    let resolvedIndex = resolvedCorrectOptionIndex;

    if (resolvedIndex === null) {
      resolvedIndex = resolvedAnswerIndex;
    }

    if (resolvedIndex === null) {
      issues.push(createImportIssue("A valid correct answer is required.", "error", row.rowNumber));
      return;
    }

    if (
      resolvedCorrectOptionIndex !== null
      && resolvedAnswerIndex !== null
      && resolvedCorrectOptionIndex !== resolvedAnswerIndex
    ) {
      issues.push(createImportIssue("correctOption and answer disagree. correctOption was used.", "warning", row.rowNumber));
    }

    questions.push({
      id: questionId,
      difficulty,
      question: questionText,
      options,
      answer: resolvedIndex,
    });
  });

  const blockingIssues = issues.filter((issue) => issue.tone === "error");

  if (blockingIssues.length > 0) {
    return {
      isValid: false,
      draft: "",
      count: 0,
      issues,
      message: `Trivia CSV has ${formatImportCount(blockingIssues.length, "error")}. Fix the file and try again.`,
      tone: "error",
    };
  }

  const draft = JSON.stringify(questions, null, 2);
  const dryRunResult = parseTriviaQuestionPoolJson(draft);

  if (!dryRunResult.isValid) {
    const schemaIssues = dryRunResult.errors.map((errorMessage) => createImportIssue(errorMessage));

    return {
      isValid: false,
      draft: "",
      count: 0,
      issues: schemaIssues,
      message: `Trivia CSV has ${formatImportCount(schemaIssues.length, "error")}. Fix the file and try again.`,
      tone: "error",
    };
  }

  const warningCount = issues.length;
  const tone = warningCount > 0 ? "warning" : "success";
  const message = warningCount > 0
    ? `Loaded ${formatImportCount(questions.length, "Trivia question")} from CSV with ${formatImportCount(warningCount, "warning")}. Review before saving.`
    : `Loaded ${formatImportCount(questions.length, "Trivia question")} from CSV. Review before saving.`;

  return {
    isValid: true,
    draft,
    count: questions.length,
    issues,
    message,
    tone,
  };
}

function convertBingoCsvToDraft(sourceText) {
  const tableResult = buildCsvTable(sourceText);

  if (!tableResult.isValid) {
    return {
      isValid: false,
      draft: "",
      count: 0,
      issues: tableResult.issues,
      message: "Bingo CSV could not be imported. Fix the file and try again.",
      tone: "error",
    };
  }

  const headerIndex = buildCsvHeaderIndex(tableResult.headers);
  let bottleNameColumnIndex = getCsvHeaderPosition(headerIndex, ["bottleName"]);

  if (bottleNameColumnIndex < 0 && tableResult.headers.length === 1) {
    bottleNameColumnIndex = 0;
  }

  if (bottleNameColumnIndex < 0) {
    return {
      isValid: false,
      draft: "",
      count: 0,
      issues: [createImportIssue('Bingo CSV must include a "bottleName" header or use exactly one column.')],
      message: "Bingo CSV could not be imported. Fix the file and try again.",
      tone: "error",
    };
  }

  const bottleNames = tableResult.dataRows
    .map((row) => getCsvCellValue(row, bottleNameColumnIndex))
    .filter(Boolean);

  if (bottleNames.length === 0) {
    return {
      isValid: false,
      draft: "",
      count: 0,
      issues: [createImportIssue("Bingo CSV does not contain any bottle rows.")],
      message: "Bingo CSV could not be imported. Fix the file and try again.",
      tone: "error",
    };
  }

  return {
    isValid: true,
    draft: bottleNames.join("\n"),
    count: bottleNames.length,
    issues: [],
    message: `Loaded ${formatImportCount(bottleNames.length, "Bingo bottle")} from CSV. Review before saving.`,
    tone: "success",
  };
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

function renderTriviaCountGrid(countsNode, counts) {
  if (!countsNode) {
    return;
  }

  countsNode.innerHTML = "";

  [
    { label: "Easy", value: counts.easy },
    { label: "Medium", value: counts.medium },
    { label: "Hard", value: counts.hard },
    { label: "Total", value: counts.total },
  ].forEach((countDefinition) => {
    const countNode = document.createElement("article");
    const valueNode = document.createElement("strong");
    const labelNode = document.createElement("span");

    countNode.className = "trivia-count-card";
    valueNode.textContent = String(countDefinition.value);
    labelNode.textContent = countDefinition.label;
    countNode.append(valueNode, labelNode);
    countsNode.append(countNode);
  });
}

function createTriviaMetaRow(label, value) {
  const rowNode = document.createElement("p");
  const labelNode = document.createElement("strong");

  rowNode.className = "trivia-question-meta";
  labelNode.textContent = `${label}: `;
  rowNode.append(labelNode, document.createTextNode(value));
  return rowNode;
}

function createTriviaOptionsList(question) {
  const optionsListNode = document.createElement("ol");

  optionsListNode.className = "trivia-options-list";
  question.options.forEach((optionValue, optionIndex) => {
    const optionNode = document.createElement("li");

    optionNode.textContent = `${optionIndex}. ${optionValue}`;
    optionsListNode.append(optionNode);
  });

  return optionsListNode;
}

function createTriviaPreviewCard(question, questionIndex) {
  const cardNode = document.createElement("article");
  const headerNode = document.createElement("div");
  const titleNode = document.createElement("h4");
  const difficultyBadgeNode = document.createElement("span");
  const questionCopyNode = document.createElement("p");
  const answerIndexNode = document.createElement("p");
  const answerTextNode = document.createElement("p");

  cardNode.className = "hub-panel trivia-question-card";
  headerNode.className = "trivia-question-header";
  titleNode.textContent = `Question ${questionIndex + 1}`;
  difficultyBadgeNode.className = "trivia-difficulty-badge";
  difficultyBadgeNode.dataset.difficulty = question.difficulty;
  difficultyBadgeNode.textContent = question.difficulty;
  questionCopyNode.className = "trivia-question-copy";
  questionCopyNode.textContent = question.question;
  answerIndexNode.className = "trivia-answer-note";
  answerIndexNode.textContent = `Correct answer index: ${question.answer}`;
  answerTextNode.className = "trivia-answer-note";
  answerTextNode.textContent = `Correct answer text: ${question.options[question.answer]}`;

  headerNode.append(titleNode, difficultyBadgeNode);
  cardNode.append(
    headerNode,
    createTriviaMetaRow("ID", question.id),
    createTriviaMetaRow("Difficulty", question.difficulty),
    questionCopyNode,
    createTriviaOptionsList(question),
    answerIndexNode,
    answerTextNode
  );

  return cardNode;
}

function renderTriviaQuestionPoolPreview(previewNode, previewResult) {
  if (!previewNode) {
    return;
  }

  previewNode.innerHTML = "";

  if (!previewResult) {
    return;
  }

  const previewSectionNode = document.createElement("section");
  const previewHeaderNode = document.createElement("div");
  const eyebrowNode = document.createElement("p");
  const titleNode = document.createElement("h4");
  const copyNode = document.createElement("p");
  const countGridNode = document.createElement("div");
  const cardsNode = document.createElement("div");

  previewSectionNode.className = "trivia-preview";
  previewHeaderNode.className = "trivia-preview-header";
  eyebrowNode.className = "eyebrow";
  eyebrowNode.textContent = "Preview";
  titleNode.textContent = "Trivia Question Pool Preview";
  copyNode.className = "player-copy";
  countGridNode.className = "trivia-count-grid";
  cardsNode.className = "trivia-question-list";

  renderTriviaCountGrid(countGridNode, previewResult.counts);

  if (previewResult.isEmpty) {
    const emptyPanelNode = document.createElement("div");
    const emptyCopyNode = document.createElement("p");

    copyNode.textContent = "This preview is empty.";
    emptyPanelNode.className = "hub-panel trivia-empty-panel";
    emptyCopyNode.textContent = "Replace will refuse empty arrays. Use Clear Question Pool if you intentionally want an empty saved pool.";
    emptyPanelNode.append(emptyCopyNode);
    cardsNode.append(emptyPanelNode);
  } else {
    const questionLabel = previewResult.questions.length === 1 ? "question" : "questions";

    copyNode.textContent = `Showing ${previewResult.questions.length} ${questionLabel} in saved order.`;
    previewResult.questions.forEach((question, questionIndex) => {
      cardsNode.append(createTriviaPreviewCard(question, questionIndex));
    });
  }

  previewHeaderNode.append(eyebrowNode, titleNode, copyNode);
  previewSectionNode.append(previewHeaderNode, countGridNode, cardsNode);
  previewNode.append(previewSectionNode);
}

function renderBingoSourcePoolCountGrid(countsNode, sourcePoolValue) {
  if (!countsNode) {
    return;
  }

  countsNode.innerHTML = "";

  [
    { label: "Unique Items", value: sourcePoolValue?.count || 0 },
    { label: `Min ${BINGO_CARD_ITEM_COUNT}`, value: sourcePoolValue?.count >= BINGO_CARD_ITEM_COUNT ? "Yes" : "No" },
    { label: "45+ Ready", value: sourcePoolValue?.count >= BINGO_RECOMMENDED_MINIMUM_POOL_SIZE ? "Yes" : "No" },
  ].forEach((countDefinition) => {
    const countNode = document.createElement("article");
    const valueNode = document.createElement("strong");
    const labelNode = document.createElement("span");

    countNode.className = "trivia-count-card";
    valueNode.textContent = String(countDefinition.value);
    labelNode.textContent = countDefinition.label;
    countNode.append(valueNode, labelNode);
    countsNode.append(countNode);
  });
}

function renderBingoSourcePoolPreview(previewNode, previewResult) {
  if (!previewNode) {
    return;
  }

  previewNode.innerHTML = "";

  if (!previewResult) {
    return;
  }

  const previewSectionNode = document.createElement("section");
  const previewHeaderNode = document.createElement("div");
  const eyebrowNode = document.createElement("p");
  const titleNode = document.createElement("h4");
  const copyNode = document.createElement("p");
  const listNode = document.createElement("ol");

  previewSectionNode.className = "bingo-pool-preview";
  previewHeaderNode.className = "trivia-preview-header";
  eyebrowNode.className = "eyebrow";
  eyebrowNode.textContent = "Preview";
  titleNode.textContent = "Bingo Bottle Pool Preview";
  copyNode.className = "player-copy";
  listNode.className = "bingo-source-item-list";
  previewHeaderNode.append(eyebrowNode, titleNode, copyNode);
  previewSectionNode.append(previewHeaderNode);

  if (previewResult.isEmpty) {
    const emptyPanelNode = document.createElement("div");
    const emptyCopyNode = document.createElement("p");

    copyNode.textContent = "This preview is empty.";
    emptyPanelNode.className = "hub-panel bottle-list-empty-panel";
    emptyCopyNode.textContent = "Blank or empty input will not overwrite the saved Bingo pool. Use Clear Bingo Pool if you intentionally want an empty pool.";
    emptyPanelNode.append(emptyCopyNode);
    previewSectionNode.append(emptyPanelNode);
    previewNode.append(previewSectionNode);
    return;
  }

  copyNode.textContent = `Showing ${previewResult.count} unique items in saved order.`;

  previewResult.items.forEach((itemValue) => {
    const itemNode = document.createElement("li");

    itemNode.textContent = itemValue.name;
    listNode.append(itemNode);
  });

  previewSectionNode.append(listNode);
  previewNode.append(previewSectionNode);
}

function cleanupAdminPageRuntime() {
  if (activeAdminDisplayControls) {
    activeAdminDisplayControls.cleanup();
  }
}

function handleAdminBeforeUnload() {
  cleanupAdminPageRuntime();
}

export function initAdminPage({ firebase, state, renderStatus }) {
  const adminRoot = document.querySelector(ADMIN_ROOT_SELECTOR);

  cleanupAdminPageRuntime();

  activeAdminDisplayControls = createDisplayControlsManager({
    firebase,
    state,
    role: "admin",
  });
  const adminUiState = {
    activePageKey: STATIC_PAGE_DEFINITIONS[0].key,
    isLoading: true,
    isSavingPage: false,
    isSavingReviewLinks: false,
    isSavingBingoSourcePool: false,
    isClearingBingoSourcePool: false,
    isSavingBottleList: false,
    isClearingBottleList: false,
    isSavingQuestionPool: false,
    isClearingQuestionPool: false,
    pages: normalizeStaticPages(null),
    reviewLinks: normalizeReviewLinks(null),
    bingoSourcePool: normalizeBingoSourcePool(null),
    bottleList: normalizeBottleList(null),
    questionPool: normalizeTriviaQuestionPool(null),
    bingoSourcePoolDraft: "",
    bottleListDraft: "",
    questionPoolDraft: TRIVIA_QUESTION_POOL_SAFE_EXAMPLE_JSON,
    bingoSourcePoolPreview: null,
    bottleListPreview: null,
    questionPoolPreview: null,
    bingoSourcePoolValidationErrors: [],
    bottleListValidationErrors: [],
    questionPoolValidationErrors: [],
    bingoSourcePoolImportIssues: [],
    questionPoolImportIssues: [],
    pageMessage: {
      text: "",
      tone: "info",
    },
    reviewMessage: {
      text: "",
      tone: "info",
    },
    bingoSourcePoolMessage: {
      text: "",
      tone: "info",
    },
    bottleListMessage: {
      text: "",
      tone: "info",
    },
    questionPoolMessage: {
      text: "",
      tone: "info",
    },
    bingoSourcePoolImportMessage: {
      text: "",
      tone: "info",
    },
    questionPoolImportMessage: {
      text: "",
      tone: "info",
    },
    exportMessage: {
      text: "",
      tone: "info",
    },
    isExportingPlayers: false,
    isExportingBingoWinners: false,
  };

  if (!hasBoundAdminBeforeUnload) {
    window.addEventListener("beforeunload", handleAdminBeforeUnload);
    hasBoundAdminBeforeUnload = true;
  }

  function setPageMessage(text = "", tone = "info") {
    adminUiState.pageMessage = { text, tone };
  }

  function setReviewMessage(text = "", tone = "info") {
    adminUiState.reviewMessage = { text, tone };
  }

  function setBingoSourcePoolMessage(text = "", tone = "info") {
    adminUiState.bingoSourcePoolMessage = { text, tone };
  }

  function setBottleListMessage(text = "", tone = "info") {
    adminUiState.bottleListMessage = { text, tone };
  }

  function setQuestionPoolMessage(text = "", tone = "info") {
    adminUiState.questionPoolMessage = { text, tone };
  }

  function setBingoSourcePoolImportMessage(text = "", tone = "info") {
    adminUiState.bingoSourcePoolImportMessage = { text, tone };
  }

  function clearBingoSourcePoolImportFeedback() {
    adminUiState.bingoSourcePoolImportIssues = [];
    setBingoSourcePoolImportMessage();
  }

  function setQuestionPoolImportMessage(text = "", tone = "info") {
    adminUiState.questionPoolImportMessage = { text, tone };
  }

  function clearQuestionPoolImportFeedback() {
    adminUiState.questionPoolImportIssues = [];
    setQuestionPoolImportMessage();
  }

  function setExportMessage(text = "", tone = "info") {
    adminUiState.exportMessage = { text, tone };
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

  function getEditableBingoSourcePoolSource(sourcePoolValue, rawSourcePoolValue) {
    if (normalizeTextInput(sourcePoolValue.sourceText)) {
      return {
        draft: sourcePoolValue.sourceText,
        source: sourcePoolValue.isValid ? "saved" : "invalid",
      };
    }

    if (sourcePoolValue.items.length > 0) {
      return {
        draft: reconstructBingoSourcePoolText(sourcePoolValue),
        source: sourcePoolValue.isValid ? "reconstructed" : "invalid_reconstructed",
      };
    }

    return {
      draft: "",
      source: rawSourcePoolValue === null ? "missing" : "empty",
    };
  }

  function getEditableTriviaQuestionPoolSource(questionPoolValue, rawQuestionPoolValue) {
    if (rawQuestionPoolValue === null) {
      return {
        draft: TRIVIA_QUESTION_POOL_SAFE_EXAMPLE_JSON,
        source: "example",
      };
    }

    if (!questionPoolValue.isValid) {
      return {
        draft: TRIVIA_QUESTION_POOL_SAFE_EXAMPLE_JSON,
        source: "invalid",
      };
    }

    return {
      draft: reconstructTriviaQuestionPoolJson(questionPoolValue),
      source: questionPoolValue.order.length === 0 ? "empty" : "saved",
    };
  }

  function readBottleListDraft(formNode) {
    const formData = new FormData(formNode);

    adminUiState.bottleListDraft = String(formData.get("sourceText") ?? "");
    return adminUiState.bottleListDraft;
  }

  function readBingoSourcePoolDraft(formNode) {
    const formData = new FormData(formNode);

    adminUiState.bingoSourcePoolDraft = String(formData.get("bingoSourceText") ?? "");
    return adminUiState.bingoSourcePoolDraft;
  }

  function readQuestionPoolDraft(formNode) {
    const formData = new FormData(formNode);

    adminUiState.questionPoolDraft = String(formData.get("questionPoolJson") ?? "");
    return adminUiState.questionPoolDraft;
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

  function applyBingoSourcePoolPreviewState(previewResult) {
    adminUiState.bingoSourcePoolValidationErrors = previewResult.errors;
    adminUiState.bingoSourcePoolPreview = previewResult;

    if (previewResult.errors.length > 0) {
      setBingoSourcePoolMessage("Fix the Bingo pool validation errors below before replacing the saved pool.", "error");
      return false;
    }

    if (previewResult.isEmpty) {
      setBingoSourcePoolMessage("Blank or empty Bingo pool text will not overwrite the saved pool. Use Clear Bingo Pool if you intentionally want an empty pool.", "warning");
      return false;
    }

    if (!previewResult.hasMinimumItems) {
      setBingoSourcePoolMessage(`At least ${BINGO_CARD_ITEM_COUNT} unique Bingo items are required before replacing the saved pool.`, "error");
      return false;
    }

    if (previewResult.warning) {
      setBingoSourcePoolMessage(`Preview ready with warning: ${previewResult.count} unique items. ${previewResult.warning}`, "warning");
      return true;
    }

    setBingoSourcePoolMessage(`Preview ready: ${previewResult.count} unique Bingo items.`, "success");
    return true;
  }

  function applyQuestionPoolPreviewState(previewResult) {
    adminUiState.questionPoolValidationErrors = previewResult.errors;

    if (previewResult.errors.length > 0) {
      adminUiState.questionPoolPreview = null;
      setQuestionPoolMessage("Fix the validation errors below before replacing the Trivia Question Pool.", "error");
      return false;
    }

    adminUiState.questionPoolPreview = previewResult;

    if (previewResult.isEmpty) {
      setQuestionPoolMessage("Empty arrays cannot replace the Trivia Question Pool. Use Clear Question Pool to intentionally remove it.", "warning");
      return false;
    }

    const questionLabel = previewResult.questions.length === 1 ? "question" : "questions";

    setQuestionPoolMessage(`Preview ready: ${previewResult.questions.length} ${questionLabel}.`, "success");
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
    const isBingoSourcePoolBusy = adminUiState.isLoading
      || adminUiState.isSavingBingoSourcePool
      || adminUiState.isClearingBingoSourcePool;
    const isBottleListBusy = adminUiState.isLoading || adminUiState.isSavingBottleList || adminUiState.isClearingBottleList;
    const isQuestionPoolBusy = adminUiState.isLoading || adminUiState.isSavingQuestionPool || adminUiState.isClearingQuestionPool;
    const currentQuestionPoolCounts = adminUiState.questionPoolPreview?.counts || adminUiState.questionPool.counts;
    const currentBingoSourcePoolCounts = adminUiState.bingoSourcePoolPreview || adminUiState.bingoSourcePool;
    const exportCapabilities = getExportCapabilities("admin");
    const isAnyExportBusy = adminUiState.isLoading
      || adminUiState.isExportingPlayers
      || adminUiState.isExportingBingoWinners;
    const exportsSectionMarkup = exportCapabilities.allowed
      ? `
        <section class="player-section admin-section">
          <div class="player-section-header">
            <div>
              <p class="eyebrow">Exports</p>
              <h3>Download Live Event CSVs</h3>
              <p class="player-copy">Export checked-in players and stored Bingo winner records without changing Firebase. Downloads happen directly in this browser session.</p>
            </div>
          </div>
          ${renderSectionNotice(adminUiState.exportMessage)}
          <div class="admin-button-row">
            <button
              type="button"
              class="primary-button"
              data-action="download-checked-in-players-csv"
              ${isAnyExportBusy ? "disabled" : ""}
            >
              ${adminUiState.isExportingPlayers ? "Downloading Players CSV..." : "Download Checked-In Players CSV"}
            </button>
            <button
              type="button"
              class="primary-button"
              data-action="download-bingo-winners-csv"
              ${isAnyExportBusy ? "disabled" : ""}
            >
              ${adminUiState.isExportingBingoWinners ? "Downloading Bingo Winners CSV..." : "Download Bingo Winners CSV"}
            </button>
          </div>
        </section>
      `
      : "";

    contentNode.innerHTML = `
      <div class="admin-sections">
        <div data-admin-display-controls></div>
        ${exportsSectionMarkup}

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
              <p class="eyebrow">Trivia Question Pool</p>
              <h3>Trivia Question Pool</h3>
              <p class="player-copy">Questions stay in Firebase until replaced. <code>answer</code> uses zero-based indexing. This editor manages the saved pool only and does not control live Trivia gameplay.</p>
            </div>
          </div>
          ${renderSectionNotice(adminUiState.questionPoolMessage)}
          ${renderTriviaQuestionValidationErrors(adminUiState.questionPoolValidationErrors)}
          <form class="player-form admin-editor-form" data-admin-form="trivia-question-pool" novalidate>
            <div class="admin-import-stack">
              <div class="admin-import-row">
                <button
                  type="button"
                  class="secondary-button admin-import-button"
                  data-action="choose-trivia-question-pool-csv"
                  ${isQuestionPoolBusy ? "disabled" : ""}
                >
                  Import Trivia CSV
                </button>
                <input
                  type="file"
                  class="admin-import-input"
                  accept=".csv,text/csv"
                  data-trivia-question-pool-csv-input
                  aria-hidden="true"
                  tabindex="-1"
                  ${isQuestionPoolBusy ? "disabled" : ""}
                >
              </div>
              <p class="admin-helper-copy">CSV import fills the box below. Review before saving.</p>
              ${renderAdminImportFeedback(adminUiState.questionPoolImportMessage, adminUiState.questionPoolImportIssues)}
            </div>
            <label class="form-field" for="admin-trivia-question-pool-json">
              <span>Paste Question Pool JSON</span>
              <textarea
                id="admin-trivia-question-pool-json"
                name="questionPoolJson"
                class="form-input form-textarea"
                rows="18"
                data-trivia-question-pool-input
                ${isQuestionPoolBusy ? "disabled" : ""}
              ></textarea>
            </label>
            <p class="admin-helper-copy">Questions remain in Firebase until replaced. The <code>answer</code> value must be a zero-based option index. Replace only updates <code>/trivia/questionPool</code> and does not create live Trivia state.</p>
            <div class="trivia-count-grid" data-admin-trivia-counts></div>
            <div class="admin-meta">
              Last saved: <span data-trivia-question-pool-updated-at>${escapeHtml(formatUpdatedAt(adminUiState.questionPool.updatedAt))}</span>
            </div>
            <div class="admin-button-row">
              <button type="button" class="secondary-button" data-action="validate-trivia-question-pool" ${isQuestionPoolBusy ? "disabled" : ""}>
                Validate / Preview
              </button>
              <button type="submit" class="primary-button" ${isQuestionPoolBusy ? "disabled" : ""}>
                ${adminUiState.isSavingQuestionPool ? "Replacing Question Pool..." : "Replace Question Pool"}
              </button>
              <button type="button" class="secondary-button" data-action="clear-trivia-question-pool" ${isQuestionPoolBusy ? "disabled" : ""}>
                ${adminUiState.isClearingQuestionPool ? "Clearing Question Pool..." : "Clear Question Pool"}
              </button>
            </div>
          </form>
          <div data-trivia-question-pool-preview></div>
        </section>

        <section class="player-section admin-section">
          <div class="player-section-header">
            <div>
              <p class="eyebrow">Bingo Bottle Pool</p>
              <h3>Bingo Bottle Pool</h3>
              <p class="player-copy">This pool is used only for Bingo cards and is separate from the public Bottle List.</p>
            </div>
          </div>
          ${renderSectionNotice(adminUiState.bingoSourcePoolMessage)}
          ${renderBingoSourcePoolValidationErrors(adminUiState.bingoSourcePoolValidationErrors)}
          <form class="player-form admin-editor-form" data-admin-form="bingo-source-pool" novalidate>
            <div class="admin-import-stack">
              <div class="admin-import-row">
                <button
                  type="button"
                  class="secondary-button admin-import-button"
                  data-action="choose-bingo-source-pool-csv"
                  ${isBingoSourcePoolBusy ? "disabled" : ""}
                >
                  Import Bingo CSV
                </button>
                <input
                  type="file"
                  class="admin-import-input"
                  accept=".csv,text/csv"
                  data-bingo-source-pool-csv-input
                  aria-hidden="true"
                  tabindex="-1"
                  ${isBingoSourcePoolBusy ? "disabled" : ""}
                >
              </div>
              <p class="admin-helper-copy">CSV import fills the box below. Review before saving.</p>
              ${renderAdminImportFeedback(adminUiState.bingoSourcePoolImportMessage, adminUiState.bingoSourcePoolImportIssues)}
            </div>
            <label class="form-field" for="admin-bingo-source-pool">
              <span>One Item Per Line</span>
              <textarea
                id="admin-bingo-source-pool"
                name="bingoSourceText"
                class="form-input form-textarea"
                rows="14"
                data-bingo-source-pool-input
                ${isBingoSourcePoolBusy ? "disabled" : ""}
              ></textarea>
            </label>
            <p class="admin-helper-copy">Blank lines are ignored. Duplicate names are rejected after trimming and comparing case-insensitively. Replace only updates <code>/bingo/sourcePool</code> and does not alter <code>/bingo/live</code>.</p>
            <div class="trivia-count-grid" data-admin-bingo-source-pool-counts></div>
            <div class="admin-meta">
              Last saved: <span data-bingo-source-pool-updated-at>${escapeHtml(formatUpdatedAt(adminUiState.bingoSourcePool.updatedAt))}</span>
            </div>
            <div class="admin-button-row">
              <button type="button" class="secondary-button" data-action="validate-bingo-source-pool" ${isBingoSourcePoolBusy ? "disabled" : ""}>
                Validate / Preview
              </button>
              <button type="submit" class="primary-button" ${isBingoSourcePoolBusy ? "disabled" : ""}>
                ${adminUiState.isSavingBingoSourcePool ? "Replacing Bingo Pool..." : "Replace Bingo Pool"}
              </button>
              <button type="button" class="secondary-button" data-action="clear-bingo-source-pool" ${isBingoSourcePoolBusy ? "disabled" : ""}>
                ${adminUiState.isClearingBingoSourcePool ? "Clearing Bingo Pool..." : "Clear Bingo Pool"}
              </button>
            </div>
          </form>
          <div data-bingo-source-pool-preview></div>
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

    if (activeAdminDisplayControls) {
      activeAdminDisplayControls.renderInto(contentNode.querySelector("[data-admin-display-controls]"));
    }

    const titleField = contentNode.querySelector("[data-static-page-title-input]");
    const contentField = contentNode.querySelector("[data-static-page-content-input]");
    const questionPoolField = contentNode.querySelector("[data-trivia-question-pool-input]");
    const bingoSourcePoolField = contentNode.querySelector("[data-bingo-source-pool-input]");
    const bottleListSourceField = contentNode.querySelector("[data-bottle-list-source-input]");

    if (titleField instanceof HTMLInputElement) {
      titleField.value = activePage.title;
    }

    if (contentField instanceof HTMLTextAreaElement) {
      contentField.value = activePage.content;
    }

    if (questionPoolField instanceof HTMLTextAreaElement) {
      questionPoolField.value = adminUiState.questionPoolDraft;
    }

    if (bingoSourcePoolField instanceof HTMLTextAreaElement) {
      bingoSourcePoolField.value = adminUiState.bingoSourcePoolDraft;
    }

    if (bottleListSourceField instanceof HTMLTextAreaElement) {
      bottleListSourceField.value = adminUiState.bottleListDraft;
    }

    REVIEW_LINK_DEFINITIONS.forEach((linkDefinition) => {
      const inputNode = contentNode.querySelector(`[data-review-link-input="${linkDefinition.key}"]`);

      if (inputNode instanceof HTMLInputElement) {
        inputNode.value = adminUiState.reviewLinks[linkDefinition.key] || "";
      }
    });

    renderTriviaCountGrid(contentNode.querySelector("[data-admin-trivia-counts]"), currentQuestionPoolCounts);
    renderBingoSourcePoolCountGrid(
      contentNode.querySelector("[data-admin-bingo-source-pool-counts]"),
      currentBingoSourcePoolCounts
    );
    renderTriviaQuestionPoolPreview(
      contentNode.querySelector("[data-trivia-question-pool-preview]"),
      adminUiState.questionPoolPreview
    );
    renderBingoSourcePoolPreview(
      contentNode.querySelector("[data-bingo-source-pool-preview]"),
      adminUiState.bingoSourcePoolPreview
    );
  }

  async function loadAdminContent() {
    adminUiState.isLoading = true;
    setPageMessage();
    setReviewMessage();
    setBingoSourcePoolMessage();
    setBottleListMessage();
    setQuestionPoolMessage();
    setExportMessage();
    clearBingoSourcePoolImportFeedback();
    clearQuestionPoolImportFeedback();
    renderAdminContent();

    const [pagesValue, reviewLinksValue, bingoSourcePoolValue, bottleListValue, questionPoolValue] = await Promise.all([
      firebase.readEventData("pages"),
      firebase.readEventData("reviewLinks"),
      firebase.readEventData(BINGO_SOURCE_POOL_PATH),
      firebase.readEventData(PUBLIC_BOTTLE_LIST_PATH),
      firebase.readEventData(TRIVIA_QUESTION_POOL_PATH),
    ]);

    adminUiState.pages = normalizeStaticPages(pagesValue);
    adminUiState.reviewLinks = normalizeReviewLinks(reviewLinksValue);
    adminUiState.bingoSourcePool = normalizeBingoSourcePool(bingoSourcePoolValue);
    adminUiState.bottleList = normalizeBottleList(bottleListValue);
    adminUiState.questionPool = normalizeTriviaQuestionPool(questionPoolValue);
    adminUiState.bingoSourcePoolValidationErrors = [];
    adminUiState.bottleListValidationErrors = [];
    adminUiState.questionPoolValidationErrors = [];
    adminUiState.bingoSourcePoolPreview = null;
    adminUiState.bottleListPreview = null;
    adminUiState.questionPoolPreview = null;

    const editableBingoSourcePool = getEditableBingoSourcePoolSource(
      adminUiState.bingoSourcePool,
      bingoSourcePoolValue
    );
    const editableBottleList = getEditableBottleListSource(adminUiState.bottleList);
    const editableQuestionPool = getEditableTriviaQuestionPoolSource(adminUiState.questionPool, questionPoolValue);
    const firebaseStatus = firebase.getStatus();

    adminUiState.bingoSourcePoolDraft = editableBingoSourcePool.draft;
    adminUiState.bottleListDraft = editableBottleList.draft;
    adminUiState.questionPoolDraft = editableQuestionPool.draft;

    if (bingoSourcePoolValue === null && firebaseStatus.error) {
      setBingoSourcePoolMessage(firebaseStatus.message || "Bingo pool data is temporarily unavailable.", "error");
    } else if (editableBingoSourcePool.source === "missing") {
      setBingoSourcePoolMessage("No Bingo bottle pool is saved yet. Add one item per line, then validate and replace the pool.", "info");
    } else if (editableBingoSourcePool.source === "saved") {
      setBingoSourcePoolMessage("Loaded the saved Bingo bottle pool from Firebase.", "info");
    } else if (editableBingoSourcePool.source === "reconstructed") {
      setBingoSourcePoolMessage("Loaded the saved Bingo bottle pool by reconstructing text from structured items.", "info");
    } else if (editableBingoSourcePool.source === "empty") {
      setBingoSourcePoolMessage("Loaded the saved empty Bingo bottle pool from Firebase. Replace it with at least 9 items or keep it empty with Clear Bingo Pool.", "info");
    } else if (editableBingoSourcePool.source === "invalid" || editableBingoSourcePool.source === "invalid_reconstructed") {
      setBingoSourcePoolMessage("The saved Bingo bottle pool data is invalid. Review the loaded text and replace it before Hosts prepare a round.", "error");
    }

    if (editableBottleList.wasReconstructed) {
      setBottleListMessage("Loaded the saved bottle list by reconstructing editable text from structured data.", "info");
    }

    if (questionPoolValue === null && firebaseStatus.error) {
      setQuestionPoolMessage(firebaseStatus.message || "Trivia Question Pool data is temporarily unavailable.", "error");
    } else if (editableQuestionPool.source === "example") {
      setQuestionPoolMessage("No Trivia Question Pool is saved yet. The editor has been prefilled with a safe example that will not save until you replace the pool.", "info");
    } else if (editableQuestionPool.source === "saved") {
      setQuestionPoolMessage("Loaded the saved Trivia Question Pool from Firebase.", "info");
    } else if (editableQuestionPool.source === "empty") {
      setQuestionPoolMessage("Loaded the saved empty Trivia Question Pool from Firebase. Replace it with questions or keep it empty with Clear Question Pool.", "info");
    } else if (editableQuestionPool.source === "invalid") {
      setQuestionPoolMessage("The saved Trivia Question Pool is invalid. The editor was reset to the safe example until the pool is replaced.", "error");
    }

    adminUiState.isLoading = false;
    renderAdminContent();
  }

  async function exportCheckedInPlayers() {
    if (adminUiState.isExportingPlayers || adminUiState.isExportingBingoWinners) {
      return;
    }

    adminUiState.isExportingPlayers = true;
    setExportMessage();
    renderAdminContent();

    let exportResult;

    try {
      exportResult = await downloadCheckedInPlayersCsv({
        firebase,
        eventId: state.getState().eventId || firebase.getEventId(),
      });
    } catch (error) {
      console.error("[Event Engine] Checked-in players export failed.", error);
      exportResult = {
        message: `Checked-In Players CSV failed: ${error.message}`,
        tone: "error",
      };
    }

    adminUiState.isExportingPlayers = false;
    setExportMessage(exportResult.message, exportResult.tone);
    renderAdminContent();
  }

  async function exportBingoWinners() {
    if (adminUiState.isExportingPlayers || adminUiState.isExportingBingoWinners) {
      return;
    }

    adminUiState.isExportingBingoWinners = true;
    setExportMessage();
    renderAdminContent();

    let exportResult;

    try {
      exportResult = await downloadBingoWinnersCsv({
        firebase,
        eventId: state.getState().eventId || firebase.getEventId(),
      });
    } catch (error) {
      console.error("[Event Engine] Bingo winners export failed.", error);
      exportResult = {
        message: `Bingo Winners CSV failed: ${error.message}`,
        tone: "error",
      };
    }

    adminUiState.isExportingBingoWinners = false;
    setExportMessage(exportResult.message, exportResult.tone);
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

  function validateBingoSourcePool(formNode) {
    const sourceText = readBingoSourcePoolDraft(formNode);
    const previewResult = parseBingoSourcePoolText(sourceText);

    applyBingoSourcePoolPreviewState(previewResult);
    renderAdminContent();
    return previewResult;
  }

  function validateQuestionPool(formNode) {
    const sourceText = readQuestionPoolDraft(formNode);
    const previewResult = parseTriviaQuestionPoolJson(sourceText);

    applyQuestionPoolPreviewState(previewResult);
    renderAdminContent();
    return previewResult;
  }

  async function importTriviaQuestionPoolCsv(file) {
    let sourceText = "";

    try {
      sourceText = await file.text();
    } catch (error) {
      console.error("[Event Engine] Trivia CSV import failed while reading the file.", error);
      adminUiState.questionPoolImportIssues = [createImportIssue(`Could not read "${file.name}".`)];
      setQuestionPoolImportMessage("Trivia CSV could not be imported. Fix the file and try again.", "error");
      renderAdminContent();
      return;
    }

    const importResult = convertTriviaCsvToDraft(sourceText);

    adminUiState.questionPoolImportIssues = importResult.issues;
    setQuestionPoolImportMessage(importResult.message, importResult.tone);

    if (importResult.isValid) {
      adminUiState.questionPoolDraft = importResult.draft;
      adminUiState.questionPoolValidationErrors = [];
      adminUiState.questionPoolPreview = null;
      setQuestionPoolMessage();
    }

    renderAdminContent();
  }

  async function importBingoSourcePoolCsv(file) {
    let sourceText = "";

    try {
      sourceText = await file.text();
    } catch (error) {
      console.error("[Event Engine] Bingo CSV import failed while reading the file.", error);
      adminUiState.bingoSourcePoolImportIssues = [createImportIssue(`Could not read "${file.name}".`)];
      setBingoSourcePoolImportMessage("Bingo CSV could not be imported. Fix the file and try again.", "error");
      renderAdminContent();
      return;
    }

    const importResult = convertBingoCsvToDraft(sourceText);

    adminUiState.bingoSourcePoolImportIssues = importResult.issues;
    setBingoSourcePoolImportMessage(importResult.message, importResult.tone);

    if (importResult.isValid) {
      adminUiState.bingoSourcePoolDraft = importResult.draft;
      adminUiState.bingoSourcePoolValidationErrors = [];
      adminUiState.bingoSourcePoolPreview = null;
      setBingoSourcePoolMessage();
    }

    renderAdminContent();
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

  async function saveBingoSourcePool(formNode) {
    const sourceText = readBingoSourcePoolDraft(formNode);
    const previewResult = parseBingoSourcePoolText(sourceText);
    const canReplace = applyBingoSourcePoolPreviewState(previewResult);

    if (!canReplace) {
      renderAdminContent();
      return;
    }

    const replaceConfirmed = window.confirm(
      "Replace the saved Bingo bottle pool in Firebase? This updates only /bingo/sourcePool and does not alter any prepared round under /bingo/live."
    );

    if (!replaceConfirmed) {
      renderAdminContent();
      return;
    }

    adminUiState.isSavingBingoSourcePool = true;
    setBingoSourcePoolMessage();
    renderAdminContent();

    const nextBingoSourcePoolPayload = buildBingoSourcePoolPayload({
      sourceText: previewResult.sourceText,
      items: previewResult.items,
      updatedAt: new Date().toISOString(),
    });
    const saveSucceeded = await firebase.writeEventData(BINGO_SOURCE_POOL_PATH, nextBingoSourcePoolPayload);

    adminUiState.isSavingBingoSourcePool = false;

    if (!saveSucceeded) {
      setBingoSourcePoolMessage(firebase.getStatus().message || "We could not replace the Bingo bottle pool right now. Please try again.", "error");
      renderAdminContent();
      return;
    }

    adminUiState.bingoSourcePool = normalizeBingoSourcePool(nextBingoSourcePoolPayload);
    adminUiState.bingoSourcePoolDraft = nextBingoSourcePoolPayload.sourceText;
    adminUiState.bingoSourcePoolValidationErrors = [];
    adminUiState.bingoSourcePoolPreview = previewResult;
    clearBingoSourcePoolImportFeedback();
    setBingoSourcePoolMessage("Bingo bottle pool replaced in Firebase.", "success");
    renderAdminContent();
  }

  async function saveQuestionPool(formNode) {
    const sourceText = readQuestionPoolDraft(formNode);
    const previewResult = parseTriviaQuestionPoolJson(sourceText);
    const canReplace = applyQuestionPoolPreviewState(previewResult);

    if (!canReplace) {
      renderAdminContent();
      return;
    }

    const replaceConfirmed = window.confirm(
      "Replace the saved Trivia Question Pool in Firebase? This updates only /trivia/questionPool and does not create live Trivia gameplay state."
    );

    if (!replaceConfirmed) {
      renderAdminContent();
      return;
    }

    adminUiState.isSavingQuestionPool = true;
    setQuestionPoolMessage();
    renderAdminContent();

    const nextQuestionPoolPayload = buildTriviaQuestionPoolPayload({
      questions: previewResult.questions,
      updatedAt: new Date().toISOString(),
    });
    const saveSucceeded = await firebase.writeEventData(TRIVIA_QUESTION_POOL_PATH, nextQuestionPoolPayload);

    adminUiState.isSavingQuestionPool = false;

    if (!saveSucceeded) {
      setQuestionPoolMessage(firebase.getStatus().message || "We could not replace the Trivia Question Pool right now. Please try again.", "error");
      renderAdminContent();
      return;
    }

    adminUiState.questionPool = normalizeTriviaQuestionPool(nextQuestionPoolPayload);
    adminUiState.questionPoolDraft = reconstructTriviaQuestionPoolJson(adminUiState.questionPool);
    adminUiState.questionPoolValidationErrors = [];
    adminUiState.questionPoolPreview = {
      ...previewResult,
      questions: adminUiState.questionPool.orderedQuestions,
      counts: adminUiState.questionPool.counts,
    };
    clearQuestionPoolImportFeedback();
    setQuestionPoolMessage("Trivia Question Pool replaced in Firebase.", "success");
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

  async function clearQuestionPool() {
    const clearConfirmed = window.confirm(
      "Clear the saved Trivia Question Pool from Firebase? This writes an intentional empty pool to /trivia/questionPool and does not create live Trivia gameplay state."
    );

    if (!clearConfirmed) {
      return;
    }

    adminUiState.isClearingQuestionPool = true;
    setQuestionPoolMessage();
    renderAdminContent();

    const emptyQuestionPoolPayload = buildTriviaQuestionPoolPayload({
      questions: [],
      updatedAt: new Date().toISOString(),
    });
    const clearSucceeded = await firebase.writeEventData(TRIVIA_QUESTION_POOL_PATH, emptyQuestionPoolPayload);

    adminUiState.isClearingQuestionPool = false;

    if (!clearSucceeded) {
      setQuestionPoolMessage(firebase.getStatus().message || "We could not clear the Trivia Question Pool right now. Please try again.", "error");
      renderAdminContent();
      return;
    }

    adminUiState.questionPool = normalizeTriviaQuestionPool(emptyQuestionPoolPayload);
    adminUiState.questionPoolDraft = reconstructTriviaQuestionPoolJson(adminUiState.questionPool);
    adminUiState.questionPoolValidationErrors = [];
    adminUiState.questionPoolPreview = null;
    clearQuestionPoolImportFeedback();
    setQuestionPoolMessage("Trivia Question Pool cleared from Firebase.", "success");
    renderAdminContent();
  }

  async function clearBingoSourcePool() {
    const clearConfirmed = window.confirm(
      "Clear the saved Bingo bottle pool from Firebase? This only clears /bingo/sourcePool and does not alter /bingo/live/currentRound or any saved player cards."
    );

    if (!clearConfirmed) {
      return;
    }

    adminUiState.isClearingBingoSourcePool = true;
    setBingoSourcePoolMessage();
    renderAdminContent();

    const emptyBingoSourcePoolPayload = buildBingoSourcePoolPayload({
      sourceText: "",
      items: [],
      updatedAt: new Date().toISOString(),
    });
    const clearSucceeded = await firebase.writeEventData(BINGO_SOURCE_POOL_PATH, emptyBingoSourcePoolPayload);

    adminUiState.isClearingBingoSourcePool = false;

    if (!clearSucceeded) {
      setBingoSourcePoolMessage(firebase.getStatus().message || "We could not clear the Bingo bottle pool right now. Please try again.", "error");
      renderAdminContent();
      return;
    }

    adminUiState.bingoSourcePool = normalizeBingoSourcePool(emptyBingoSourcePoolPayload);
    adminUiState.bingoSourcePoolDraft = "";
    adminUiState.bingoSourcePoolValidationErrors = [];
    adminUiState.bingoSourcePoolPreview = null;
    clearBingoSourcePoolImportFeedback();
    setBingoSourcePoolMessage("Bingo bottle pool cleared from Firebase.", "success");
    renderAdminContent();
  }

  if (activeAdminRoot && activeAdminClickHandler) {
    activeAdminRoot.removeEventListener("click", activeAdminClickHandler);
  }

  if (activeAdminRoot && activeAdminInputHandler) {
    activeAdminRoot.removeEventListener("input", activeAdminInputHandler);
  }

  if (activeAdminRoot && activeAdminChangeHandler) {
    activeAdminRoot.removeEventListener("change", activeAdminChangeHandler);
  }

  if (activeAdminRoot && activeAdminSubmitHandler) {
    activeAdminRoot.removeEventListener("submit", activeAdminSubmitHandler);
  }

  if (adminRoot) {
    activeAdminClickHandler = async (event) => {
      if (activeAdminDisplayControls && await activeAdminDisplayControls.handleClick(event)) {
        return;
      }

      const actionNode = event.target.closest("[data-action]");

      if (!actionNode) {
        return;
      }

      if (actionNode.dataset.action === "lock-role") {
        cleanupAdminPageRuntime();
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

      if (actionNode.dataset.action === "download-checked-in-players-csv") {
        await exportCheckedInPlayers();
        return;
      }

      if (actionNode.dataset.action === "download-bingo-winners-csv") {
        await exportBingoWinners();
        return;
      }

      if (actionNode.dataset.action === "validate-trivia-question-pool") {
        const formNode = actionNode.closest('[data-admin-form="trivia-question-pool"]');

        if (formNode instanceof HTMLFormElement) {
          validateQuestionPool(formNode);
        }

        return;
      }

      if (actionNode.dataset.action === "choose-trivia-question-pool-csv") {
        const formNode = actionNode.closest('[data-admin-form="trivia-question-pool"]');
        const fileInput = formNode?.querySelector("[data-trivia-question-pool-csv-input]");

        if (fileInput instanceof HTMLInputElement && !fileInput.disabled) {
          fileInput.click();
        }

        return;
      }

      if (actionNode.dataset.action === "clear-trivia-question-pool") {
        await clearQuestionPool();
        return;
      }

      if (actionNode.dataset.action === "validate-bingo-source-pool") {
        const formNode = actionNode.closest('[data-admin-form="bingo-source-pool"]');

        if (formNode instanceof HTMLFormElement) {
          validateBingoSourcePool(formNode);
        }

        return;
      }

      if (actionNode.dataset.action === "choose-bingo-source-pool-csv") {
        const formNode = actionNode.closest('[data-admin-form="bingo-source-pool"]');
        const fileInput = formNode?.querySelector("[data-bingo-source-pool-csv-input]");

        if (fileInput instanceof HTMLInputElement && !fileInput.disabled) {
          fileInput.click();
        }

        return;
      }

      if (actionNode.dataset.action === "clear-bingo-source-pool") {
        await clearBingoSourcePool();
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
      if (activeAdminDisplayControls && activeAdminDisplayControls.handleInput(event)) {
        return;
      }

      const inputNode = event.target;

      if (inputNode instanceof HTMLTextAreaElement && inputNode.dataset.triviaQuestionPoolInput !== undefined) {
        adminUiState.questionPoolDraft = inputNode.value;
        adminUiState.questionPoolValidationErrors = [];
        adminUiState.questionPoolPreview = null;
        clearQuestionPoolImportFeedback();
        setQuestionPoolMessage();
        return;
      }

      if (inputNode instanceof HTMLTextAreaElement && inputNode.dataset.bingoSourcePoolInput !== undefined) {
        adminUiState.bingoSourcePoolDraft = inputNode.value;
        adminUiState.bingoSourcePoolValidationErrors = [];
        adminUiState.bingoSourcePoolPreview = null;
        clearBingoSourcePoolImportFeedback();
        setBingoSourcePoolMessage();
        return;
      }

      if (!(inputNode instanceof HTMLTextAreaElement) || inputNode.dataset.bottleListSourceInput === undefined) {
        return;
      }

      adminUiState.bottleListDraft = inputNode.value;
      adminUiState.bottleListValidationErrors = [];
      adminUiState.bottleListPreview = null;
      setBottleListMessage();
    };

    activeAdminChangeHandler = async (event) => {
      const inputNode = event.target;

      if (
        !(inputNode instanceof HTMLInputElement)
        || inputNode.type !== "file"
        || !inputNode.files
        || inputNode.files.length === 0
      ) {
        return;
      }

      const [file] = inputNode.files;

      try {
        if (inputNode.dataset.triviaQuestionPoolCsvInput !== undefined) {
          await importTriviaQuestionPoolCsv(file);
          return;
        }

        if (inputNode.dataset.bingoSourcePoolCsvInput !== undefined) {
          await importBingoSourcePoolCsv(file);
        }
      } finally {
        inputNode.value = "";
      }
    };

    activeAdminSubmitHandler = async (event) => {
      if (activeAdminDisplayControls && await activeAdminDisplayControls.handleSubmit(event)) {
        return;
      }

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

      if (formNode.dataset.adminForm === "trivia-question-pool") {
        event.preventDefault();
        await saveQuestionPool(formNode);
        return;
      }

      if (formNode.dataset.adminForm === "bingo-source-pool") {
        event.preventDefault();
        await saveBingoSourcePool(formNode);
        return;
      }

      if (formNode.dataset.adminForm === "public-bottle-list") {
        event.preventDefault();
        await saveBottleList(formNode);
      }
    };

    adminRoot.addEventListener("click", activeAdminClickHandler);
    adminRoot.addEventListener("input", activeAdminInputHandler);
    adminRoot.addEventListener("change", activeAdminChangeHandler);
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

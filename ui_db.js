// ui_db.js
// CSV 로딩 + UX Writing Rule Engine

// --------------- 공통 유틸 ---------------

async function loadCsv(relativePath) {
  const res = await fetch(relativePath);
  const text = await res.text();

  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (lines.length === 0) return [];

  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = (cols[i] || "").trim();
    });
    return row;
  });
}

// 따옴표 포함 CSV 한 줄 파서 (간단버전)
function splitCsvLine(line) {
  const result = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // 이스케이프된 "
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

// --------------- DB 로딩 ---------------

export const UX_DB = {
  principles: [],      // 00
  components: [],      // 01
  termFieldMapping: [],// 02
  revenueExpense: [],  // 03
  glossary: [],        // 04
  wordRules: [],       // 05

  // 인덱스
  termMap: new Map(),        // AS-IS → TO-BE
  wordReplacementMap: new Map(), // don’t → do
};

// 한 번만 로딩
let dbLoaded = false;
let dbLoadingPromise = null;

export async function ensureDbLoaded() {
  if (dbLoaded) return;
  if (!dbLoadingPromise) {
    dbLoadingPromise = loadAll();
  }
  await dbLoadingPromise;
}

async function loadAll() {
  // 파일 경로는 DB 폴더 기준
  const [
    principles,
    components,
    termFieldMapping,
    revenueExpense,
    glossary,
    wordRules,
  ] = await Promise.all([
    loadCsv("./DB/00_ux_writing_principles.csv"),
    loadCsv("./DB/01_component_definitions.csv"),
    loadCsv("./DB/02_term_field_mapping.csv"),
    loadCsv("./DB/03_revenue_e_mapping.csv"),
    loadCsv("./DB/04_glossary.csv"),
    loadCsv("./DB/05_ux_word_ent_rules.csv"),
  ]);

  UX_DB.principles = principles;
  UX_DB.components = components;
  UX_DB.termFieldMapping = termFieldMapping;
  UX_DB.revenueExpense = revenueExpense;
  UX_DB.glossary = glossary;
  UX_DB.wordRules = wordRules;

  buildIndexes();

  dbLoaded = true;
  console.log("[UX DB] loaded", {
    principles: principles.length,
    components: components.length,
    termFieldMapping: termFieldMapping.length,
    revenueExpense: revenueExpense.length,
    glossary: glossary.length,
    wordRules: wordRules.length,
  });
}

function buildIndexes() {
  UX_DB.termMap.clear();
  UX_DB.wordReplacementMap.clear();

  // 02_term_field_mapping.csv
  // 가정 헤더: category,subCategory,asIs,toBe,fieldName,description,example
  UX_DB.termFieldMapping.forEach(row => {
    const asIs = (row.asIs || "").trim();
    const toBe = (row.toBe || "").trim();
    if (!asIs || !toBe) return;
    UX_DB.termMap.set(asIs, toBe);
  });

  // 05_ux_word_ent_rules.csv
  // 가정 헤더: type,dont,do,fieldScope,notes
  UX_DB.wordRules.forEach(row => {
    const from = (row.dont || row["don’t"] || "").trim();
    const to = (row.do || "").trim();
    if (!from || !to) return;
    UX_DB.wordReplacementMap.set(from, to);
  });

  console.log("[UX DB] indexes built", {
    termMap: UX_DB.termMap.size,
    wordReplacementMap: UX_DB.wordReplacementMap.size,
  });
}

// --------------- 룰 엔진 ---------------

// 2-1. 용어 통일: as-is → to-be 추천
export function findTermMismatches(text) {
  const issues = [];

  if (!text) return issues;

  for (const [asIs, toBe] of UX_DB.termMap.entries()) {
    if (!asIs || !toBe) continue;
    const re = new RegExp(escapeRegExp(asIs), "g");
    if (re.test(text)) {
      issues.push({
        type: "TERM_MAPPING",
        from: asIs,
        to: toBe,
        message: `"${asIs}" 대신 "${toBe}"를 사용해 주세요.`,
      });
    }
  }
  return issues;
}

// 2-2. UX Word 규칙: don’t → do
export function applyWordReplacement(text) {
  if (!text) return { text, replacements: [] };

  let result = text;
  const replacements = [];

  for (const [from, to] of UX_DB.wordReplacementMap.entries()) {
    const re = new RegExp(escapeRegExp(from), "g");
    if (re.test(result)) {
      result = result.replace(re, to);
      replacements.push({ from, to });
    }
  }

  return { text: result, replacements };
}

// 2-3. 스타일 가이드 기반 간단 체크
export function checkStyleGuides(text) {
  const issues = [];
  if (!text) return issues;

  // 마침표 규칙 예시: 제목에는 마침표 X
  if (/[.!?]$/.test(text)) {
    issues.push({
      type: "PUNCTUATION",
      message: "타이틀에는 문장 끝 마침표를 넣지 않는 것을 권장합니다.",
    });
  }

  // 한자어 경고 예시 (간단 버전)
  const hanjaLike = /[一-龥]/;
  if (hanjaLike.test(text)) {
    issues.push({
      type: "HANJA",
      message: "가능한 한 한자어 대신 쉬운 한국어 표현을 사용해 주세요.",
    });
  }

  return issues;
}

// 2-4. 한 줄 전체 스캔 (Title/Description 등 공통 사용)
export function lintFieldText(fieldName, text) {
  const termIssues = findTermMismatches(text);
  const styleIssues = checkStyleGuides(text);
  const { text: replacedText, replacements } = applyWordReplacement(text);

  return {
    original: text,
    suggested: replacedText,
    termIssues,
    styleIssues,
    replacements,
  };
}

// 2-5. 모달 한 덩어리 추천 문구 생성기
// fields: { kind, title, identifier, description, condition, leftButton, rightButton }
export function buildModalSuggestion(fields) {
  const result = {};

  // Title
  const titleLint = lintFieldText("title", fields.title || "");
  result.title = titleLint.suggested || fields.title || "작업을 다시 한 번 확인해 주세요.";

  // Identifier (있으면 그대로 사용, 없으면 룰로 생성)
  if (fields.identifier && fields.identifier.trim()) {
    const idLint = lintFieldText("identifier", fields.identifier);
    result.identifier = idLint.suggested;
  } else {
    if (fields.kind === "Destructive Modal") {
      result.identifier = "되돌릴 수 없는 작업입니다.";
    } else if (fields.kind === "Confirm Modal") {
      result.identifier = "입력하신 내용으로 진행할까요?";
    } else {
      result.identifier = "";
    }
  }

  // Description
  if (fields.description && fields.description.trim()) {
    const descLint = lintFieldText("description", fields.description);
    result.description = descLint.suggested;
  } else {
    if (fields.kind === "Destructive Modal") {
      result.description = "삭제 후에는 데이터를 복구할 수 없어요.";
    } else if (fields.kind === "Confirm Modal") {
      result.description = "저장된 내용은 정산에 바로 반영됩니다.";
    } else {
      result.description = "이 작업을 진행하시겠어요?";
    }
  }

  // Condition
  if (fields.condition && fields.condition.trim()) {
    const condLint = lintFieldText("condition", fields.condition);
    result.condition = condLint.suggested;
  } else {
    result.condition = "";
  }

  // Buttons
  result.leftButton = fields.leftButton && fields.leftButton.trim()
    ? applyWordReplacement(fields.leftButton).text
    : (fields.kind === "Destructive Modal" ? "취소" : "취소");

  result.rightButton = fields.rightButton && fields.rightButton.trim()
    ? applyWordReplacement(fields.rightButton).text
    : (fields.kind === "Destructive Modal" ? "삭제하기" : "확인");

  return result;
}

// --------------- Helper ---------------

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
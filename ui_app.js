// ui_app.js
import { ensureDbLoaded, buildModalSuggestion, lintFieldText } from "./ui_db.js";

const $ = (sel) => document.querySelector(sel);

// 필드 DOM 캐시
const fields = {
  kindLabel: $("#kindLabel"),      // Destructive Modal / Confirm Modal 뱃지
  title: $("#field-title"),
  identifier: $("#field-identifier"),
  description: $("#field-description"),
  condition: $("#field-condition"),
  leftButton: $("#field-leftButton"),
  rightButton: $("#field-rightButton"),

  // 미리보기 영역
  previewTitle: $("#preview-title"),
  previewIdentifier: $("#preview-identifier"),
  previewBody: $("#preview-body"),
  previewLeftBtn: $("#preview-left"),
  previewRightBtn: $("#preview-right"),

  // 상태 뱃지 영역 등
  badgeContainer: $("#badge-container"),
};

// ---- 1) Figma 코드와 통신 (선택 텍스트 불러오기)

window.onmessage = async (event) => {
  const msg = event.data.pluginMessage;
  if (!msg) return;

  if (msg.type === "SCAN_RESULT") {
    await ensureDbLoaded();
    fillCurrentFromSelection(msg.current);
    runLintAndBadges(msg.current);
  }
};

// selection → 좌측 폼 채우기
function fillCurrentFromSelection(current) {
  fields.kindLabel.textContent = current.kindLabel || "Confirm Modal";
  fields.title.value = current.title || "";
  fields.identifier.value = current.identifier || "";
  fields.description.value = current.description || "";
  fields.condition.value = current.condition || "";
  fields.leftButton.value = current.leftButton || "";
  fields.rightButton.value = current.rightButton || "";

  // 기본 미리보기도 한번 채워주기
  updatePreviewFromForm();
}

// ---- 2) 검사하기 버튼

$("#btn-scan").addEventListener("click", async () => {
  await ensureDbLoaded();

  const current = getCurrentFormState();
  runLintAndBadges(current);

  // Figma 쪽에도 다시 보내고 싶으면
  parent.postMessage({ pluginMessage: { type: "SCAN_FROM_UI", current } }, "*");
});

function getCurrentFormState() {
  return {
    kindLabel: fields.kindLabel.textContent.trim(),
    title: fields.title.value.trim(),
    identifier: fields.identifier.value.trim(),
    description: fields.description.value.trim(),
    condition: fields.condition.value.trim(),
    leftButton: fields.leftButton.value.trim(),
    rightButton: fields.rightButton.value.trim(),
  };
}

function runLintAndBadges(current) {
  fields.badgeContainer.innerHTML = "";

  const targets = [
    ["Title", current.title],
    ["Identifier", current.identifier],
    ["Description", current.description],
    ["Condition", current.condition],
    ["Left button", current.leftButton],
    ["Right button", current.rightButton],
  ];

  targets.forEach(([name, text]) => {
    const lint = lintFieldText(name, text || "");
    if (
      lint.termIssues.length === 0 &&
      lint.styleIssues.length === 0 &&
      lint.replacements.length === 0
    ) {
      return;
    }

    const badge = document.createElement("div");
    badge.className = "lint-badge";
    badge.textContent =
      name +
      " : " +
      [
        ...lint.termIssues.map(i => i.message),
        ...lint.styleIssues.map(i => i.message),
        ...lint.replacements.map(r => `"${r.from}" → "${r.to}"`),
      ].join(" / ");
    fields.badgeContainer.appendChild(badge);
  });
}

// ---- 3) AI 텍스트 추천 버튼 → 제안 미리보기 채우기

$("#btn-ai-suggest").addEventListener("click", async () => {
  await ensureDbLoaded();
  const current = getCurrentFormState();
  const suggestion = buildModalSuggestion(current);
  applySuggestionToPreview(suggestion);
});

function applySuggestionToPreview(sug) {
  fields.previewTitle.textContent = sug.title || "제목이 표시됩니다.";
  fields.previewIdentifier.textContent = sug.identifier || "";
  fields.previewBody.textContent = sug.description || "";
  // condition은 미리보기 본문 하단/작은텍스트로 붙이고 싶으면 여기에 추가
  fields.previewLeftBtn.textContent = sug.leftButton || "취소";
  fields.previewRightBtn.textContent = sug.rightButton || "확인";
}

// ---- 4) 입력값이 바뀔 때마다 미리보기에도 반영

["input", "change"].forEach(evtType => {
  [
    fields.title,
    fields.identifier,
    fields.description,
    fields.condition,
    fields.leftButton,
    fields.rightButton,
  ].forEach(el => {
    el.addEventListener(evtType, () => {
      updatePreviewFromForm();
    });
  });
});

function updatePreviewFromForm() {
  const cur = getCurrentFormState();

  fields.previewTitle.textContent = cur.title || "제목이 표시됩니다.";
  fields.previewIdentifier.textContent = cur.identifier || "";
  fields.previewBody.textContent = cur.description || "본문이 표시됩니다.";
  fields.previewLeftBtn.textContent = cur.leftButton || "취소";
  fields.previewRightBtn.textContent = cur.rightButton || "확인";
}
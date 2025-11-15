// code.js

// UI 띄우기
figma.showUI(__html__, {
  width: 920,
  height: 540,
});

// ---------- 유틸 함수들 ----------

// TEXT node에서 문자열 안전하게 꺼내기
function getText(node) {
  try {
    if (node && node.type === "TEXT" && typeof node.characters === "string") {
      return String(node.characters).trim();
    }
  } catch (e) {
    // 폰트 미로드 등으로 오류 날 수 있음 → 그냥 빈 문자열
  }
  return "";
}

function nameMatches(nodeName, targets) {
  if (!nodeName) return false;
  var lowered = nodeName.toLowerCase();
  for (var i = 0; i < targets.length; i++) {
    var t = targets[i];
    if (!t) continue;
    var lt = t.toLowerCase();
    if (lowered === lt || lowered.indexOf(lt) >= 0) {
      return true;
    }
  }
  return false;
}

// FRAME/INSTANCE 안에서 name으로 TEXT 노드 찾기 (부분 일치 허용)
function findTextByName(root, names) {
  if (!root || typeof root.findAll !== "function") return null;
  var targets = Array.isArray(names) ? names : [names];
  var nodes = root.findAll(function (n) {
    return n.type === "TEXT" && nameMatches(n.name || "", targets);
  });
  return nodes.length > 0 ? nodes[0] : null;
}

// 어떤 노드 안에서 "첫 번째 TEXT 자식" 찾기
function findFirstTextDescendant(node) {
  if (!node || typeof node.findAll !== "function") return null;
  var nodes = node.findAll(function (n) {
    return n.type === "TEXT";
  });
  return nodes.length > 0 ? nodes[0] : null;
}

async function loadFontForTextNode(node) {
  if (!node || node.type !== "TEXT") return;
  try {
    if (node.fontName === figma.mixed) {
      var length = node.characters.length;
      for (var i = 0; i < length; i++) {
        var font = node.getRangeFontName(i, i + 1);
        await figma.loadFontAsync(font);
      }
    } else if (node.fontName) {
      await figma.loadFontAsync(node.fontName);
    }
  } catch (e) {
    // 폰트 정보를 가져오지 못하면 무시 (hidden node 등)
  }
}

async function ensureFonts(nodes) {
  if (!nodes || !nodes.length) return;
  for (var i = 0; i < nodes.length; i++) {
    await loadFontForTextNode(nodes[i]);
  }
}

// 버튼용 FRAME/INSTANCE 중 visible 한 것만 필터
function visibleButtonFrames(children) {
  var result = [];
  if (!children || !children.length) return result;
  for (var i = 0; i < children.length; i++) {
    var c = children[i];
    if (
      (c.type === "FRAME" ||
        c.type === "COMPONENT" ||
        c.type === "INSTANCE" ||
        c.type === "GROUP") &&
      c.visible !== false
    ) {
      result.push(c);
    }
  }
  return result;
}

function findButtonContainer(root) {
  if (!root || typeof root.findAll !== "function") return null;

  var nodes = root.findAll(function (n) {
    if (
      !n ||
      !n.name ||
      n.visible === false ||
      (n.type !== "FRAME" &&
        n.type !== "COMPONENT" &&
        n.type !== "INSTANCE" &&
        n.type !== "GROUP")
    ) {
      return false;
    }
    var lower = n.name.toLowerCase();
    if (lower.indexOf("button") < 0 && lower.indexOf("버튼") < 0) return false;
    var childButtons = visibleButtonFrames(n.children || []);
    return childButtons.length >= 2;
  });

  return nodes.length > 0 ? nodes[0] : null;
}

function getAbsoluteX(node) {
  if (!node || !node.absoluteTransform) return 0;
  try {
    return node.absoluteTransform[0][2] || 0;
  } catch (e) {
    return 0;
  }
}

function findStandaloneButtons(root) {
  if (!root || typeof root.findAll !== "function") return [];
  var candidates = root.findAll(function (n) {
    if (
      !n ||
      !n.name ||
      n.visible === false ||
      (n.type !== "FRAME" && n.type !== "COMPONENT" && n.type !== "INSTANCE")
    ) {
      return false;
    }
    var lower = n.name.toLowerCase();
    if (lower.indexOf("button") < 0 && lower.indexOf("버튼") < 0) return false;
    if (lower.indexOf("container") >= 0 || lower.indexOf("group") >= 0) {
      return false;
    }
    return true;
  });

  candidates.sort(function (a, b) {
    return getAbsoluteX(a) - getAbsoluteX(b);
  });
  return candidates;
}

function resolveButtonTextNodes(root) {
  var leftBtnTextNode = null;
  var rightBtnTextNode = null;

  var buttonContainer = findButtonContainer(root);
  var buttonFrames = [];

  if (buttonContainer) {
    buttonFrames = visibleButtonFrames(buttonContainer.children || []);
  }

  if (!buttonFrames || buttonFrames.length === 0) {
    buttonFrames = findStandaloneButtons(root);
  }

  if (buttonFrames.length === 1) {
    rightBtnTextNode = findFirstTextDescendant(buttonFrames[0]);
  } else if (buttonFrames.length >= 2) {
    leftBtnTextNode = findFirstTextDescendant(buttonFrames[0]);
    rightBtnTextNode = findFirstTextDescendant(buttonFrames[1]);
  }

  return {
    left: leftBtnTextNode,
    right: rightBtnTextNode,
  };
}

// 파괴적(Destructive) 버튼인지 간단 판별
function inferDestructiveByText(title, desc, leftLabel, rightLabel) {
  var joined = (title + " " + desc + " " + leftLabel + " " + rightLabel).toLowerCase();
  // 삭제·취소 키워드가 있으면 Destructive 성격으로 본다
  if (
    joined.indexOf("삭제") >= 0 ||
    joined.indexOf("취소") >= 0 ||
    joined.indexOf("삭제합니다") >= 0 ||
    joined.indexOf("취소합니다") >= 0
  ) {
    return true;
  }
  return false;
}

// ---------- 선택 스캔 (검사 탭) ----------

function scanSelection() {
  var selection = figma.currentPage.selection;
  if (selection.length !== 1) {
    figma.notify("하나의 모달만 선택해 주세요.");
    return {
      ok: false,
      reason: "selection",
    };
  }

  var root = selection[0];

  // 이름에 "Confirm" 같은 키워드가 들어가는지 정도만 체크
  var rootName = (root.name || "").toLowerCase();
  var componentType = "modal";
  var isToast = rootName.indexOf("toast") >= 0;
  var isModal =
    rootName.indexOf("modal") >= 0 ||
    rootName.indexOf("confirm") >= 0 ||
    rootName.indexOf("dialog") >= 0;

  if (isToast && !isModal) {
    componentType = "toast";
  } else {
    componentType = "modal";
  }

  var isSupportedComponent = componentType === "toast" ? isToast : isModal;

  // 기본 구조: Title / (Identifier) / Description / (Condition) / Button Container
  var titleNode = findTextByName(root, ["Title", "타이틀"]);
  var identifierNode = findTextByName(root, ["Identifier", "식별자"]);
  var descriptionNode = findTextByName(root, ["Description", "설명"]);
  var conditionNode = findTextByName(root, [
    "Condition",
    "Conditions",
    "조건",
  ]);

  var buttonNodes = resolveButtonTextNodes(root);
  var leftButtonLabel = getText(buttonNodes.left);
  var rightButtonLabel = getText(buttonNodes.right);

  var title = getText(titleNode);
  var identifier = getText(identifierNode);
  var description = getText(descriptionNode);
  var condition = getText(conditionNode);

  var hasIdentifier = identifier.length > 0;
  var hasCondition = condition.length > 0;

  var isDestructive = inferDestructiveByText(
    title,
    description,
    leftButtonLabel,
    rightButtonLabel
  );

  var subtype = "normal";
  if (componentType === "modal") {
    subtype = isDestructive ? "destructive" : "normal";
  } else if (componentType === "toast") {
    var joined = (title + " " + description).toLowerCase();
    if (
      joined.indexOf("성공") >= 0 ||
      joined.indexOf("완료") >= 0 ||
      joined.indexOf("저장") >= 0
    ) {
      subtype = "success";
    } else {
      subtype = "caution";
    }
  }

  return {
    ok: true,
    kind: componentType,
    subtype: subtype,
    componentSupported: isSupportedComponent,
    source: {
      title: title,
      identifier: identifier,
      description: description,
      condition: condition,
      leftButton: leftButtonLabel,
      rightButton: rightButtonLabel,
      hasIdentifier: hasIdentifier,
      hasCondition: hasCondition,
    },
  };
}

// ---------- 제안 적용 (적용하기 버튼) ----------

async function applySuggestions(payload) {
  var selection = figma.currentPage.selection;
  if (selection.length !== 1) {
    figma.notify("하나의 모달만 선택해 주세요.");
    return;
  }
  var root = selection[0];
  var sug = payload || {};

  function setTextIfNode(node, text) {
    if (node && node.type === "TEXT" && typeof text === "string") {
      try {
        node.characters = text;
      } catch (e) {
        // 폰트 로드 문제 등 있을 수 있음
      }
    }
  }

  var titleNode = findTextByName(root, "Title");
  var identifierNode = findTextByName(root, "Identifier");
  var descriptionNode = findTextByName(root, "Description");
  var conditionNode = findTextByName(root, "Condition");

  var buttonNodes = resolveButtonTextNodes(root);
  var leftBtnTextNode = buttonNodes.left;
  var rightBtnTextNode = buttonNodes.right;

  await ensureFonts([
    titleNode,
    identifierNode,
    descriptionNode,
    conditionNode,
    leftBtnTextNode,
    rightBtnTextNode,
  ]);

  if (typeof sug.title === "string" && sug.title.length > 0) {
    setTextIfNode(titleNode, sug.title);
  }
  if (typeof sug.identifier === "string") {
    setTextIfNode(identifierNode, sug.identifier);
  }
  if (typeof sug.description === "string" && sug.description.length > 0) {
    setTextIfNode(descriptionNode, sug.description);
  }
  if (typeof sug.condition === "string") {
    setTextIfNode(conditionNode, sug.condition);
  }
  if (typeof sug.leftButton === "string" && leftBtnTextNode) {
    setTextIfNode(leftBtnTextNode, sug.leftButton);
  }
  if (typeof sug.rightButton === "string" && rightBtnTextNode) {
    setTextIfNode(rightBtnTextNode, sug.rightButton);
  }

  figma.notify("제안된 텍스트를 적용했습니다.");
}

// ---------- AI 텍스트 추천 (Gemini / GAS) ----------

var GAS_URL =
  "https://script.google.com/macros/s/AKfycby6zxXrifw94HGa1c9LoXN5IKVOLzl3CBeNbMws3_Xc4f7VUTapCoq655FVjxjpWHR4/exec";
var SPELLCHECK_ENDPOINTS = [
  "https://speller.town",
  "http://localhost:3000",
];
var SPELLCHECK_HANSPELL_URL = "https://speller.cs.pusan.ac.kr/results";
var SPELLCHECK_TIMEOUT = 12000;
var SPELLCHECK_API_DELAY = 400;
var SPELLCHECK_API_COOLDOWN = 60000;
var spellcheckApiBlockedUntil = 0;

function fetchWithTimeout(url, options, timeout) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () {
      reject(new Error("요청 시간이 초과되었습니다."));
    }, timeout);

    fetch(url, options)
      .then(function (response) {
        clearTimeout(timer);
        resolve(response);
      })
      .catch(function (err) {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function delay(ms) {
  if (!ms || ms <= 0) {
    return Promise.resolve();
  }
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

function detectStandaloneConsonantErrors(text) {
  if (!text) return [];
  var regex = /[ㄱ-ㅎ]+/g;
  var matches = [];
  var match;
  while ((match = regex.exec(text)) !== null) {
    if (!match[0]) continue;
    matches.push({
      error: match[0],
      suggestion: "",
      help: "한글 자음만 단독으로 입력되었습니다. 단어를 완성해 주세요.",
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return matches;
}

function detectSpacingIssues(text) {
  var issues = [];
  if (!text) return issues;
  var regex = /([가-힣0-9]+)중/g;
  var allowedNextPrefixes = [
    "",
    " ",
    "\n",
    "\t",
    "이",
    "입",
    "엔",
    "에",
    "은",
    "는",
    "을",
    "의",
    "와",
    "과",
    "만",
    "부터",
    "까지",
    "이며",
    "이고",
    "이라",
    "이라고",
    "이라서",
    "이라면",
    "이라도",
    "이기",
    "이면",
    "인데",
    "인 ",
    "이나",
    "인,"
  ];
  var punctuation = ".,!?)/:;…";
  var match;
  while ((match = regex.exec(text)) !== null) {
    var prefix = match[1];
    if (!prefix) continue;
    var immediateNext = text.slice(regex.lastIndex, regex.lastIndex + 6);
    var firstChar = immediateNext.charAt(0);
    var allowed = false;
    if (!firstChar) {
      allowed = true;
    } else if (/\s/.test(firstChar)) {
      allowed = true;
    } else if (punctuation.indexOf(firstChar) >= 0) {
      allowed = true;
    } else {
      for (var i = 0; i < allowedNextPrefixes.length; i++) {
        var token = allowedNextPrefixes[i];
        if (!token) continue;
        if (immediateNext.indexOf(token) === 0) {
          allowed = true;
          break;
        }
      }
    }
    if (!allowed) continue;
    var errorText = match[0];
    var suggestion = prefix + " 중";
    issues.push({
      error: errorText,
      suggestion: suggestion,
      help: "‘중’은 앞말과 띄어 써야 합니다.",
      start: match.index,
      end: match.index + errorText.length,
    });
  }
  return issues;
}

function newlineExtraLength(str) {
  if (!str) return 0;
  var extra = 0;
  for (var i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) === 10) {
      extra++;
    }
  }
  return extra;
}

function buildSpellcheckBatch(targets) {
  if (!targets || !targets.length) {
    return { text: "", ranges: [] };
  }
  var parts = [];
  var ranges = [];
  var crlfCursor = 0;

  function appendChunk(str) {
    parts.push(str);
    crlfCursor += str.length + newlineExtraLength(str);
  }

  for (var i = 0; i < targets.length; i++) {
    var prefix = "[[FIELD-" + i + "]]\n";
    appendChunk(prefix);
    var startCrlf = crlfCursor;
    var text =
      typeof targets[i].text === "string" ? targets[i].text : String(targets[i].text || "");
    appendChunk(text);
    var endCrlf = crlfCursor;
    ranges.push({
      index: i,
      startCrlf: startCrlf,
      endCrlf: endCrlf,
    });
    appendChunk("\n\n");
  }
  return {
    text: parts.join(""),
    ranges: ranges,
  };
}

function mapSpellcheckSuggestionsToFields(suggestions, targets, ranges) {
  var results = targets.map(function (target) {
    return {
      field: target.field,
      label: target.label,
      errors: [],
    };
  });
  if (!Array.isArray(suggestions) || !suggestions.length) {
    return results;
  }
  suggestions.forEach(function (item) {
    if (!item) return;
    var start = typeof item.start === "number" ? item.start : 0;
    var matchedRange = null;
    for (var i = 0; i < ranges.length; i++) {
      var range = ranges[i];
      if (start >= range.startCrlf && start < range.endCrlf) {
        matchedRange = range;
        break;
      }
    }
    if (!matchedRange) return;
    var result = results[matchedRange.index];
    if (!result) return;
    var errorText = (item.text || item.error || "").trim();
    if (!errorText || errorText.indexOf("[[FIELD-") >= 0) return;
    var suggestionText = "";
    if (Array.isArray(item.candidates)) {
      suggestionText = item.candidates.join(", ");
    } else if (item.cand_word || item.candWord) {
      suggestionText = String(item.cand_word || item.candWord)
        .split("|")
        .join(", ");
    } else {
      suggestionText = item.suggestion || "";
    }
    result.errors.push({
      error: errorText,
      suggestion: suggestionText,
      help: item.description || item.help || "",
      start: 0,
      end: 0,
    });
  });
  return results;
}

function buildLocalAiSuggestion(prompt) {
  var summary = (prompt || "").trim();
  if (!summary) summary = "입력한 내용";
  var firstSentence = summary.split(/[,，.。!?]/)[0] || summary;
  var trimmed = firstSentence.trim();
  if (!trimmed) trimmed = "입력한 내용";
  if (trimmed.length > 28) {
    trimmed = trimmed.slice(0, 28) + "...";
  }
  return {
    title: trimmed + "을(를) 다시 확인해 주세요.",
    identifier: "",
    description: summary + "에 대한 안내가 필요해요.",
    condition: "",
    leftButton: "취소",
    rightButton: "확인",
    subtype: "normal",
  };
}

async function callAiSuggest(prompt) {
  if (!prompt || !prompt.trim()) {
    return {
      ok: false,
      error: "상황 설명을 입력해 주세요.",
    };
  }

  try {
    var resp = await fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt }),
    });

    if (!resp.ok) {
      throw new Error("AI 서버 응답 오류(" + resp.status + ")");
    }

    var data = await resp.json();

    return {
      ok: true,
      suggestion: {
        title: data.title || "",
        identifier: data.identifier || "",
        description: data.description || "",
        condition: data.condition || "",
        leftButton: data.leftButton || "",
        rightButton: data.rightButton || "",
        subtype: data.subtype || "normal",
      },
    };
  } catch (e) {
    return {
      ok: true,
      fallback: true,
      notice: "AI 서버 연결이 불안정하여 로컬 추천을 제공합니다.",
      suggestion: buildLocalAiSuggestion(prompt),
      error: "AI 호출 실패: " + e.message,
    };
  }
}

async function callSpellerApi(endpoint, text) {
  var resp = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: text }),
    },
    SPELLCHECK_TIMEOUT
  );
  if (!resp.ok) {
    var error = new Error("맞춤법 서버 응답 오류(" + resp.status + ")");
    error.status = resp.status;
    throw error;
  }
  return resp.json();
}

async function spellCheckTextWithApi(text) {
  if (spellcheckApiBlockedUntil && Date.now() < spellcheckApiBlockedUntil) {
    throw new Error("맞춤법 서버가 잠시 사용 중지되었습니다.");
  }
  var endpoints = SPELLCHECK_ENDPOINTS.filter(function (url) {
    return typeof url === "string" && url.trim().length > 0;
  });
  if (!endpoints.length) {
    throw new Error("맞춤법 서버가 설정되지 않았습니다.");
  }
  var lastError = null;
  for (var i = 0; i < endpoints.length; i++) {
    var endpoint = endpoints[i];
    try {
      var data = await callSpellerApi(endpoint, text);
      var suggestions = Array.isArray(data && data.suggestions)
        ? data.suggestions
        : [];
      return suggestions.map(function (item) {
        var candidates = Array.isArray(item.candidates)
          ? item.candidates.join(", ")
          : "";
        return {
          error: item.text || "",
          suggestion: candidates,
          help: item.description || "",
          start: typeof item.start === "number" ? item.start : 0,
          end: typeof item.end === "number" ? item.end : 0,
        };
      });
    } catch (err) {
      lastError = err;
      if (err && err.status === 429) {
        spellcheckApiBlockedUntil = Date.now() + SPELLCHECK_API_COOLDOWN;
        break;
      }
    }
  }
  throw lastError || new Error("맞춤법 서버 연결에 실패했습니다.");
}

function parseHanspellData(html) {
  var match = html.match(/data = ([\s\S]*?);\s*var/);
  if (!match) {
    throw new Error("맞춤법 서버 응답을 해석할 수 없습니다.");
  }
  var dataStr = match[1].trim();
  if (dataStr.startsWith("eval")) {
    var evalMatch = dataStr.match(/eval\('(.+)'\)/);
    if (evalMatch) {
      dataStr = evalMatch[1];
    }
  }
  dataStr = dataStr
    .replace(/\\'/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/^'+|'+$/g, "");
  var parsed;
  try {
    parsed = JSON.parse(dataStr);
  } catch (e) {
    parsed = JSON.parse(dataStr.replace(/'/g, '"'));
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed;
}

async function spellCheckTextWithHanspell(text) {
  var resp = await fetchWithTimeout(
    SPELLCHECK_HANSPELL_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: "text1=" + encodeURIComponent(text),
    },
    SPELLCHECK_TIMEOUT
  );
  if (!resp.ok) {
    throw new Error("맞춤법 서버 응답 오류(" + resp.status + ")");
  }
  var html = await resp.text();
  var parsed = parseHanspellData(html);
  var errors = [];
  parsed.forEach(function (entry) {
    var list = [];
    if (Array.isArray(entry.errata_list)) list = list.concat(entry.errata_list);
    if (Array.isArray(entry.errata)) list = list.concat(entry.errata);
    list.forEach(function (err) {
      if (!err) return;
      var suggestion = err.cand_word || err.candWord || "";
      if (suggestion.indexOf("|") >= 0) {
        suggestion = suggestion.replace(/\|/g, ", ");
      }
      errors.push({
        error: err.org_str || err.orgStr || "",
        suggestion: suggestion,
        help: err.help || "",
        start: err.start || err.errorIdx || 0,
        end: err.end || err.errorIdx || 0,
      });
    });
  });
  return errors;
}


async function spellCheckFields(fields, onProgress) {
  var targets = [];
  for (var i = 0; i < fields.length; i++) {
    var field = fields[i];
    if (!field || !field.text) continue;
    targets.push({
      field: field.field,
      label: field.label,
      text: field.text,
    });
  }
  if (!targets.length) return [];
  try {
    return await spellCheckFieldsViaApi(targets, onProgress);
  } catch (apiError) {
    console.warn("Spellcheck API failed, falling back to Hanspell:", apiError);
    return await spellCheckFieldsViaHanspell(targets, onProgress);
  }
}

async function spellCheckFieldsViaApi(targets, onProgress) {
  var total = targets.length;
  var batch = buildSpellcheckBatch(targets);
  if (!batch.text) {
    return targets.map(function (target) {
      return { field: target.field, label: target.label, errors: [] };
    });
  }
  var suggestions = await spellCheckTextWithApi(batch.text);
  var results = mapSpellcheckSuggestionsToFields(
    suggestions,
    targets,
    batch.ranges
  );
  var mappedErrorFound = results.some(function (r) {
    return r.errors && r.errors.length > 0;
  });
  if (suggestions && suggestions.length > 0 && !mappedErrorFound) {
    throw new Error("맞춤법 결과를 필드에 매핑하지 못했습니다.");
  }
  for (var i = 0; i < results.length; i++) {
    var consonantErrors = detectStandaloneConsonantErrors(targets[i].text);
    var spacingErrors = detectSpacingIssues(targets[i].text);
    if (consonantErrors.length || spacingErrors.length) {
      results[i].errors = (results[i].errors || []).concat(consonantErrors, spacingErrors);
    }
  }
  if (typeof onProgress === "function") {
    try {
      onProgress(total, total);
    } catch (e) {
      // UI 업데이트 실패 시 무시
    }
  }
  return results;
}

async function spellCheckFieldsViaHanspell(targets, onProgress) {
  var results = [];
  var total = targets.length;
  for (var i = 0; i < targets.length; i++) {
    var target = targets[i];
    var errors = await spellCheckTextWithHanspell(target.text);
    var consonantErrors = detectStandaloneConsonantErrors(target.text);
    var spacingErrors = detectSpacingIssues(target.text);
    if (consonantErrors.length || spacingErrors.length) {
      errors = (errors || []).concat(consonantErrors, spacingErrors);
    }
    results.push({
      field: target.field,
      label: target.label,
      errors: errors,
    });
    if (typeof onProgress === "function") {
      try {
        onProgress(i + 1, total, target);
      } catch (e) {
        // 무시
      }
    }
    if (i < targets.length - 1 && SPELLCHECK_API_DELAY > 0) {
      await delay(Math.max(200, SPELLCHECK_API_DELAY));
    }
  }
  return results;
}

// ---------- UI와 메시지 통신 ----------

figma.ui.onmessage = function (msg) {
  if (!msg || !msg.type) return;

  if (msg.type === "CHECK_SELECTION") {
    var result = scanSelection();
    figma.ui.postMessage({
      type: "CHECK_RESULT",
      payload: result,
    });
  }

  if (msg.type === "APPLY_SUGGESTIONS") {
    applySuggestions(msg.suggestion || {});
  }

  if (msg.type === "AI_SUGGEST") {
    (async function () {
      var aiResult = await callAiSuggest(msg.prompt || "");
      figma.ui.postMessage({
        type: "AI_SUGGEST_RESULT",
        payload: aiResult,
      });
    })();
  }

  if (msg.type === "SPELLCHECK_REQUEST") {
    (async function () {
      try {
        var fields = msg.fields || [];
        var totalTargets = 0;
        for (var i = 0; i < fields.length; i++) {
          var f = fields[i];
          if (f && f.text) totalTargets++;
        }
        if (totalTargets > 0) {
          figma.ui.postMessage({
            type: "SPELLCHECK_PROGRESS",
            payload: {
              completed: 0,
              total: totalTargets,
            },
          });
        }
        var spellResult = await spellCheckFields(fields, function (completed, total) {
          figma.ui.postMessage({
            type: "SPELLCHECK_PROGRESS",
            payload: {
              completed: completed,
              total: total,
            },
          });
        });
        figma.ui.postMessage({
          type: "SPELLCHECK_RESULT",
          payload: {
            ok: true,
            message: "맞춤법 검사가 완료되었습니다.",
            results: spellResult,
          },
        });
      } catch (e) {
        figma.ui.postMessage({
          type: "SPELLCHECK_RESULT",
          payload: {
            error: "맞춤법 검사에 실패했습니다: " + e.message,
          },
        });
      }
    })();
  }
};

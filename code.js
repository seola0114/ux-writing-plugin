// code.js
// -----------------------------
// Figma main plugin code
// -----------------------------

// 플러그인 UI 띄우기
figma.showUI(__html__, {
  width: 1200,
  height: 720,
});

// 플러그인 처음 켰을 때, 현재 선택 상태 한 번 보내주기
scanAndSendSelection();

// 선택이 바뀔 때마다 UI 쪽에 알려주고 싶으면 유지,
// 너무 시끄러우면 이 이벤트 리스너는 지워도 됨.
figma.on("selectionchange", () => {
  scanAndSendSelection("SELECTION_CHANGED");
});

// UI <-> 플러그인 메시지 핸들링
figma.ui.onmessage = (msg) => {
  if (!msg || typeof msg.type !== "string") return;

  switch (msg.type) {
    case "SCAN": {
      // UI에서 [검사하기] 눌렀을 때
      scanAndSendSelection();
      break;
    }

    case "APPLY_TEXTS": {
      // UI에서 [적용하기] 눌렀을 때
      applyTextsToSelection(msg.payload || {});
      break;
    }

    case "CLOSE": {
      figma.closePlugin();
      break;
    }

    default:
      // 기타 타입은 무시
      break;
  }
};

// -----------------------------
// 선택 분석 & 전송
// -----------------------------

function scanAndSendSelection(messageType = "SCAN_RESULT") {
  const selection = figma.currentPage.selection;
  const current = analyzeSelection(selection);

  figma.ui.postMessage({
    type: messageType,
    current,
  });
}

// selection → 모달 필드 구조로 변환
function analyzeSelection(selection) {
  const result = {
    kindLabel: "Confirm Modal", // 기본값
    title: "",
    identifier: "",
    description: "",
    condition: "",
    leftButton: "",
    rightButton: "",
  };

  if (!selection || selection.length === 0) {
    return result;
  }

  // 선택된 오브젝트에서 최상위 프레임 찾기
  const root = findRootFrame(selection[0]);
  if (!root || typeof root.findAll !== "function") {
    return result;
  }

  // 1) 프레임 이름/스타일 기반으로 Confirm / Destructive / Toast 추정
  const kind = guessKindFromFrame(root);
  result.kindLabel = kind;

  // 2) 텍스트 레이어 이름 규칙 기반으로 필드 추출
  //    - modal_title, Identifier, Description, Condition
  //    - 버튼은 left/right, cancel/확인/삭제 등 키워드로 구분
  const textNodes = root.findAll((n) => n.type === "TEXT");

  textNodes.forEach((node) => {
    const name = (node.name || "").toLowerCase();
    const text = node.characters || "";

    // Title
    if (/title/.test(name)) {
      result.title = text;
      return;
    }

    // Identifier
    if (/identifier/.test(name)) {
      result.identifier = text;
      return;
    }

    // Description
    if (/description/.test(name) || /body/.test(name)) {
      // identifier/condition 보다 우선순위 낮게
      if (!result.description) {
        result.description = text;
      }
      return;
    }

    // Condition
    if (/condition/.test(name)) {
      result.condition = text;
      return;
    }

    // Buttons
    if (/left/.test(name)) {
      result.leftButton = text;
      return;
    }
    if (/right/.test(name)) {
      result.rightButton = text;
      return;
    }

    // 이름이 애매한 경우 텍스트 내용으로 유추
    if (!result.leftButton && /(취소|cancel)/.test(text)) {
      result.leftButton = text;
      return;
    }
    if (
      !result.rightButton &&
      /(확인|저장|삭제|변경|적용)/.test(text)
    ) {
      result.rightButton = text;
      return;
    }
  });

  return result;
}

// 현재 노드에서 페이지 바로 아래까지 올라가며 최상위 프레임 찾기
function findRootFrame(node) {
  let cur = node;
  while (cur && cur.parent && cur.parent.type !== "PAGE") {
    cur = cur.parent;
  }
  return cur;
}

// 프레임 이름/색상 등을 보고 모달 종류 추정
function guessKindFromFrame(frame) {
  const name = (frame.name || "").toLowerCase();

  // 이름에 키워드가 있는 경우 우선
  if (name.includes("destructive")) return "Destructive Modal";
  if (name.includes("confirm")) return "Confirm Modal";
  if (name.includes("toast")) return "Toast";

  // 자식 버튼 레이어 중 "삭제" 같은 텍스트가 있는지 체크해서 Destructive 추정
  try {
    const textNodes = frame.findAll((n) => n.type === "TEXT");
    const hasDangerWord = textNodes.some((node) =>
      /(삭제|탈퇴|폐기|영구 삭제|되돌릴 수 없습니다)/.test(
        node.characters || ""
      )
    );
    if (hasDangerWord) return "Destructive Modal";
  } catch (e) {
    // findAll 실패해도 그냥 무시
  }

  // 기본값
  return "Confirm Modal";
}

// -----------------------------
// UI → Figma 적용
// -----------------------------

// payload: { title, identifier, description, condition, leftButton, rightButton }
function applyTextsToSelection(payload) {
  const selection = figma.currentPage.selection;

  if (!selection || selection.length === 0) {
    figma.notify("텍스트를 적용할 모달을 선택해 주세요.");
    return;
  }

  const root = findRootFrame(selection[0]);
  if (!root || typeof root.findAll !== "function") {
    figma.notify("선택한 오브젝트에서 텍스트 레이어를 찾을 수 없어요.");
    return;
  }

  const textNodes = root.findAll((n) => n.type === "TEXT");

  textNodes.forEach((node) => {
    // 폰트 미설치 등으로 수정 불가한 경우는 그냥 스킵
    if (node.locked) return;

    const name = (node.name || "").toLowerCase();
    let text = node.characters || "";

    // Title
    if (/title/.test(name)) {
      if (payload.title) node.characters = payload.title;
      return;
    }

    // Identifier
    if (/identifier/.test(name)) {
      if (payload.identifier !== undefined) {
        node.characters = payload.identifier;
      }
      return;
    }

    // Description
    if (/description/.test(name) || /body/.test(name)) {
      if (payload.description) node.characters = payload.description;
      return;
    }

    // Condition
    if (/condition/.test(name)) {
      if (payload.condition !== undefined) {
        node.characters = payload.condition;
      }
      return;
    }

    // Left / Right buttons (이름 기준)
    if (/left/.test(name)) {
      if (payload.leftButton) node.characters = payload.leftButton;
      return;
    }
    if (/right/.test(name)) {
      if (payload.rightButton) node.characters = payload.rightButton;
      return;
    }

    // 이름이 애매하면 텍스트 내용 기반으로 보정
    if (/(취소|cancel)/.test(text)) {
      if (payload.leftButton) node.characters = payload.leftButton;
      return;
    }
    if (/(확인|저장|삭제|변경|적용)/.test(text)) {
      if (payload.rightButton) node.characters = payload.rightButton;
      return;
    }
  });

  figma.notify("모달 텍스트가 적용되었습니다.");
}
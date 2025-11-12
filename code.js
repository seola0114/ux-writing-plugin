// ===== 설정 =====
const GAS_URL = "https://script.google.com/macros/s/AKfycbyRgWsC5Y243CQkbk8V4LInELwEup2mdXL1r1zBDTHPu82z-8zRgKY1dFkyS2eaBjK1/exec";

// ===== 유틸 =====
function norm(s){ return String(s||'').toLowerCase(); }
function ncontains(s, kw){ return norm(s).indexOf(norm(kw))>=0; }
function byVisible(nodes){ return (nodes||[]).filter(n => n.visible !== false); }
function isText(n){ return n && n.type === 'TEXT'; }
function txt(n){ try{ return n && isText(n) ? String(n.characters).trim() : ''; }catch(e){ return ''; } }
function anyDanger(str){ return /(삭제|제거|폐기|초기화|되돌릴 수 없|영구)/.test(String(str||'')); }
function endsWithPeriodKo(s){ return /[\.。]\s*$/.test(String(s||'')); } // 요구: 제목 끝 마침표 사용

function walk(node, fn){
  if(!node) return;
  fn(node);
  if(node.children){ node.children.forEach(ch => walk(ch, fn)); }
}
function findFirst(node, pred){
  let found=null;
  walk(node, n => { if(found) return; if(pred(n)) found = n; });
  return found;
}
function findByName(node, name, exact=false){
  const target = norm(name);
  return findFirst(node, n => {
    const nm = norm(n.name||'');
    return exact ? (nm === target) : nm.indexOf(target)>=0;
  });
}
function findInGroup(parent, groupName, childName){
  const group = findByName(parent, groupName);
  if(!group) return null;
  return childName ? findByName(group, childName) : group;
}

// 버튼 텍스트 추출(왼→오)
function extractButtons(sel){
  // 기본 컨테이너 우선
  let wrap = findByName(sel, 'modal_button') || findByName(sel, 'button container');
  let btnTexts = [];
  if(wrap && wrap.children){
    wrap.children.forEach(ch => {
      // Buttons/Normal, Buttons/Destructive 아래 텍스트
      const t = findFirst(ch, isText);
      if(t && (t.visible !== false)) btnTexts.push({ node:t, text:txt(t), parent:ch });
    });
  } else {
    // 최후: 선택 영역에서 가장 아래 텍스트 1~2개
    let texts=[]; walk(sel, n=>{ if(isText(n) && n.visible !== false) texts.push(n); });
    texts.sort((a,b)=>(a.y||0)-(b.y||0));
    if(texts.length>=2) btnTexts = [{node:texts[texts.length-2], text:txt(texts[texts.length-2]), parent:texts[texts.length-2].parent},{node:texts[texts.length-1], text:txt(texts[texts.length-1]), parent:texts[texts.length-1].parent}];
    else if(texts.length===1) btnTexts = [{node:texts[0], text:txt(texts[0]), parent:texts[0].parent}];
  }

  // 숨김 제거
  btnTexts = btnTexts.filter(b => b.text);

  // 1개면 무조건 오른쪽 버튼로 간주
  if(btnTexts.length<=1){
    return { left:null, right: btnTexts[0]||null, count: (btnTexts[0]?1:0) };
  }
  // 2개 이상 → 좌/우
  return { left: btnTexts[0], right: btnTexts[btnTexts.length-1], count: btnTexts.length };
}

// ===== 선택 스캔 =====
function scanSelection(){
  const sel = figma.currentPage.selection[0];
  if(!sel){ figma.notify('선택한 컴포넌트가 없습니다.'); return; }

  // Title: modal_title 아래 텍스트 > 없으면 가장 상단 텍스트
  const titleNode = findInGroup(sel, 'modal_title') ? findFirst(findInGroup(sel,'modal_title'), isText) : null;
  let title = txt(titleNode);
  if(!title){
    // 후보: 최상단 텍스트 1개
    let texts=[]; walk(sel, n=>{ if(isText(n) && n.visible !== false) texts.push(n); });
    texts.sort((a,b)=>(a.y||0)-(b.y||0));
    if(texts.length) { title = txt(texts[0]); }
  }

  // Identifier/Description: 반드시 text 그룹 내부만 유효
  const textGroup = findByName(sel, 'text', true) || findByName(sel, 'text');
  const identifierNode = textGroup ? findByName(textGroup,'identifier',true) : null;
  const descriptionNode = textGroup ? findByName(textGroup,'description',true) : null;

  const identifier = txt(identifierNode);
  const description = txt(descriptionNode);

  // Condition: Conditions 그룹(불릿 1~N줄)
  let condition = '';
  const condGroup = findByName(sel, 'conditions', true) || findByName(sel, 'condition');
  if(condGroup){
    let lines=[];
    condGroup.children && condGroup.children.forEach(ch=>{
      const t = findFirst(ch, isText);
      const s = txt(t);
      if(s) lines.push(s);
    });
    condition = lines.join('\n');
  }

  // 버튼
  const { left, right, count } = extractButtons(sel);
  const leftText  = left ? left.text : '';
  const rightText = right ? right.text : '';

  // 스타일(오른쪽)
  let rightStyleName = '';
  try{
    const p = right ? right.parent : null;
    if(p && typeof p.fillStyleId === 'string'){
      const st = figma.getStyleById(p.fillStyleId);
      rightStyleName = st && st.name ? st.name : '';
    } else if (p && p.name && /destructive/i.test(p.name)) {
      rightStyleName = 'Destructive';
    }
  }catch(e){}

  const current = {
    title, identifier, description, condition,
    leftButton:leftText, rightButton:rightText,
    buttonCount:count, rightStyleName,
    errors:{}
  };

  // ===== 컴포넌트 유형 추정 =====
  const detected = guessKind({ title, description, leftText, rightText, buttonCount:count, rightStyleName });
  const kindLabel = detected.label;

  // ===== 룰 검사(텍스트/구조) =====
  const errors = {};
  if(!endsWithPeriodKo(title)){ errors.title = '제목 끝에 마침표를 사용합니다.'; }
  if(!description){ errors.description = '본문(Description)이 필요합니다.'; }
  // Identifier/Condition은 선택적 → 없으면 왼쪽 카드에서 disabled 처리
  if(detected.key==='delete' && !anyDanger(rightText) && !/destructive/i.test(rightStyleName)){
    errors.rightButton = '파괴적 작업은 빨간색 버튼 또는 “삭제/제거/폐기” 등의 동사 사용을 권장합니다.';
  }
  if(count===2 && !leftText){ errors.leftButton = '좌측 버튼 텍스트가 비어 있습니다.'; }

  current.errors = errors;

  // ===== 제안 생성 =====
  const suggest = buildSuggest(detected.key, { title, description, identifier, condition, leftText, rightText });

  // ===== 뱃지(상태) =====
  const badges = [];
  badges.push({ level:'ok', text: kindLabel });
  badges.push({ level: identifier ? 'ok':'warn', text: identifier ? 'Identifier 있음' : 'Identifier 없음' });
  badges.push({ level: description ? 'ok':'fail', text: description ? 'Description 있음' : 'Description 없음' });
  badges.push({ level: condition ? 'ok':'warn', text: condition ? 'Condition 있음' : 'Condition 없음' });
  badges.push({ level: (count<=1)?'ok':'ok', text: (count<=1)?'Right btn 활성':'Left/Right 활성' });

  // UI로 전달
  figma.ui.postMessage({
    type:'SCAN_RESULT',
    current,
    suggest,
    errors,
    badges,
    kindLabel,
    recKindLabel: suggest.kindLabel
  });
}

function guessKind(info){
  const dangerByUI = /destructive|danger|error|red/i.test(info.rightStyleName||'');
  const dangerByText = anyDanger(info.title) || anyDanger(info.description) || anyDanger(info.rightText);
  if (dangerByUI || dangerByText){
    return { key:'delete', label:'Destructive Modal' };
  }
  if (info.buttonCount<=1){
    return { key:'alert', label:'Alert Modal' };
  }
  return { key:'confirm', label:'Confirm Modal' };
}

function ensurePeriod(s){
  s = String(s||'').trim();
  return endsWithPeriodKo(s) ? s : (s + '.');
}
function buildSuggest(kind, cur){
  let title = cur.title, desc = cur.description, ident = cur.identifier, cond = cur.condition;
  let left = cur.leftText, right = cur.rightText;
  let klabel = 'Confirm Modal';

  if(kind==='delete'){
    klabel = 'Destructive Modal';
    // 보수적으로 덮어쓰기
    title = ensurePeriod(title || '삭제하시겠어요');
    if(!/되돌릴 수 없|복구/.test(desc||'')) desc = '이 작업은 되돌릴 수 없습니다.';
    left = left || '취소'; right = right || '삭제';
  } else if (kind==='alert'){
    klabel = 'Alert Modal';
    title = ensurePeriod(title || '확인이 필요합니다');
    left = ''; right = right || '확인';
  } else {
    klabel = 'Confirm Modal';
    title = ensurePeriod(title || '확인이 필요합니다');
    left = left || '취소'; right = right || '확인';
  }

  return {
    kindLabel: klabel,
    title, identifier: ident || '', description: desc || '', condition: cond || '',
    leftButton: left, rightButton: right
  };
}

// ===== 적용 =====
function applySuggest(values){
  const sel = figma.currentPage.selection[0];
  if(!sel){ figma.notify('선택한 컴포넌트가 없습니다.'); return; }

  // 대상 노드 찾기
  const textGroup = findByName(sel, 'text', true) || findByName(sel,'text');
  const titleNode = findInGroup(sel,'modal_title') ? findFirst(findInGroup(sel,'modal_title'), isText) : null;
  const identNode = textGroup ? findByName(textGroup,'identifier',true) : null;
  const descNode  = textGroup ? findByName(textGroup,'description',true) : null;

  const condGroup = findByName(sel, 'conditions', true) || findByName(sel, 'condition');

  const { left, right } = extractButtons(sel);
  // 제목
  if(titleNode && values.title!=null){ try{ titleNode.characters = String(values.title); }catch(e){} }
  // Identifier
  if(identNode && values.ident!=null){ try{ identNode.characters = String(values.ident); }catch(e){} }
  // Description
  if(descNode && values.desc!=null){ try{ descNode.characters = String(values.desc); }catch(e){} }
  // Condition (여러 줄 → 각 줄을 기존 line 수 만큼만 덮어쓰기; 부족/초과는 무시)
  if(condGroup && values.cond!=null){
    const lines = String(values.cond).split(/\n/).map(s=>s.trim()).filter(Boolean);
    let idx=0;
    condGroup.children && condGroup.children.forEach(ch=>{
      if(idx>=lines.length) return;
      const t = findFirst(ch, isText);
      try{ if(t) t.characters = lines[idx]; }catch(e){}
      idx++;
    });
  }
  // 버튼
  if(left && values.left!=null){ try{ left.node.characters = String(values.left); }catch(e){} }
  if(right && values.right!=null){ try{ right.node.characters = String(values.right); }catch(e){} }

  figma.notify('제안 텍스트가 적용되었습니다.');
  scanSelection(); // 새로고침
}

// ===== AI (GAS 프록시) =====
async function runAI(prompt){
  try{
    const res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    const text = await res.text();
    figma.ui.postMessage({ type:'AI_RESULT', text });
  }catch(e){
    figma.ui.postMessage({ type:'AI_RESULT', text: 'AI 호출 실패: ' + (e&&e.message||'') });
  }
}

// ===== UI 핸들러 =====
figma.showUI(__html__, { width: 930, height: 660 });
figma.ui.onmessage = async (msg)=>{
  if(!msg) return;
  if(msg.type==='RESET'){ /* 상태 리셋만 */ }
  if(msg.type==='RUN_SCAN'){ scanSelection(); }
  if(msg.type==='APPLY_SUGGEST'){ applySuggest(msg.values||{}); }
  if(msg.type==='RUN_AI'){ runAI(msg.prompt||''); }
};
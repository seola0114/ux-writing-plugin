// ===== UX Writing Lint – Modal/Toast Helper (Full) =====
// - No optional chaining (Figma validator 우회)
// - GAS 호출은 text/plain으로 프리플라이트 회피
// - Caution/Info는 Confirm으로 강제, Right 기본값은 "확인"

var SERVER_URL = "https://script.google.com/macros/s/AKfycbwStqaWb2FsmG3DW9YhSRfpZbVoWMrc0e6nwsO8v4S_NywFd1y5Xw68OKPDs6opbWGe/exec";

figma.showUI(__html__, { width: 720, height: 680 });

/* ===================== 유틸 ===================== */
function isText(n){ return n && n.type === "TEXT"; }
function visible(n){ return !n || n.visible !== false; }
function nameOf(n){ return (n && n.name) ? n.name : ""; }
function lower(s){ return (s || "").toLowerCase(); }
function isFrameLike(n){
  if(!n) return false;
  var t = n.type;
  return t==="FRAME"||t==="GROUP"||t==="COMPONENT"||t==="INSTANCE"||t==="SECTION"||t==="COMPONENT_SET"||t==="PAGE";
}
function collectAll(n, arr){
  if(!n) return;
  arr.push(n);
  if(n.children){
    for(var i=0;i<n.children.length;i++){ collectAll(n.children[i], arr); }
  }
}
function collectTextNodes(root, out){
  if(!root) return;
  if(isText(root) && visible(root)) out.push(root);
  if(root.children){
    for(var i=0;i<root.children.length;i++){ collectTextNodes(root.children[i], out); }
  }
}
function findFirst(root, testFn){
  var all = []; collectAll(root, all);
  for(var i=0;i<all.length;i++){
    if(testFn(all[i])) return all[i];
  }
  return null;
}

/* ===================== 구조 추출 ===================== */
function extractModalFields(container){
  var f = {
    title: null,
    where: null,
    description: null,
    leftButton: { node:null, label:"", hidden:true },
    rightButton:{ node:null, label:"", hidden:true }
  };

  // 1) 이름 기반 탐색 (레이어 네임을 신뢰)
  var titleNode = findFirst(container, function(n){
    if(!isText(n)) return false;
    var pn = lower(nameOf(n.parent));
    var nn = lower(nameOf(n));
    return pn==="modal_title" || nn==="title" || nn==="modal_title";
  });
  if(titleNode) f.title = titleNode;

  var whereNode = findFirst(container, function(n){
    if(!isText(n)) return false;
    var nn = (n.characters||"").trim();
    return /[0-9]+행/.test(nn);
  });
  if(whereNode) f.where = whereNode;

  var descNode = null;
  // 우선 text 그룹/Description 명칭
  descNode = findFirst(container, function(n){
    if(!isText(n)) return false;
    var pn = lower(nameOf(n.parent));
    var nn = lower(nameOf(n));
    if(pn==="text" || pn==="description" || nn==="description") return true;
    return false;
  });
  // 못 찾으면 Title 제외한 다음 텍스트를 Description로 추정
  if(!descNode){
    var texts=[]; collectTextNodes(container, texts);
    var cands=[];
    for(var i=0;i<texts.length;i++){
      var t=texts[i];
      if(titleNode && t===titleNode) continue;
      var tx=(t.characters||"").trim();
      if(tx.length>0) cands.push({n:t,y:t.y});
    }
    if(cands.length>0){
      // y 오름차순
      cands.sort(function(a,b){ return (a.y||0)-(b.y||0); });
      descNode = cands[0].n;
    }
  }
  if(descNode) f.description = descNode;

  // 2) 버튼 탐색 (modal_button 아래 Buttons 그룹)
  var buttonRoot = null;
  if(container && container.children){
    for(var i=0;i<container.children.length;i++){
      if(lower(nameOf(container.children[i]))==="modal_button"){
        buttonRoot = container.children[i]; break;
      }
    }
  }
  function grabFirstText(node){
    if(!node) return null;
    var tnode = findFirst(node, function(n){ return isText(n) && visible(n); });
    return tnode;
  }

  if(buttonRoot && buttonRoot.children && buttonRoot.children.length){
    var groups=[];
    for(var j=0;j<buttonRoot.children.length;j++){
      if(lower(nameOf(buttonRoot.children[j]))==="buttons"){
        groups.push(buttonRoot.children[j]);
      }
    }
    if(groups.length===1){
      // 단일 버튼 → Right로 간주
      var r = grabFirstText(groups[0]);
      if(r){
        f.rightButton.node = r;
        f.rightButton.label = r.characters||"";
        f.rightButton.hidden = !visible(r);
      }
    }else if(groups.length>=2){
      var l = grabFirstText(groups[0]);
      if(l){
        f.leftButton.node = l;
        f.leftButton.label = l.characters||"";
        f.leftButton.hidden = !visible(l);
      }
      var r2 = grabFirstText(groups[1]);
      if(r2){
        f.rightButton.node = r2;
        f.rightButton.label = r2.characters||"";
        f.rightButton.hidden = !visible(r2);
      }
    }
  }else{
    // fallback: 텍스트 중 '취소'와 '확인' 가장 오른쪽 라벨을 버튼으로 추정
    var texts=[]; collectTextNodes(container, texts);
    var rightCandidate=null, leftCandidate=null;
    for(var k=0;k<texts.length;k++){
      var tx=(texts[k].characters||"").trim();
      if(tx==="확인"){
        if(!rightCandidate || texts[k].x > rightCandidate.x) rightCandidate=texts[k];
      }
      if(tx==="취소"){
        if(!leftCandidate || texts[k].x < leftCandidate.x) leftCandidate=texts[k];
      }
    }
    if(rightCandidate){
      f.rightButton.node=rightCandidate;
      f.rightButton.label=rightCandidate.characters||"";
      f.rightButton.hidden=!visible(rightCandidate);
    }
    if(leftCandidate){
      f.leftButton.node=leftCandidate;
      f.leftButton.label=leftCandidate.characters||"";
      f.leftButton.hidden=!visible(leftCandidate);
    }
  }

  return f;
}

/* ===================== 로컬 Lint & 추천 ===================== */
function localLint(f){
  var items=[];
  function add(name,o,s,reason,bad){ items.push({name:name,original:o,suggested:s,reason:reason,bad:bad}); }

  if(f.title){
    var t=f.title.characters||"";
    var tBad = t && !/[.!?？!]$/.test(t);
    add("Title", t, tBad ? (t+".") : t, tBad?"문장형은 마침표":"", tBad);
  }
  if(f.description){
    var d=f.description.characters||"";
    var dBad = d && !/[.!?？!]$/.test(d) && !/[:,\n]/.test(d);
    add("Description", d, dBad ? (d+".") : d, dBad?"문장형은 마침표":"", dBad);
  }
  if(f.leftButton.hidden){ add("Left button","없음","없음","",false); }
  else { add("Left button", f.leftButton.label, f.leftButton.label, "", false); }

  // Right 버튼 없으면 기본 '확인'
  if(f.rightButton.node){ add("Right button", f.rightButton.label, f.rightButton.label, "", false); }
  else { add("Right button","확인","확인","기본값",false); }

  return items;
}

// 주의/정보(불가/실패/주의/없습니다/재시도 등)는 Confirm으로 강제
function decideRec(f){
  var t=(f.title && f.title.characters)?f.title.characters:"";
  var hasLeft = f.leftButton && !f.leftButton.hidden && f.leftButton.label;
  var hasRight = f.rightButton && !f.rightButton.hidden && f.rightButton.label;

  var caution = /불가|실패|주의|없습니다|할 수 없습니다|재시도|안내|정보/i.test(t);
  if(caution) return "confirm";

  if(hasLeft && hasRight && /삭제|해지|파기/i.test(t)) return "delete";
  if(hasLeft && hasRight) return "confirm";
  return "confirm";
}

function buildPreview(f){
  return {
    title: (f.title && f.title.characters)?f.title.characters:"타이틀",
    description: (f.description && f.description.characters)?f.description.characters:"설명",
    where: (f.where && f.where.characters)?f.where.characters:"",
    leftLabel: (f.leftButton.hidden ? "없음" : (f.leftButton.label||"")),
    rightLabel: (f.rightButton.label||"확인"),
    leftHidden: !!f.leftButton.hidden
  };
}

/* ===================== 폰트 로딩 후 적용 ===================== */
async function loadFontsForNodes(nodes){
  var need = [];
  for(var i=0;i<nodes.length;i++){
    var n=nodes[i];
    if(!n || !isText(n)) continue;
    try{
      var fn = n.fontName; // 단일 스타일 가정 (플러그인 텍스트는 대부분 단일)
      if(fn && fn.family && fn.style){
        var key = fn.family+"__"+fn.style;
        need.push({family:fn.family, style:fn.style, key:key});
      }
    }catch(e){
      // mixed인 경우 전체 범위 로딩 (가장 무난하게 SUIT Variable Regular/Bold/ExtraBold 시도)
      need.push({family:"SUIT Variable", style:"Regular", key:"SUIT Variable__Regular"});
      need.push({family:"SUIT Variable", style:"Bold", key:"SUIT Variable__Bold"});
      need.push({family:"SUIT Variable", style:"ExtraBold", key:"SUIT Variable__ExtraBold"});
    }
  }
  // dedup
  var map={}; var uniq=[];
  for(var j=0;j<need.length;j++){ if(!map[need[j].key]){ map[need[j].key]=1; uniq.push(need[j]); } }
  for(var k=0;k<uniq.length;k++){
    try{ await figma.loadFontAsync({family:uniq[k].family, style:uniq[k].style}); }catch(e){}
  }
}

async function applySuggestions(list){
  var sel = figma.currentPage.selection[0];
  if(!sel) { figma.ui.postMessage({type:"applied",count:0}); return; }
  var f = extractModalFields(sel);
  var pairs=[];
  for(var i=0;i<(list||[]).length;i++){
    var it=list[i]; var t=it.text;
    if(it.name==="Title" && f.title){ pairs.push({node:f.title, text:t}); }
    if(it.name==="Description" && f.description){ pairs.push({node:f.description, text:t}); }
    if(it.name==="Left button" && f.leftButton.node){ pairs.push({node:f.leftButton.node, text:t}); }
    if(it.name==="Right button" && f.rightButton.node){ pairs.push({node:f.rightButton.node, text:t}); }
  }
  await loadFontsForNodes(pairs.map(function(p){return p.node;}));
  var count=0;
  for(var j=0;j<pairs.length;j++){
    try{ pairs[j].node.characters = pairs[j].text; count++; }catch(e){}
  }
  figma.ui.postMessage({type:"applied",count:count});
}

/* ===================== 선택 분석 ===================== */
async function analyzeSelection(){
  figma.ui.postMessage({ type:"progress", text:"선택 영역 분석 중..." });

  var sel = figma.currentPage.selection[0];
  if(!sel || !isFrameLike(sel)){
    figma.ui.postMessage({ type:"analysis", error:"프레임/컴포넌트를 선택해 주세요." });
    return;
  }

  var f = extractModalFields(sel);
  var items = localLint(f);
  var rec = decideRec(f);
  var preview = buildPreview(f);

  // 결과 전송
  figma.ui.postMessage({
    type:"analysis",
    preview:preview,
    recommendation:rec,
    items:items,
    profile:{ scope:"선택 레이어" }
  });
}

/* ===================== 자유 입력 (AI) ===================== */
async function callAI(text){
  var payload = { text: text };
  var res = await fetch(SERVER_URL, {
    method:"POST",
    headers:{ "Content-Type":"text/plain" },
    body: JSON.stringify(payload)
  });
  var txt = await res.text();
  var data;
  try{ data = JSON.parse(txt); }catch(e){ data = { error: txt||String(e) }; }
  return data;
}

/* ===================== UI 통신 ===================== */
figma.ui.onmessage = function(msg){
  if(!msg || !msg.type) return;

  if(msg.type==="analyze-selected"){ analyzeSelection(); return; }
  if(msg.type==="apply"){ applySuggestions(msg.apply); return; }

  if(msg.type==="free-input"){
    var text = (msg.text||"").trim();
    if(!text){
      figma.ui.postMessage({
        type:"free-result",
        component:"confirm",
        title:"입력 문장이 없습니다.",
        description:"상황/문장을 입력해 주세요.",
        left:"취소", right:"확인", reasons:["빈 입력"]
      });
      return;
    }
    callAI(text).then(function(data){
      // caution/info라도 서버가 토스트로 줄 수 있으니 이쪽에서도 한 번 더 안전망
      var comp = (data && data.component) ? data.component : "confirm";
      if(/toast/i.test(comp)){ comp = "confirm"; }
      figma.ui.postMessage({
        type:"free-result",
        component: comp,
        title: (data && data.title) ? data.title : "확인이 필요한 모달입니다.",
        description: (data && data.description) ? data.description : "입력하신 상황을 기준으로 확인이 필요합니다.",
        left: (data && data.left) ? data.left : "취소",
        right: (data && data.right) ? data.right : "확인",
        reasons: (data && data.reasons) ? data.reasons : ["Apps Script 응답 · 목업"]
      });
    }).catch(function(e){
      figma.ui.postMessage({
        type:"free-result",
        component:"confirm",
        title:"AI 호출 실패",
        description:"네트워크 또는 서버 오류가 발생했습니다.",
        left:"취소", right:"확인",
        reasons:["오류: "+e]
      });
    });
  }
};

// 초기 핑
figma.ui.postMessage({ type:"hello", from:"plugin", msg:"plugin ready" });
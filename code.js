// =============== Utility ===============
function findTextByParentNames(node, keywords){ // ['title','description','설명' ...]
  var result = null;
  if (!node || !node.children) return result;
  for (var i=0;i<node.children.length;i++){
    var c = node.children[i];
    var nm = (c.name || '').toLowerCase();
    for (var k=0;k<keywords.length;k++){
      if (c.type === 'TEXT' && nm.indexOf(keywords[k]) >= 0) return c;
      if (!result && nm.indexOf(keywords[k]) >= 0){
        result = findFirstText(c);
        if (result) return result;
      }
    }
  }
  return result;
}
// single-name 호환용(기존 코드에서 호출)
function findTextByParentName(node, keyword){
  return findTextByParentNames(node, [String(keyword||'').toLowerCase()]);
}
function findFirstText(node){
  if (!node) return null;
  if (node.type === 'TEXT') return node;
  if (!node.children) return null;
  for (var i=0; i<node.children.length; i++){
    var f = findFirstText(node.children[i]);
    if (f) return f;
  }
  return null;
}
function getText(node){
  try { return node && node.characters ? String(node.characters).trim() : ''; }
  catch(e){ return ''; }
}
function colorToHex(fill){
  try{
    if (!fill || fill.type !== 'SOLID') return '';
    var r = Math.round((fill.color.r||0)*255);
    var g = Math.round((fill.color.g||0)*255);
    var b = Math.round((fill.color.b||0)*255);
    function h(n){ var s = n.toString(16); return (s.length===1?'0':'')+s; }
    return '#'+h(r)+h(g)+h(b);
  }catch(e){ return ''; }
}
function getRightButtonFillInfo(btnTextNode){
  var parent = btnTextNode ? btnTextNode.parent : null;
  var hex = '', styleName = '';
  if (parent && parent.fills && parent.fills.length){
    hex = colorToHex(parent.fills[0]);
  }
  if (parent && typeof parent.fillStyleId === 'string'){
    try{
      var st = figma.getStyleById(parent.fillStyleId);
      if (st && st.name) styleName = st.name;
    }catch(e){}
  }
  return { fill: hex, styleName: styleName };
}

// =============== Kind detection ===============
function isDestructiveText(s){
  if (!s) return false;
  // ‘취소/삭제’가 제목·본문·버튼에 포함되면 파괴적 작업으로 간주(업무 규칙)
  var kw = [
    '삭제','제거','폐기','초기화','영구','되돌릴 수 없',
    '취소','취소 처리','정산 취소','회계 전표 취소','삭제하시겠'
  ];
  s = String(s).replace(/\s+/g,'');
  for (var i=0;i<kw.length;i++) if (s.indexOf(kw[i])>=0) return true;
  return false;
}
function isAffirmativeText(s){
  if (!s) return false;
  return /(확인|저장|변경|적용|전송|승인|확정)/.test(String(s));
}
function isCancelText(s){
  if (!s) return false;
  return /(취소|닫기|아니요|아니오)/.test(String(s));
}
function guessKind(title, left, right, buttonCount, rightFill, styleName, desc){
  var destructive =
    isDestructiveText(title) || isDestructiveText(desc) ||
    /삭제|제거|폐기|초기화/.test(right || '');

  var dangerUI =
    (rightFill && rightFill.toLowerCase().startsWith('#d')) ||
    (styleName && /danger|error|red|destructive/i.test(styleName));

  if (destructive){
    return {key:'delete', label:'Delete modal', expectedButtons:2, shouldDanger:true, isDanger:dangerUI};
  }
  if (buttonCount <= 1){
    return {key:'alert', label:'Alert modal', expectedButtons:1, shouldDanger:false, isDanger:dangerUI};
  }
  return {key:'confirm', label:'Confirm modal', expectedButtons:2, shouldDanger:false, isDanger:dangerUI};
}

// =============== Text lint ===============
function lintText(title,desc,left,right,kindKey){
  var items = [];
  var sg = {title:'',desc:'',left:'',right:''};

  if (!title){
    items.push({level:'fail', message:'제목(Title)이 비어 있습니다.'});
    sg.title = '작업을 진행하시겠어요?';
  } else if (/[.!]$/.test(title)){
    items.push({level:'warn', message:'제목 끝에 마침표(.)는 사용하지 않습니다.'});
  }

  if (kindKey==='delete'){
    if (!/(되돌릴 수 없|복구|영구)/.test(String(desc||''))){
      items.push({level:'warn', message:'파괴적 작업은 “되돌릴 수 없음” 경고 문장을 권장합니다.'});
      if (!sg.desc) sg.desc = '이 작업은 되돌릴 수 없습니다.';
    }
  }

  if (kindKey==='delete'){
    if (!/(삭제|제거|폐기)/.test(String(right||''))){
      items.push({level:'fail', message:'오른쪽 버튼은 “삭제/제거/폐기” 등 명확한 동사형을 권장합니다.'});
      if (!sg.right) sg.right='삭제';
    }
    if (!isCancelText(left||'')){
      items.push({level:'warn', message:'왼쪽 버튼은 보조 동작(취소/닫기)을 권장합니다.'});
      if (!sg.left) sg.left='취소';
    }
  } else if (kindKey==='confirm'){
    if (!isAffirmativeText(right||'')){
      items.push({level:'warn', message:'오른쪽 버튼은 “확인/저장/변경/확정” 등 동사형을 권장합니다.'});
      if (!sg.right) sg.right='확인';
    }
    if (!isCancelText(left||'')){
      items.push({level:'warn', message:'왼쪽 버튼은 보조 동작(취소/닫기)을 권장합니다.'});
      if (!sg.left) sg.left='취소';
    }
  } else { // alert
    if (left) items.push({level:'warn', message:'Alert 유형은 보통 단일 버튼을 권장합니다.'});
    if (!right) sg.right='확인';
  }

  sg.title = sg.title || title || '';
  sg.desc  = sg.desc  || desc  || '';
  sg.left  = sg.left  || left  || '';
  sg.right = sg.right || right || '';

  return {items:items, suggest:sg};
}

// =============== Toast↔Modal suitability ===============
function normalize(str){ return String(str||'').replace(/\s+/g,' ').trim(); }
function countSentencesKo(str){
  str = normalize(str);
  if (!str) return 0;
  var m = str.match(/다\.|요\.|[\.!?…]+/g);
  return m ? m.length : 1;
}
function recommendBetterKind(detected, title, desc, left, right){
  var reasons = [];
  var recommend = null;
  var suggest = { title:'', desc:'', left:'', right:'' };

  var t = normalize(title) + (desc ? ' ' + normalize(desc) : '');
  var len = t.length;
  var sc  = countSentencesKo(t);

  // 기본 제안 문구 템플릿
  var templates = {
    'confirm': {
      title: '작업을 진행하시겠어요?',
      desc: '변경 내용을 저장하려면 확인을 눌러주세요.',
      left: '취소',
      right: '확인'
    },
    'delete': {
      title: '정말 삭제하시겠어요?',
      desc: '삭제한 내용은 되돌릴 수 없습니다.',
      left: '취소',
      right: '삭제'
    },
    'alert': {
      title: '작업이 완료되었습니다.',
      desc: '',
      left: '',
      right: '확인'
    },
    'toast-success': {
      title: '',
      desc: '작업이 완료되었습니다.',
      left: '',
      right: ''
    },
    'toast-caution': {
      title: '',
      desc: '입력이 필요합니다.',
      left: '',
      right: ''
    }
  };

  // ① 토스트 → 모달 추천
  if (detected && (detected.key==='toast-success' || detected.key==='toast-caution')){
    if (sc >= 2){
      recommend = 'confirm';
      reasons.push('토스트는 한 문장에 적합합니다. 문장 ' + sc + '개가 감지되었습니다.');
    }
    if (len > 80){
      if (!recommend) recommend = 'confirm';
      reasons.push('토스트는 80자 이하를 권장합니다. 현재 ' + len + '자입니다.');
    }
    if (/(확인해 주세요|입력해 주세요|다시 시도|변경하시겠어요|저장하시겠어요|취소하시겠어요)/.test(t)){
      if (!recommend) recommend = 'confirm';
      reasons.push('사용자 행동 유도 문구가 포함되어 있습니다 → 모달이 더 적합합니다.');
    }
  }

  // ② Confirm/Alert → Delete 모달 추천 (파괴적 작업 키워드)
  if (detected && (detected.key==='confirm' || detected.key==='alert')){
    if (/(삭제|제거|폐기|초기화|되돌릴 수 없)/.test(t) || /(삭제|제거|폐기|초기화)/.test(normalize(right))){
      recommend = 'delete';
      reasons.push('파괴적 작업 키워드가 감지되었습니다 → Delete Modal 권장.');
    }
  }

  // 추천이 없으면 기본적으로 현재 유형 유지
  if (!recommend && detected) recommend = detected.key;

  // 추천 유형에 맞는 제안 카피 채우기
  if (templates[recommend]) suggest = templates[recommend];

  return { recommend: recommend, reasons: reasons, suggest: suggest };
}

// =============== Selection read ===============
function readSelection(){
  var sel = figma.currentPage.selection && figma.currentPage.selection[0];
  if (!sel) return null;

  var titleNode = findTextByParentName(sel,'title') || findFirstText(sel);
  var descNode  = findTextByParentNames(sel, ['description','설명']); // “설명=Description” 동치

  // 버튼 컨테이너 탐색
  var btnWrap   = null;
  if (sel.children){
    for (var i=0;i<sel.children.length;i++){
      var n = sel.children[i];
      var nm = String(n.name||'').toLowerCase();
      if (nm.indexOf('button')>=0 || nm.indexOf('buttons')>=0){ btnWrap = n; break; }
    }
  }

  var leftNode=null, rightNode=null, btnCount=0;
  if (btnWrap && btnWrap.children){
    for (var j=0;j<btnWrap.children.length;j++){
      var t = findFirstText(btnWrap.children[j]);
      if (t){ btnCount++; if (!leftNode) leftNode=t; else rightNode=t; }
    }
  } else {
    var texts=[];
    (function collect(node){
      if (node.type==='TEXT') texts.push(node);
      if (node.children) for (var k=0;k<node.children.length;k++) collect(node.children[k]);
    })(sel);
    texts.sort(function(a,b){ return (a.y||0)-(b.y||0); });
    if (texts.length>=2){ leftNode = texts[texts.length-2]; rightNode = texts[texts.length-1]; btnCount=2; }
    else if (texts.length>=1){ rightNode = texts[texts.length-1]; btnCount=1; }
  }

  var title = getText(titleNode);
  var desc  = getText(descNode);
  var left  = getText(leftNode);
  var right = getText(rightNode);

  var rightUI = getRightButtonFillInfo(rightNode);

  return {
    titleText:title, descText:desc, leftText:left, rightText:right,
    buttonCount:btnCount,
    style:{ rightFill:rightUI.fill, rightStyleName:rightUI.styleName },
    nodes:{ titleNode:titleNode, descNode:descNode, leftNode:leftNode, rightNode:rightNode }
  };
}

// =============== Post results ===============
function buildDetectedKind(info){
  var kind = guessKind(
    info.titleText, info.leftText, info.rightText, info.buttonCount,
    info.style.rightFill, info.style.rightStyleName, info.descText
  );
  return {
    key: kind.key,
    label: kind.label,
    expectedButtons: kind.expectedButtons,
    isDanger: kind.isDanger,
    shouldDanger: kind.shouldDanger
  };
}
function postSelectionInfo(info){
  var kind = buildDetectedKind(info);
  var help =
    kind.key==='delete' ? '파괴적 작업 확인 모달입니다.' :
    kind.key==='confirm' ? '확인이 필요한 모달입니다.' :
    kind.key==='alert' ? '한 번에 알려주는 알림형 모달입니다.' :
    '컴포넌트 유형을 식별했습니다.';
  figma.ui.postMessage({
    type:'SELECTION_INFO',
    payload:{
      titleText:info.titleText, descText:info.descText, leftText:info.leftText, rightText:info.rightText,
      buttonCount:info.buttonCount,
      badge: kind.label, help: help,
      style: info.style,
      detected: kind
    }
  });
}

function runValidation(info){
  var kind = guessKind(
    info.titleText, info.leftText, info.rightText, info.buttonCount,
    info.style.rightFill, info.style.rightStyleName, info.descText
  );

  // ① 컴포넌트 적합성
  var comp = [];
  if (kind.key==='delete' && !kind.isDanger){
    comp.push({ level:'fail', message:'파괴적 작업입니다. 오른쪽 버튼에 Danger 스타일(빨간색)을 적용하고, Buttons/Destructive를 사용하세요.' });
  }
  if (kind.key!=='delete' && kind.isDanger){
    comp.push({ level:'warn', message:'위험(Danger) 스타일이 필요 없는 모달입니다. 기본/강조 버튼으로 낮추세요.' });
  }
  if (info.buttonCount!==kind.expectedButtons){
    comp.push({ level:'warn', message:'버튼 개수 권장값: '+kind.expectedButtons+'개 (현재 '+info.buttonCount+'개)' });
  }
  if (comp.length===0) comp.push({ level:'ok', message:'컴포넌트 사용이 적합합니다.' });

  // ② 텍스트 검사
  var textLint = lintText(info.titleText, info.descText, info.leftText, info.rightText, kind.key);

  // ③ 더 적합한 유형 추천(토스트/모달 교차)
  var rec = recommendBetterKind(
    {key:kind.key, label:kind.label},
    info.titleText, info.descText, info.leftText, info.rightText
  );

  figma.ui.postMessage({
    type:'VALIDATION_RESULT',
    result:{
      kind: kind.key,
      kindLabel: kind.label,
      buttonCount: info.buttonCount,
      comp: comp,
      text: textLint.items,
      suggest: textLint.suggest,
      recommend: rec
    }
  });
}

// =============== Bridge ===============
figma.ui.onmessage = function(msg){
  if (!msg) return;

  if (msg.type === 'REQUEST_SELECTION'){
    var info1 = readSelection();
    if (info1) postSelectionInfo(info1);
  }
  if (msg.type === 'RUN_VALIDATE'){
    var info2 = readSelection();
    if (info2) runValidation(info2);
  }
  if (msg.type === 'APPLY_FIELDS'){
    var info3 = readSelection(); if (!info3) return;
    var apply = msg.apply||{}, v = msg.values||{};
    function setText(node, val){
      if (node && val!=null){
        try{ node.characters = String(val); }catch(e){}
      }
    }
    if (apply.title) setText(info3.nodes.titleNode, v.title);
    if (apply.desc)  setText(info3.nodes.descNode,  v.desc);
    if (apply.left)  setText(info3.nodes.leftNode,  v.left);
    if (apply.right) setText(info3.nodes.rightNode, v.right);

    figma.notify('텍스트가 적용되었습니다.');
    var next = readSelection(); if (next) postSelectionInfo(next);
  }
  if (msg.type === 'CLOSE'){
    figma.closePlugin();
  }
};

// =============== Show UI ===============
figma.showUI(__html__, { width: 860, height: 680 });
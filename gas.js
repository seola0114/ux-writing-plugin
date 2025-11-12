function doPost(e) {
  try {
    const raw = e && e.postData ? (e.postData.contents || e.postData.getDataAsString()) : '';
    const req = raw ? JSON.parse(raw) : {};
    const text = (req.text || '').trim();
    if (!text) return json_({ error: 'text is required' }, 400);

    // 여기서 Gemini 호출 or 로컬 규칙 처리 …
    const out = { type: 'confirm', reasons: ['샘플'], suggestion: { title:'제목', description:'설명', left:'취소', right:'확인' } };
    return json_(out, 200);
  } catch (err) {
    return json_({ error: String(err) }, 500);
  }
}

function json_(obj, status) {
  // status는 Apps Script에서 직접 쓰진 못하지만, 응답은 반드시 JSON으로
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
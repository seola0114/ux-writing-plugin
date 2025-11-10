import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export default async function handler(req, res) {
  try {
    const body = await parseJSON(req);
    const texts = Array.isArray(body.texts) ? body.texts : [];

    const ko = (role) => {
      if (role === 'title') return '타이틀';
      if (role === 'where') return '행 위치';
      if (role === 'description') return '설명';
      if (role === 'left') return '왼쪽 버튼';
      if (role === 'right') return '오른쪽 버튼';
      return role;
    };

    const sys =
`너는 CJ대한통운 '정산/운송' 도메인의 UX Writing 어시스턴트야.
규칙:
- 문장형은 마침표로 끝나야 함. 단, 의문형(…?) 또는 목록/명사 나열은 마침표 예외.
- 버튼 1개면 '확인'만 가능. 버튼 2개면 Left=취소, Right=확정(파랑) 또는 삭제(빨강).
- 성공/완료/저장 등은 Toast-Success, 단순 안내/가벼운 실패는 Toast-Caution.
- 실패/정책/중요 확인 필요 시 Confirm Modal, 삭제/파괴적 작업은 Delete Modal.
- 오타/맞춤법도 교정.
반환 형식(JSON만):
{
 "suggestions":[{"role":"title|where|description|left|right","suggested":"문자열","reasons":["사유1","사유2"]}, ...],
 "component":{"type":"confirm|delete|toast-success|toast-caution"}
}
문자열 외 다른 설명은 쓰지 말고 JSON만 반환해.`;

    // 사용자가 보낸 텍스트 묶기
    var content = texts.map(function(t){
      return (ko(t.role)+": "+(t.text||""));
    }).join("\n");

    const r = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role:"system", content: sys },
        { role:"user", content: content }
      ],
      temperature: 0.2
    });

    var out = (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) ? r.choices[0].message.content : "{}";
    // 혹시 코드블록 제거
    out = out.replace(/^```(?:json)?/i, "").replace(/```$/i, "");

    var json;
    try { json = JSON.parse(out); }
    catch(e){ json = { suggestions: [], component: { type: "toast-caution" } }; }

    res.status(200).json(json);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}

function parseJSON(req){
  return new Promise((resolve, reject)=>{
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end", ()=> {
      try { resolve(JSON.parse(data || "{}")); }
      catch(e){ reject(e); }
    });
  });
}
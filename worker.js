// worker.js (ES Modules on Cloudflare Workers)
// 역할: Figma가 여기로 POST -> GAS로 그대로 프록시 -> CORS 헤더 붙여서 그대로 반환

const GAS_URL = "https://script.google.com/macros/s/AKfycbz9nTuL03wJ2AaQPumDI-98rw8utv3c0peP06s-lijdQty1sJ4n4z3hftrTatGGGXQG/exec";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
  async fetch(request, env, ctx) {
    // 1) Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // 2) 루트 POST만 프록시
    if (request.method === "POST") {
      let bodyText = "";
      try {
        bodyText = await request.text(); // JSON 원문 그대로
      } catch (e) {
        return new Response(JSON.stringify({ error: "Invalid body" }), {
          status: 400,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      // GAS로 전달
      const upstream = await fetch(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bodyText,
      });

      // GAS 응답을 그대로 되돌리되 CORS 헤더만 추가
      const respText = await upstream.text();
      const contentType =
        upstream.headers.get("content-type") || "application/json";
      return new Response(respText, {
        status: upstream.status,
        headers: { ...CORS, "Content-Type": contentType },
      });
    }

    // 3) 기타 메서드/GET
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  },
};
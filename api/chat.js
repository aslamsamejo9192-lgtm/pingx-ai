// Proxies Gemini chat streaming through the site's own server key.
// POST /api/chat { model, body } -> Google's :streamGenerateContent SSE,
// streamed back verbatim so the page's existing SSE parsing works unchanged.
// The key lives only in the GEMINI_API_KEY env var — never in the page.
// (Switched from Gemma to gemini-3.5-flash-lite 2026-11-10: Google returns
// 404 for all Gemma models on the Gemini API for this key.)
var ALLOWED_MODELS = [
  "gemini-3.5-flash-lite"
];
var SYSTEM_PROMPT = "You are PingX AI, a helpful AI assistant. Answer clearly and directly. Use markdown when it helps: short headings, bullet lists, tables for comparisons, and fenced code blocks for code. Match the language the user writes in.";

module.exports = async function (req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: { message: "Method not allowed." } });
    return;
  }
  var key = process.env.GEMINI_API_KEY;
  if (!key) {
    res.status(503).json({
      error: {
        code: "KEY_NOT_CONFIGURED",
        message: "The site's Gemini key isn't set up yet. The site owner needs to add GEMINI_API_KEY in the hosting settings."
      }
    });
    return;
  }
  var data = req.body || {};
  var model = data.model;
  if (ALLOWED_MODELS.indexOf(model) === -1) {
    res.status(400).json({ error: { message: "Unknown model." } });
    return;
  }
  var body = data.body || {};
  var contents = (body.contents || []).slice();
  var payload = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: contents,
    generationConfig: body.generationConfig || { temperature: 0.7, maxOutputTokens: 2048 }
  };
  var url = "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) + ":streamGenerateContent?alt=sse";
  try {
    var upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(payload)
    });
    if (!upstream.ok) {
      var errText = await upstream.text();
      res.status(upstream.status);
      res.setHeader("Content-Type", "application/json");
      res.send(errText);
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });
    var reader = upstream.body.getReader();
    for (;;) {
      var chunk = await reader.read();
      if (chunk.done) break;
      res.write(Buffer.from(chunk.value));
    }
    res.end();
  } catch (e) {
    if (!res.headersSent) {
      res.status(502).json({ error: { message: "Could not reach Google's API. Try again in a moment." } });
    } else {
      try { res.end(); } catch (_) {}
    }
  }
};

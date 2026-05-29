module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = await readBody(req);
    const reply = await createOpenAIResponse({
      model: process.env.OPENAI_MODEL || "gpt-4o",
      instructions: [
        body.prompt || `你正在扮演 ${body.characterName || "角色"}。`,
        "請嚴格遵守上方 prompt 的格式、角色限制與互動規則。",
        "不要替使用者說話，不要解釋角色設定，不要出現 AI 自我說明。"
      ].join("\n"),
      input: buildChatInput(body),
      max_output_tokens: 260
    });

    res.status(200).json({ reply });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "角色聊天失敗" });
  }
};

async function createOpenAIResponse(payload) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || "OpenAI API request failed");
  }

  return extractResponseText(data);
}

function buildChatInput(body) {
  const history = Array.isArray(body.context?.history) ? body.context.history.slice(-8) : [];
  const historyText = history
    .map(item => `${item.role === "me" ? "使用者" : body.characterName}: ${item.text}`)
    .join("\n");

  return [
    historyText ? `最近對話：\n${historyText}` : "",
    `使用者最新訊息：${body.message || ""}`,
    "請用角色口吻回覆。"
  ].filter(Boolean).join("\n\n");
}

function extractResponseText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("").trim();
}

function readBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    return JSON.parse(req.body || "{}");
  }

  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 100000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

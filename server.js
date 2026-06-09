const express = require("express");
const path = require("path");

require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 3001);
const ROOT = __dirname;
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const ALLOWED_MODELS = new Set([
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4.1",
  "gpt-4.1-mini"
]);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(ROOT, {
  extensions: ["html"],
  setHeaders(res, filePath) {
    if (filePath.endsWith(".js")) {
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    }
  }
}));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    defaultModel: DEFAULT_MODEL
  });
});

app.post("/api/comment-reply", async (req, res) => {
  try {
    const {
      characterId,
      characterPrompt,
      characterName,
      postText,
      userComment
    } = req.body || {};

    const reply = await createOpenAIResponse({
      model: DEFAULT_MODEL,
      instructions: `
${characterPrompt || ""}

你現在不是在普通聊天，而是在 Instagram 風格的角色貼文底下回覆留言。

規則：
- 你是「${characterName || characterId || "角色"}」，請用這個角色的語氣回覆。
- 回覆要像 IG 留言，不要太長。
- 1 到 3 句即可。
- 可以有曖昧、吐槽、吃醋、護短、冷淡、撒嬌等角色感。
- 不要像 AI，不要解釋你是 AI。
- 不要替使用者說話。
- 使用繁體中文。
      `,
      input: `
貼文內容：
${postText || ""}

使用者留言：
${userComment || ""}

請用「${characterName || characterId || "角色"}」的語氣回覆這則留言。
      `,
      max_output_tokens: 160
    });

    res.json({ reply });
  } catch (error) {
    console.error("comment reply failed:", error);
    res.status(500).json({ error: "角色留言回覆失敗" });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const body = req.body || {};
    const reply = await createOpenAIResponse({
      model: selectModel(body.model),
      instructions: buildChatInstructions(body),
      input: buildChatInput(body),
      max_output_tokens: 260
    });

    res.json({ reply });
  } catch (error) {
    console.error("chat failed:", error);
    res.status(500).json({ error: "角色聊天失敗" });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(ROOT, "index.html"));
});

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

function selectModel(model) {
  return ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL;
}

function buildChatInstructions(body) {
  return [
    body.prompt || `你正在扮演：${body.characterName || "角色"}`,
    "你正在進行沉浸式小說角色扮演。",
    "你不是客服，不是旁白機器，也不是普通聊天 AI。",
    "使用繁體中文。旁白、動作、心理描寫使用斜體字；角色說話使用粗體字。",
    "一次只回一小段，不要推進太多劇情。",
    "不要替使用者說話，不要自行加入重大事件，不要解釋角色設定。"
  ].join("\n");
}

function buildChatInput(body) {
  const history = Array.isArray(body.context?.history) ? body.context.history.slice(-10) : [];
  const historyText = history
    .map(item => `${item.role === "me" ? "使用者" : body.characterName || "角色"}：${item.text}`)
    .join("\n");

  return [
    historyText ? `最近對話：\n${historyText}` : "",
    `使用者訊息：\n${body.message || ""}`,
    `請用「${body.characterName || "角色"}」的語氣自然回覆。`
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

app.listen(PORT, () => {
  console.log(`JZ app running on port ${PORT}`);
});

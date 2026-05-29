const http = require("http");
const fs = require("fs");
const path = require("path");

try {
  require("dotenv").config();
} catch {
  loadEnvFile();
}

const PORT = Number(process.env.PORT || 3001);
const ROOT = __dirname;
const CHAT_MODEL = process.env.OPENAI_MODEL || "gpt-4o";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp"
};

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJSON(res, 200, {
      ok: true,
      openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
      model: CHAT_MODEL
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/comment-reply") {
    await handleCommentReply(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    await handleChat(req, res);
    return;
  }

  if (req.method !== "GET") {
    sendJSON(res, 405, { error: "Method not allowed" });
    return;
  }

  serveStatic(url.pathname, res);
});

async function handleCommentReply(req, res) {
  try {
    const {
      characterId,
      characterPrompt,
      characterName,
      postText,
      userComment
    } = await readJSON(req);

    const response = await createOpenAIResponse({
      model: "gpt-4o",
      instructions: `
${characterPrompt || ""}

你現在不是在普通聊天，而是在 Instagram 風格的角色貼文底下回覆留言。

規則：
- 你是「${characterName || characterId}」，請用這個角色的語氣回覆。
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

請用「${characterName || characterId}」的語氣回覆這則留言。
      `,
      max_output_tokens: 160
    });

    sendJSON(res, 200, {
      reply: response
    });
  } catch (error) {
    console.error(error);
    sendJSON(res, 500, {
      error: "角色留言回覆失敗"
    });
  }
}

async function handleChat(req, res) {
  try {
    const body = await readJSON(req);
    const response = await createOpenAIResponse({
      model: CHAT_MODEL,
      instructions: buildChatInstructions(body),
      input: buildChatInput(body),
      max_output_tokens: 220
    });

    sendJSON(res, 200, {
      reply: response
    });
  } catch (error) {
    console.error(error);
    sendJSON(res, 500, {
      error: "角色聊天失敗"
    });
  }
}

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

function buildChatInstructions(body) {
  return [
    body.prompt || `你正在扮演 ${body.characterName || "角色"}。`,
    "請嚴格遵守上方 prompt 的格式、角色限制與互動規則。",
    "不要替使用者說話，不要解釋角色設定，不要出現 AI 自我說明。"
  ].join("\n");
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

function readJSON(req) {
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

function serveStatic(pathname, res) {
  const safePath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = path.join(ROOT, safePath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream"
    });
    res.end(content);
  });
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJSON(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;

    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");

    if (key) {
      process.env[key] = value;
    }
  }
}

server.listen(PORT, () => {
  console.log(`JZ app running at http://localhost:${PORT}`);
});

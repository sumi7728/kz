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
    const {
      characterId,
      characterPrompt,
      characterName,
      postText,
      userComment
    } = await readBody(req);

    const reply = await createOpenAIResponse({
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
- 不要自行加入重大事件。
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

    res.status(200).json({ reply });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "角色留言回覆失敗" });
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

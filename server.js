const express = require("express");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 3001);
const ROOT = __dirname;
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const AVATAR_BUCKET = process.env.SUPABASE_AVATAR_BUCKET || "avatars";

app.use(express.json({ limit: "8mb" }));
app.use(express.static(ROOT, {
  extensions: ["html"],
  setHeaders(res, filePath) {
    if (filePath.endsWith(".js")) {
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    }
  }
}));

const supabase = createSupabaseClient();
let avatarBucketReady = false;

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    supabaseConfigured: Boolean(supabase),
    defaultModel: DEFAULT_MODEL
  });
});

app.post("/api/session", async (req, res) => {
  try {
    requireSupabase();
    const { userId, displayName, avatarDataUrl } = req.body || {};
    const profileId = cleanId(userId) || `anon_${crypto.randomUUID()}`;
    const name = normalizeText(displayName).slice(0, 40) || "匿名玩家";
    const avatarUrl = avatarDataUrl
      ? await uploadDataUrl(avatarDataUrl, `profiles/${profileId}`)
      : undefined;

    const payload = {
      id: profileId,
      display_name: name,
      updated_at: new Date().toISOString()
    };

    if (avatarUrl) {
      payload.avatar_url = avatarUrl;
    }

    const { data, error } = await supabase
      .from("profiles")
      .upsert(payload, { onConflict: "id" })
      .select("*")
      .single();

    if (error) throw error;
    res.json({ profile: data });
  } catch (error) {
    handleApiError(res, error, "匿名資料儲存失敗");
  }
});

app.get("/api/bootstrap", async (_req, res) => {
  try {
    requireSupabase();
    const [profiles, characters, posts, comments, replies] = await Promise.all([
      selectAll("profiles", "created_at", true),
      selectAll("characters", "created_at", false),
      selectAll("posts", "created_at", false),
      selectAll("comments", "created_at", true),
      selectAll("comment_replies", "created_at", true)
    ]);

    res.json({
      profiles,
      characters,
      posts: assemblePosts(posts, comments, replies)
    });
  } catch (error) {
    handleApiError(res, error, "資料讀取失敗");
  }
});

app.post("/api/characters", async (req, res) => {
  try {
    requireSupabase();
    const { ownerId, name, personality, appearance, speakingStyle, avatarDataUrl } = req.body || {};
    const owner_id = cleanId(ownerId);
    if (!owner_id) return res.status(400).json({ error: "缺少使用者 ID" });

    const avatar_url = avatarDataUrl
      ? await uploadDataUrl(avatarDataUrl, `characters/${owner_id}-${Date.now()}`)
      : "";

    const character = {
      owner_id,
      name: normalizeText(name).slice(0, 40) || "未命名 OC",
      personality: normalizeText(personality).slice(0, 800),
      appearance: normalizeText(appearance).slice(0, 800),
      speaking_style: normalizeText(speakingStyle).slice(0, 500),
      avatar_url,
      prompt: buildCharacterPromptText({ name, personality, appearance, speakingStyle })
    };

    const { data, error } = await supabase
      .from("characters")
      .insert(character)
      .select("*")
      .single();

    if (error) throw error;
    res.json({ character: data });
  } catch (error) {
    handleApiError(res, error, "OC 建立失敗");
  }
});

app.post("/api/posts", async (req, res) => {
  try {
    requireSupabase();
    const { authorId, characterId, text } = req.body || {};
    const author_id = cleanId(authorId);
    if (!author_id) return res.status(400).json({ error: "缺少使用者 ID" });
    if (!characterId) return res.status(400).json({ error: "請選擇要標記的 OC" });

    const { data, error } = await supabase
      .from("posts")
      .insert({
        author_id,
        character_id: characterId,
        text: normalizeText(text).slice(0, 1200)
      })
      .select("*")
      .single();

    if (error) throw error;
    res.json({ post: { ...data, comments: [] } });
  } catch (error) {
    handleApiError(res, error, "貼文發布失敗");
  }
});

app.post("/api/comments", async (req, res) => {
  try {
    requireSupabase();
    const { postId, authorId, text } = req.body || {};
    const author_id = cleanId(authorId);
    if (!postId || !author_id) return res.status(400).json({ error: "缺少留言資料" });

    const commentText = normalizeText(text).slice(0, 600);
    const { data: comment, error: commentError } = await supabase
      .from("comments")
      .insert({ post_id: postId, author_id, text: commentText })
      .select("*")
      .single();

    if (commentError) throw commentError;

    const post = await getPostWithCharacter(postId);
    const replyText = await createOneLineCharacterReply(post.character, post.text, commentText);

    const { data: reply, error: replyError } = await supabase
      .from("comment_replies")
      .insert({
        comment_id: comment.id,
        character_id: post.character.id,
        text: replyText
      })
      .select("*")
      .single();

    if (replyError) throw replyError;
    res.json({ comment: { ...comment, replies: [reply] } });
  } catch (error) {
    handleApiError(res, error, "留言送出失敗");
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const body = req.body || {};
    const reply = await createOpenAIResponse({
      model: body.model || DEFAULT_MODEL,
      instructions: body.prompt || `你正在扮演：${body.characterName || "角色"}`,
      input: buildChatInput(body),
      max_output_tokens: 260
    });

    res.json({ reply });
  } catch (error) {
    handleApiError(res, error, "角色聊天失敗");
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(ROOT, "index.html"));
});

function createSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

function requireSupabase() {
  if (!supabase) {
    const error = new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured");
    error.status = 503;
    throw error;
  }
}

async function selectAll(table, orderColumn, ascending) {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .order(orderColumn, { ascending });
  if (error) throw error;
  return data || [];
}

function assemblePosts(posts, comments, replies) {
  const repliesByComment = groupBy(replies, "comment_id");
  const commentsByPost = groupBy(comments, "post_id");

  return posts.map(post => ({
    ...post,
    comments: (commentsByPost[post.id] || []).map(comment => ({
      ...comment,
      replies: repliesByComment[comment.id] || []
    }))
  }));
}

function groupBy(list, key) {
  return list.reduce((result, item) => {
    const value = item[key];
    if (!result[value]) result[value] = [];
    result[value].push(item);
    return result;
  }, {});
}

async function getPostWithCharacter(postId) {
  const { data: post, error: postError } = await supabase
    .from("posts")
    .select("*")
    .eq("id", postId)
    .single();
  if (postError) throw postError;

  const { data: character, error: characterError } = await supabase
    .from("characters")
    .select("*")
    .eq("id", post.character_id)
    .single();
  if (characterError) throw characterError;

  return { post, character };
}

async function createOneLineCharacterReply(character, postText, userComment) {
  return createOpenAIResponse({
    model: DEFAULT_MODEL,
    instructions: `
你正在扮演一個 OC 角色，請根據角色設定回覆社群貼文留言。

角色名稱：${character.name}
外表：${character.appearance || "未設定"}
性格：${character.personality || "未設定"}
說話方式：${character.speaking_style || "自然、像真人"}
角色補充：${character.prompt || ""}

規則：
- 只回覆一句話。
- 像社群留言，不要太長。
- 使用繁體中文。
- 不要像 AI，不要解釋設定。
- 不要替使用者說話。
    `,
    input: `
貼文內容：
${postText || ""}

使用者留言：
${userComment || ""}

請用「${character.name}」的語氣回覆一句話。
    `,
    max_output_tokens: 80
  });
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

async function uploadDataUrl(dataUrl, keyPrefix) {
  requireSupabase();
  const match = String(dataUrl).match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
  if (!match) return "";

  await ensureAvatarBucket();
  const mimeType = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  const extension = mimeType.split("/")[1].replace("jpeg", "jpg");
  const bytes = Buffer.from(match[2], "base64");
  const key = `${keyPrefix}-${Date.now()}.${extension}`;

  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(key, bytes, {
      contentType: mimeType,
      upsert: true
    });

  if (error) throw error;

  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(key);
  return data.publicUrl;
}

async function ensureAvatarBucket() {
  if (avatarBucketReady) return;
  const { error } = await supabase.storage.createBucket(AVATAR_BUCKET, {
    public: true,
    fileSizeLimit: 5 * 1024 * 1024,
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"]
  });

  if (error && !String(error.message || "").toLowerCase().includes("already exists")) {
    throw error;
  }

  avatarBucketReady = true;
}

function buildCharacterPromptText(character) {
  return [
    `角色名稱：${normalizeText(character.name) || "未命名 OC"}`,
    `外表：${normalizeText(character.appearance) || "未設定"}`,
    `性格：${normalizeText(character.personality) || "未設定"}`,
    `說話方式：${normalizeText(character.speakingStyle) || "自然、像真人"}`
  ].join("\n");
}

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function cleanId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}

function handleApiError(res, error, message) {
  console.error(message, error);
  res.status(error.status || 500).json({
    error: message,
    detail: process.env.NODE_ENV === "production" ? undefined : error.message
  });
}

app.listen(PORT, () => {
  console.log(`JZ app running on port ${PORT}`);
});

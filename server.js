const crypto = require("crypto");
const express = require("express");
const path = require("path");
const { promisify } = require("util");
const { createClient } = require("@supabase/supabase-js");

require("dotenv").config();

const scrypt = promisify(crypto.scrypt);
const app = express();
const PORT = Number(process.env.PORT || 3001);
const ROOT = __dirname;
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5.2";
const AVATAR_BUCKET = process.env.SUPABASE_AVATAR_BUCKET || "avatars";

const baseCharacters = {
  kaede: { id: "kaede", name: "西島楓", handle: "kaede", avatar_url: "images/kaede.jpg", personality: "甜美、靈動、嘴硬、會撒嬌。", appearance: "漂亮靈動，有日式洋裝氣質。", speaking_style: "甜、活潑、會頂嘴。", prompt: "用西島楓的甜美嘴硬語氣，只回一句。" },
  zhihao: { id: "zhihao", name: "嚴志豪", handle: "zhihao", avatar_url: "images/zhihao.jpg", personality: "冷峻、自負、控制慾和佔有慾強。", appearance: "183cm，黑髮，淡藍瞳，深色西裝。", speaking_style: "短句、有壓迫感、高位感。", prompt: "用嚴志豪冷峻壓迫的語氣，只回一句。" },
  xiayan: { id: "xiayan", name: "夏妍", handle: "xiayan", avatar_url: "images/xiayan.jpg", personality: "嘴快、毒舌、護短。", appearance: "明亮俐落，穿搭有個性。", speaking_style: "像朋友聊天，吐槽感強。", prompt: "用夏妍的毒舌朋友語氣，只回一句。" },
  shuxian: { id: "shuxian", name: "尹書賢", handle: "shuxian", avatar_url: "images/shuxian.jpg", personality: "細膩、敏感、容易想很多。", appearance: "安靜清冷，帶一點脆弱感。", speaking_style: "夜晚 emo，溫柔克制。", prompt: "用尹書賢細膩克制的語氣，只回一句。" },
  youchen: { id: "youchen", name: "韓祐成", handle: "youchen", avatar_url: "images/youchen.jpg", personality: "冷淡、慢熱，其實很在意。", appearance: "乾淨冷淡，眼神克制。", speaking_style: "短句、克制、慢熱。", prompt: "用韓祐成冷淡但在意的語氣，只回一句。" },
  minjun: { id: "minjun", name: "姜珉俊", handle: "minjun", avatar_url: "images/minjun.jpg", personality: "溫柔、有分寸，但不完全退讓。", appearance: "乾淨溫和，笑起來有距離感。", speaking_style: "溫柔穩定，帶一點曖昧。", prompt: "用姜珉俊溫柔但不退讓的語氣，只回一句。" },
  staff: { id: "staff", name: "西江建設員工匿名", handle: "staff", avatar_url: "images/staff.jpg", personality: "好笑、怕被抓、忍不住爆料。", appearance: "匿名帳號，不露臉。", speaking_style: "匿名小編語氣，緊張又好笑。", prompt: "用匿名爆料小編語氣，只回一句。" }
};

app.use(express.json({ limit: "8mb" }));
app.use(express.static(ROOT, {
  extensions: ["html"],
  setHeaders(res, filePath) {
    if (filePath.endsWith(".js")) res.setHeader("Content-Type", "text/javascript; charset=utf-8");
  }
}));

const supabase = createSupabaseClient();
let avatarBucketReady = false;

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, openaiConfigured: Boolean(process.env.OPENAI_API_KEY), supabaseConfigured: Boolean(supabase), defaultModel: DEFAULT_MODEL });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    requireSupabase();
    const username = normalizeHandle(req.body?.username);
    const password = String(req.body?.password || "");
    const displayName = normalizeText(req.body?.displayName) || username;
    if (!username || password.length < 4) return res.status(400).json({ error: "帳號或密碼太短" });

    const password_hash = await hashPassword(password);
    const profile = { id: `user_${crypto.randomUUID()}`, username, password_hash, display_name: displayName };
    const { data, error } = await supabase.from("profiles").insert(profile).select(safeProfileSelect()).single();
    if (error) {
      if (String(error.message).includes("duplicate")) return res.status(409).json({ error: "帳號已存在" });
      throw error;
    }
    res.json({ profile: data });
  } catch (error) {
    handleApiError(res, error, "註冊失敗");
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    requireSupabase();
    const username = normalizeHandle(req.body?.username);
    const password = String(req.body?.password || "");
    const { data, error } = await supabase.from("profiles").select("*").eq("username", username).single();
    if (error || !data) return res.status(401).json({ error: "帳號或密碼錯誤" });
    const ok = await verifyPassword(password, data.password_hash);
    if (!ok) return res.status(401).json({ error: "帳號或密碼錯誤" });
    delete data.password_hash;
    res.json({ profile: data });
  } catch (error) {
    handleApiError(res, error, "登入失敗");
  }
});

app.post("/api/profile", async (req, res) => {
  try {
    requireSupabase();
    const userId = cleanId(req.body?.userId);
    if (!userId) return res.status(400).json({ error: "缺少使用者 ID" });
    const avatar_url = req.body?.avatarDataUrl ? await uploadDataUrl(req.body.avatarDataUrl, `profiles/${userId}`) : undefined;
    const payload = { display_name: normalizeText(req.body?.displayName).slice(0, 40) || "玩家", updated_at: new Date().toISOString() };
    if (avatar_url) payload.avatar_url = avatar_url;
    const { data, error } = await supabase.from("profiles").update(payload).eq("id", userId).select(safeProfileSelect()).single();
    if (error) throw error;
    res.json({ profile: data });
  } catch (error) {
    handleApiError(res, error, "玩家資料儲存失敗");
  }
});

app.get("/api/bootstrap", async (_req, res) => {
  try {
    requireSupabase();
    const [profiles, characters, posts, comments, replies] = await Promise.all([
      selectAll("profiles", "created_at", true, safeProfileSelect()),
      selectAll("characters", "created_at", false, "*"),
      selectAll("posts", "created_at", false, "*"),
      selectAll("comments", "created_at", true, "*"),
      selectAll("comment_replies", "created_at", true, "*")
    ]);
    res.json({ profiles, characters, posts: assemblePosts(posts, comments, replies) });
  } catch (error) {
    handleApiError(res, error, "資料讀取失敗");
  }
});

app.post("/api/characters", async (req, res) => {
  try {
    requireSupabase();
    const owner_id = cleanId(req.body?.ownerId);
    const handle = normalizeHandle(req.body?.handle || req.body?.name);
    if (!owner_id || !handle) return res.status(400).json({ error: "缺少使用者或帳號" });

    const avatar_url = req.body?.avatarDataUrl ? await uploadDataUrl(req.body.avatarDataUrl, `characters/${owner_id}-${Date.now()}`) : undefined;
    const character = {
      id: `oc_${crypto.randomUUID()}`,
      owner_id,
      name: normalizeText(req.body?.name).slice(0, 40) || "未命名 OC",
      handle,
      personality: normalizeText(req.body?.personality).slice(0, 800),
      appearance: normalizeText(req.body?.appearance).slice(0, 800),
      speaking_style: normalizeText(req.body?.speakingStyle).slice(0, 500),
      avatar_url: avatar_url || "",
      prompt: buildCharacterPromptText(req.body || {})
    };
    const { data, error } = await supabase.from("characters").insert(character).select("*").single();
    if (error) throw error;
    await supabase.from("profiles").update({ player_character_id: data.id, updated_at: new Date().toISOString() }).eq("id", owner_id);
    res.json({ character: data });
  } catch (error) {
    handleApiError(res, error, "OC 儲存失敗");
  }
});

app.post("/api/posts", async (req, res) => {
  try {
    requireSupabase();
    const author_id = cleanId(req.body?.authorId);
    const character_id = cleanCharacterId(req.body?.characterId) || "kaede";
    if (!author_id) return res.status(400).json({ error: "請先登入" });
    const { data, error } = await supabase.from("posts").insert({ author_id, character_id, text: normalizeText(req.body?.text).slice(0, 1200) }).select("*").single();
    if (error) throw error;
    res.json({ post: { ...data, comments: [] } });
  } catch (error) {
    handleApiError(res, error, "發布失敗");
  }
});

app.post("/api/comments", async (req, res) => {
  try {
    requireSupabase();
    const postId = String(req.body?.postId || "");
    const author_id = cleanId(req.body?.authorId);
    if (!postId || !author_id) return res.status(400).json({ error: "缺少留言資料" });
    const text = normalizeText(req.body?.text).slice(0, 600);
    const { data: comment, error: commentError } = await supabase.from("comments").insert({ post_id: postId, author_id, text }).select("*").single();
    if (commentError) throw commentError;
    const post = await getPostWithCharacter(postId);
    const replyText = await createOneLineCharacterReply(post.character, post.text, text);
    const { data: reply, error: replyError } = await supabase.from("comment_replies").insert({ comment_id: comment.id, character_id: post.character.id, text: replyText }).select("*").single();
    if (replyError) throw replyError;
    res.json({ comment: { ...comment, replies: [reply] } });
  } catch (error) {
    handleApiError(res, error, "留言失敗");
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const body = req.body || {};
    const reply = await createOpenAIResponse({ model: body.model || DEFAULT_MODEL, instructions: buildChatInstructions(body), input: buildChatInput(body), max_output_tokens: 420 });
    res.json({ reply });
  } catch (error) {
    handleApiError(res, error, "聊天失敗");
  }
});

app.get("*", (_req, res) => res.sendFile(path.join(ROOT, "index.html")));

function createSupabaseClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

function requireSupabase() {
  if (!supabase) {
    const error = new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured");
    error.status = 503;
    throw error;
  }
}

function safeProfileSelect() {
  return "id,username,display_name,avatar_url,player_character_id,created_at,updated_at";
}

async function selectAll(table, orderColumn, ascending, select = "*") {
  const { data, error } = await supabase.from(table).select(select).order(orderColumn, { ascending });
  if (error) throw error;
  return data || [];
}

function assemblePosts(posts, comments, replies) {
  const repliesByComment = groupBy(replies, "comment_id");
  const commentsByPost = groupBy(comments, "post_id");
  return posts.map(post => ({ ...post, comments: (commentsByPost[post.id] || []).map(comment => ({ ...comment, replies: repliesByComment[comment.id] || [] })) }));
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
  const { data: post, error: postError } = await supabase.from("posts").select("*").eq("id", postId).single();
  if (postError) throw postError;
  let character = baseCharacters[post.character_id];
  if (!character) {
    const { data, error } = await supabase.from("characters").select("*").eq("id", post.character_id).single();
    if (error) throw error;
    character = data;
  }
  return { post, character };
}

async function createOneLineCharacterReply(character, postText, userComment) {
  return createOpenAIResponse({
    model: DEFAULT_MODEL,
    instructions: `
你正在扮演社群平台角色，請根據角色設定回覆貼文留言。
角色名稱：${character.name}
帳號：@${character.handle || character.id}
外表：${character.appearance || "未設定"}
性格：${character.personality || "未設定"}
說話方式：${character.speaking_style || "自然、像真人"}
補充：${character.prompt || ""}
規則：
- 只回覆一句話。
- 必須直接回應「使用者留言」的內容，不要答非所問。
- 如果使用者是在問問題，就回答那個問題。
- 如果使用者是在吐槽、撒嬌、挑釁或告白，就接住那個情緒。
- 像 Threads 留言，不要太長。
- 使用繁體中文。
- 不要像 AI，不要解釋設定，不要替使用者說話。
    `,
    input: `貼文內容：${postText || ""}\n使用者留言：${userComment || ""}\n請用「${character.name}」的語氣回覆一句話。`,
    max_output_tokens: 80
  });
}

async function createOpenAIResponse(payload) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.OPENAI_API_KEY}` }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "OpenAI API request failed");
  return extractResponseText(data);
}

function buildChatInstructions(body) {
  return [
    body.prompt || `你正在扮演：${body.characterName || "角色"}`,
    "你必須嚴格根據使用者最新訊息回覆，不要跳題，不要自顧自推進劇情。",
    "如果使用者問問題，先回答問題；如果使用者表達情緒，先接住情緒。",
    "不要替使用者說話，不要解釋自己是 AI，使用繁體中文。"
  ].join("\n");
}

function buildChatInput(body) {
  const history = Array.isArray(body.context?.history) ? body.context.history.slice(-10) : [];
  const historyText = history.map(item => `${item.role === "me" ? "使用者" : body.characterName || "角色"}：${item.text}`).join("\n");
  return [
    historyText ? `最近對話：\n${historyText}` : "",
    `使用者最新訊息：\n${body.message || ""}`,
    `請用「${body.characterName || "角色"}」的語氣，直接回應「使用者最新訊息」。`
  ].filter(Boolean).join("\n\n");
}

function extractResponseText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) chunks.push(content.text);
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
  const key = `${keyPrefix}-${Date.now()}.${extension}`;
  const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(key, Buffer.from(match[2], "base64"), { contentType: mimeType, upsert: true });
  if (error) throw error;
  return supabase.storage.from(AVATAR_BUCKET).getPublicUrl(key).data.publicUrl;
}

async function ensureAvatarBucket() {
  if (avatarBucketReady) return;
  const { error } = await supabase.storage.createBucket(AVATAR_BUCKET, { public: true, fileSizeLimit: 5 * 1024 * 1024, allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"] });
  if (error && !String(error.message || "").toLowerCase().includes("already exists")) throw error;
  avatarBucketReady = true;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)).toString("hex");
  return `${salt}:${hash}`;
}

async function verifyPassword(password, saved) {
  const [salt, hash] = String(saved || "").split(":");
  if (!salt || !hash) return false;
  const attempt = (await scrypt(password, salt, 64)).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(attempt, "hex"));
}

function buildCharacterPromptText(character) {
  return [`角色名稱：${normalizeText(character.name) || "未命名 OC"}`, `外表：${normalizeText(character.appearance) || "未設定"}`, `性格：${normalizeText(character.personality) || "未設定"}`, `說話方式：${normalizeText(character.speakingStyle) || "自然、像真人"}`].join("\n");
}

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeHandle(value) {
  return String(value || "").replace(/^@/, "").trim().replace(/\s+/g, "_").replace(/[^\w\-\u4e00-\u9fff]/g, "").toLowerCase().slice(0, 40);
}

function cleanId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 90);
}

function cleanCharacterId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, "").slice(0, 90);
}

function handleApiError(res, error, message) {
  console.error(message, error);
  res.status(error.status || 500).json({ error: message, detail: process.env.NODE_ENV === "production" ? undefined : error.message });
}

app.listen(PORT, () => console.log(`JZ app running on port ${PORT}`));

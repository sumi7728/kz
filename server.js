const crypto = require("crypto");
const express = require("express");
const path = require("path");
const { promisify } = require("util");
const { createClient } = require("@supabase/supabase-js");

require("dotenv").config({ override: true });

const scrypt = promisify(crypto.scrypt);
const app = express();
const PORT = Number(process.env.PORT || 3001);
const ROOT = __dirname;
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5.2";
const AVATAR_BUCKET = process.env.SUPABASE_AVATAR_BUCKET || "avatars";
const ADMIN_USERNAME = "kaede_728";

const aiCharacters = {
  zhihao: baseAI("zhihao", "嚴志豪", "images/zhihao.jpg", "西江建設理事長，冷峻強勢，控制慾與佔有慾很重。", "短句、命令式、高位感，吃醋時低氣壓。", "不能突然變得太溫柔，不能一直道歉，不能像 AI。"),
  xiayan: baseAI("xiayan", "夏妍", "images/xiayan.jpg", "西島楓的好閨密，嘴快毒舌但很護短。", "像朋友聊天，快、準、有梗。", "不能變正式或像客服。"),
  shuxian: baseAI("shuxian", "尹書賢", "images/shuxian.jpg", "情緒細膩敏感，容易在夜晚想很多。", "夜晚 emo 感，句子不長，帶一點委屈。", "不能過度戲劇化。"),
  youchen: baseAI("youchen", "韓祐成", "images/youchen.jpg", "冷淡慢熱，不擅長表達，但其實很在意。", "短句、克制、慢熱。", "不能突然變熱情直球。"),
  minjun: baseAI("minjun", "姜珉俊", "images/minjun.jpg", "溫柔競爭者，有分寸但不完全退讓。", "溫和、有禮，留有餘地。", "不能變成沒有立場的好人。"),
  staff: baseAI("staff", "西江建設員工匿名", "images/staff.jpg", "匿名觀察帳號，怕被抓但忍不住爆料。", "匿名小編語氣，短、好笑、緊張。", "不能洩漏重大機密。")
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
  res.json({
    ok: true,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    supabaseConfigured: Boolean(supabase),
    supabaseUrlConfigured: Boolean(process.env.SUPABASE_URL),
    serviceRoleConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    defaultModel: DEFAULT_MODEL
  });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    requireSupabase();
    const username = normalizeHandle(req.body?.username);
    const password = String(req.body?.password || "");
    const displayName = normalizeText(req.body?.displayName) || username;
    if (!username || password.length < 4) return res.status(400).json({ error: "帳號或密碼太短" });

    const role = username === ADMIN_USERNAME ? "admin" : "player";
    if (role === "admin") {
      const { data: existingAdmin } = await supabase.from("profiles").select("id").eq("role", "admin").maybeSingle();
      if (existingAdmin) return res.status(403).json({ error: "最高權限帳號已存在" });
    }

    const password_hash = await hashPassword(password);
    const profile = { id: `user_${crypto.randomUUID()}`, username, password_hash, role, display_name: displayName };
    const { data, error } = await supabase.from("profiles").insert(profile).select(profileSelect()).single();
    if (error) {
      if (String(error.message).toLowerCase().includes("duplicate")) return res.status(409).json({ error: "帳號已存在" });
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
    if (error || !data || !(await verifyPassword(password, data.password_hash))) return res.status(401).json({ error: "帳號或密碼錯誤" });
    delete data.password_hash;
    res.json({ profile: data });
  } catch (error) {
    handleApiError(res, error, "登入失敗");
  }
});

app.get("/api/bootstrap", async (_req, res) => {
  try {
    requireSupabase();
    const [profiles, characters, posts, comments, replies, aiSettings, aiRequests] = await Promise.all([
      selectAll("profiles", "created_at", true, profileSelect()),
      selectAll("characters", "created_at", false),
      selectAll("posts", "created_at", false),
      selectAll("comments", "created_at", true),
      selectAll("comment_replies", "created_at", true),
      selectAll("ai_character_settings", "created_at", true),
      selectAll("ai_character_requests", "created_at", false)
    ]);
    res.json({ profiles, characters, aiCharacters: Object.values(aiCharacters), aiSettings, aiRequests, posts: assemblePosts(posts, comments, replies) });
  } catch (error) {
    handleApiError(res, error, "讀取資料失敗");
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
    const { data, error } = await supabase.from("profiles").update(payload).eq("id", userId).select(profileSelect()).single();
    if (error) throw error;
    res.json({ profile: data });
  } catch (error) {
    handleApiError(res, error, "儲存帳號資料失敗");
  }
});

app.post("/api/characters", async (req, res) => {
  try {
    requireSupabase();
    const owner_id = cleanId(req.body?.ownerId);
    const handle = normalizeHandle(req.body?.handle || req.body?.name);
    if (!owner_id || !handle) return res.status(400).json({ error: "缺少使用者或帳號" });
    const avatar_url = req.body?.avatarDataUrl ? await uploadDataUrl(req.body.avatarDataUrl, `characters/${owner_id}-${Date.now()}`) : "";
    const character = {
      id: `oc_${crypto.randomUUID()}`,
      owner_id,
      name: normalizeText(req.body?.name).slice(0, 40) || "我的 OC",
      handle,
      personality: normalizeText(req.body?.personality).slice(0, 800),
      appearance: normalizeText(req.body?.appearance).slice(0, 800),
      speaking_style: normalizeText(req.body?.speakingStyle).slice(0, 500),
      avatar_url,
      prompt: buildCharacterPromptText(req.body || {})
    };
    const { data, error } = await supabase.from("characters").insert(character).select("*").single();
    if (error) throw error;
    await supabase.from("profiles").update({ player_character_id: data.id, updated_at: new Date().toISOString() }).eq("id", owner_id);
    res.json({ character: data });
  } catch (error) {
    handleApiError(res, error, "儲存 OC 失敗");
  }
});

app.put("/api/characters/:id", async (req, res) => {
  try {
    requireSupabase();
    const id = String(req.params.id || "");
    const owner_id = cleanId(req.body?.ownerId);
    if (!id || !owner_id) return res.status(400).json({ error: "缺少角色資料" });
    const current = await getCharacterRow(id);
    if (current.owner_id !== owner_id && !(await isAdminUser(owner_id))) return res.status(403).json({ error: "只能更新自己的 OC" });

    const avatar_url = req.body?.avatarDataUrl ? await uploadDataUrl(req.body.avatarDataUrl, `characters/${owner_id}-${Date.now()}`) : undefined;
    const payload = {
      name: normalizeText(req.body?.name).slice(0, 40) || current.name,
      handle: normalizeHandle(req.body?.handle || current.handle),
      personality: normalizeText(req.body?.personality).slice(0, 800),
      appearance: normalizeText(req.body?.appearance).slice(0, 800),
      speaking_style: normalizeText(req.body?.speakingStyle).slice(0, 500),
      prompt: buildCharacterPromptText(req.body || current),
      updated_at: new Date().toISOString()
    };
    if (avatar_url) payload.avatar_url = avatar_url;
    const { data, error } = await supabase.from("characters").update(payload).eq("id", id).select("*").single();
    if (error) throw error;
    res.json({ character: data });
  } catch (error) {
    handleApiError(res, error, "更新 OC 失敗");
  }
});

app.post("/api/ai-settings", async (req, res) => {
  try {
    requireSupabase();
    const owner_id = cleanId(req.body?.ownerId);
    const character_id = cleanCharacterId(req.body?.characterId);
    if (!owner_id || !aiCharacters[character_id]) return res.status(400).json({ error: "缺少 AI 角色設定" });
    const payload = {
      owner_id,
      character_id,
      memory: normalizeText(req.body?.memory).slice(0, 3000),
      interaction_mode: normalizeText(req.body?.interactionMode).slice(0, 1000),
      nickname: normalizeText(req.body?.nickname).slice(0, 80),
      rules: normalizeText(req.body?.rules).slice(0, 1500),
      updated_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from("ai_character_settings").upsert(payload, { onConflict: "owner_id,character_id" }).select("*").single();
    if (error) throw error;
    res.json({ setting: data });
  } catch (error) {
    handleApiError(res, error, "儲存 AI 記憶失敗");
  }
});

app.post("/api/ai-requests", async (req, res) => {
  try {
    requireSupabase();
    const owner_id = cleanId(req.body?.ownerId);
    if (!owner_id) return res.status(400).json({ error: "請先登入" });
    const payload = {
      owner_id,
      name: normalizeText(req.body?.name).slice(0, 40),
      handle: normalizeHandle(req.body?.handle || req.body?.name),
      concept: normalizeText(req.body?.concept).slice(0, 1000),
      personality: normalizeText(req.body?.personality).slice(0, 1000),
      appearance: normalizeText(req.body?.appearance).slice(0, 1000),
      speaking_style: normalizeText(req.body?.speakingStyle).slice(0, 700),
      prompt: normalizeText(req.body?.prompt).slice(0, 1500)
    };
    if (!payload.name || !payload.handle) return res.status(400).json({ error: "請填 AI 角色名字和帳號" });
    const { data, error } = await supabase.from("ai_character_requests").insert(payload).select("*").single();
    if (error) throw error;
    res.json({ request: data });
  } catch (error) {
    handleApiError(res, error, "送出 AI 角色申請失敗");
  }
});

app.post("/api/admin/ai-requests/:id", async (req, res) => {
  try {
    requireSupabase();
    await requireAdmin(req.body?.adminId);
    const status = ["approved", "rejected", "pending"].includes(req.body?.status) ? req.body.status : "pending";
    const { data, error } = await supabase.from("ai_character_requests").update({
      status,
      admin_note: normalizeText(req.body?.adminNote).slice(0, 500),
      updated_at: new Date().toISOString()
    }).eq("id", String(req.params.id || "")).select("*").single();
    if (error) throw error;
    res.json({ request: data });
  } catch (error) {
    handleApiError(res, error, "管理者更新申請失敗");
  }
});

app.post("/api/posts", async (req, res) => {
  try {
    requireSupabase();
    const author_id = cleanId(req.body?.authorId);
    const character_id = cleanCharacterId(req.body?.characterId);
    const ai_character_id = cleanCharacterId(req.body?.aiCharacterId);
    if (!author_id || !character_id) return res.status(400).json({ error: "請先登入並建立 OC" });
    const text = normalizeText(req.body?.text).slice(0, 1200);
    if (!text) return res.status(400).json({ error: "貼文不能是空的" });
    const { data, error } = await supabase.from("posts").insert({ author_id, character_id, ai_character_id: aiCharacters[ai_character_id] ? ai_character_id : null, text }).select("*").single();
    if (error) throw error;
    res.json({ post: { ...data, comments: [] } });
  } catch (error) {
    handleApiError(res, error, "發文失敗");
  }
});

app.put("/api/posts/:id", async (req, res) => {
  try {
    requireSupabase();
    const userId = cleanId(req.body?.userId);
    const postId = String(req.params.id || "");
    const text = normalizeText(req.body?.text).slice(0, 1200);
    if (!userId || !postId || !text) return res.status(400).json({ error: "缺少貼文資料" });
    const post = await getPost(postId);
    if (!(await canModifyPost(userId, post))) return res.status(403).json({ error: "只能編輯自己的貼文" });
    const { data, error } = await supabase.from("posts").update({ text }).eq("id", postId).select("*").single();
    if (error) throw error;
    res.json({ post: data });
  } catch (error) {
    handleApiError(res, error, "編輯貼文失敗");
  }
});

app.delete("/api/posts/:id", async (req, res) => {
  try {
    requireSupabase();
    const userId = cleanId(req.body?.userId);
    const postId = String(req.params.id || "");
    if (!userId || !postId) return res.status(400).json({ error: "缺少貼文資料" });
    const post = await getPost(postId);
    if (!(await canModifyPost(userId, post))) return res.status(403).json({ error: "只能刪除自己的貼文" });
    const { error } = await supabase.from("posts").delete().eq("id", postId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    handleApiError(res, error, "刪除貼文失敗");
  }
});

app.post("/api/comments", async (req, res) => {
  try {
    requireSupabase();
    const postId = String(req.body?.postId || "");
    const author_id = cleanId(req.body?.authorId);
    const requestedAiId = cleanCharacterId(req.body?.aiCharacterId);
    if (!postId || !author_id) return res.status(400).json({ error: "缺少留言資料" });
    const text = normalizeText(req.body?.text).slice(0, 600);
    if (!text) return res.status(400).json({ error: "留言不能是空的" });
    const post = await getPost(postId);
    const ai_character_id = aiCharacters[requestedAiId] ? requestedAiId : null;
    const { data: comment, error: commentError } = await supabase.from("comments").insert({ post_id: postId, author_id, text, ai_character_id: ai_character_id || null }).select("*").single();
    if (commentError) throw commentError;
    if (!ai_character_id) return res.json({ comment: { ...comment, replies: [] } });
    const context = await getPostContext(postId);
    const setting = await getAiSetting(author_id, ai_character_id);
    const replyText = await createOneLineCharacterReply(aiCharacters[ai_character_id], post, text, context, setting);
    const { data: reply, error: replyError } = await supabase.from("comment_replies").insert({ comment_id: comment.id, character_id: ai_character_id, text: replyText }).select("*").single();
    if (replyError) throw replyError;
    res.json({ comment: { ...comment, replies: [reply] } });
  } catch (error) {
    handleApiError(res, error, "留言失敗");
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const body = req.body || {};
    const characterId = cleanCharacterId(body.characterId);
    if (!aiCharacters[characterId]) return res.status(400).json({ error: "只能和 AI 角色聊天" });
    const setting = body.ownerId ? await getAiSetting(cleanId(body.ownerId), characterId) : null;
    const character = aiCharacters[characterId];
    const reply = await createOpenAIResponse({
      model: body.model || DEFAULT_MODEL,
      instructions: buildChatInstructions(character, body, setting),
      input: buildChatInput(character, body),
      max_output_tokens: 420
    });
    res.json({ reply });
  } catch (error) {
    handleApiError(res, error, "聊天失敗");
  }
});

app.get("*", (_req, res) => res.sendFile(path.join(ROOT, "index.html")));

function baseAI(id, name, avatar_url, personality, speaking_style, prompt) {
  return { id, name, handle: id, avatar_url, personality, appearance: "依角色設定呈現。", speaking_style, prompt };
}

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

async function requireAdmin(adminId) {
  const id = cleanId(adminId);
  if (!id) {
    const error = new Error("缺少管理者 ID");
    error.status = 403;
    throw error;
  }
  const { data, error } = await supabase.from("profiles").select("role,username").eq("id", id).single();
  if (error || !data || data.role !== "admin" || data.username !== ADMIN_USERNAME) {
    const forbidden = new Error("只有 @kaede_728 可以使用管理者模式");
    forbidden.status = 403;
    throw forbidden;
  }
  return data;
}

async function isAdminUser(userId) {
  try {
    await requireAdmin(userId);
    return true;
  } catch {
    return false;
  }
}

async function canModifyPost(userId, post) {
  if (post.author_id === userId) return true;
  try {
    await requireAdmin(userId);
    return true;
  } catch {
    return false;
  }
}

async function getCharacterRow(characterId) {
  const { data, error } = await supabase.from("characters").select("*").eq("id", characterId).single();
  if (error) throw error;
  return data;
}

function profileSelect() {
  return "id,username,role,display_name,avatar_url,player_character_id,created_at,updated_at";
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

async function getPost(postId) {
  const { data, error } = await supabase.from("posts").select("*").eq("id", postId).single();
  if (error) throw error;
  return data;
}

async function getPostContext(postId) {
  const { data } = await supabase.from("comments").select("text,author_id,created_at").eq("post_id", postId).order("created_at", { ascending: true }).limit(12);
  return (data || []).map(comment => `${comment.author_id}: ${comment.text}`).join("\n");
}

async function getAiSetting(ownerId, characterId) {
  if (!supabase || !ownerId || !characterId) return null;
  const { data } = await supabase.from("ai_character_settings").select("*").eq("owner_id", ownerId).eq("character_id", characterId).maybeSingle();
  return data || null;
}

async function createOneLineCharacterReply(character, post, userComment, context, setting) {
  return createOpenAIResponse({
    model: DEFAULT_MODEL,
    instructions: `
你正在扮演社群裡的 AI 角色。
角色：${character.name}
帳號：@${character.handle}
性格：${character.personality}
說話方式：${character.speaking_style}
規則：${character.prompt}
使用者專屬記憶：${setting?.memory || "無"}
互動模式：${setting?.interaction_mode || "自然接話，保持角色感。"}
稱呼規則：${setting?.nickname || "依上下文自然稱呼。"}
不可違規規則：${setting?.rules || "不可崩角色，不可像 AI，不可替使用者說話。"}
只回一句話，最多兩句。使用繁體中文。必須看上下文。`,
    input: `貼文：${post.text || ""}\n\n最近留言：${context || "無"}\n\n使用者剛剛 @ 你：${userComment}`,
    max_output_tokens: 100
  });
}

function buildChatInstructions(character, body, setting) {
  return `
你正在進行沉浸式小說角色扮演。
角色：${character.name}
帳號：@${character.handle}
性格：${character.personality}
說話方式：${character.speaking_style}
角色規則：${character.prompt}
使用者專屬記憶：${setting?.memory || "無"}
互動模式：${setting?.interaction_mode || "沉浸式小說互動，不要客服感。"}
稱呼：${setting?.nickname || "依上下文自然稱呼使用者。"}
不可違規規則：${setting?.rules || "不可崩角色，不可替使用者說話，不可突然加入重大事件。"}
使用繁體中文。旁白、動作、心理描寫用斜體。角色說話用粗體。一次只回覆一小段。
不要替使用者決定台詞、動作、情緒。不要總結，不要分析，不要解釋角色設定。
${body.prompt || ""}`;
}

function buildChatInput(character, body) {
  const history = Array.isArray(body.context?.history) ? body.context.history.slice(-12) : [];
  const historyText = history.map(item => `${item.role === "me" ? "使用者" : character.name}：${item.text}`).join("\n");
  return [historyText ? `最近對話：\n${historyText}` : "", `使用者最新訊息：\n${body.message || ""}`, `請用「${character.name}」回覆。`].filter(Boolean).join("\n\n");
}

async function createOpenAIResponse(payload) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "OpenAI API request failed");
  return extractResponseText(data);
}

function extractResponseText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const chunks = [];
  for (const item of data.output || []) for (const content of item.content || []) if (content.type === "output_text" && content.text) chunks.push(content.text);
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
  return [`角色名字：${normalizeText(character.name) || "我的 OC"}`, `外表：${normalizeText(character.appearance) || "未設定"}`, `性格：${normalizeText(character.personality) || "未設定"}`, `說話風格：${normalizeText(character.speakingStyle) || "未設定"}`].join("\n");
}

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeHandle(value) {
  return String(value || "").replace(/^@/, "").trim().replace(/\s+/g, "_").replace(/[^\w\-\u4e00-\u9fff]/g, "").toLowerCase().slice(0, 40);
}

function cleanId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
}

function cleanCharacterId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, "").slice(0, 100);
}

function handleApiError(res, error, message) {
  console.error(message, error);
  res.status(error.status || 500).json({ error: message, detail: process.env.NODE_ENV === "production" ? undefined : error.message });
}

app.listen(PORT, () => console.log(`DreamSugar app running on port ${PORT}`));

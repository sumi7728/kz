const crypto = require("crypto");
const express = require("express");
const path = require("path");
const { promisify } = require("util");
const { createClient } = require("@supabase/supabase-js");

require("dotenv").config({ override: true });

const app = express();
const scrypt = promisify(crypto.scrypt);
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3001);
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5.2";
const AVATAR_BUCKET = process.env.SUPABASE_AVATAR_BUCKET || "avatars";
const ADMIN_USERNAME = "kaede_728";

const aiCharacters = {
  zhihao: baseAI("zhihao", "嚴志豪", "@zhihao", "images/zhihao.jpg", "24歲，西江建設理事長。冷峻、強勢、控制慾與佔有慾都很重，對西島楓有強烈保護欲。", "短句、命令式、高位感。吃醋時低氣壓，不大吵大鬧。", "不能突然過度溫柔，不能一直道歉，不能像 AI 說明。稱呼西島楓可叫西島楓或嚴太太。"),
  xiayan: baseAI("xiayan", "夏妍", "@xiayan", "images/xiayan.jpg", "西島楓的好閨密，嘴快毒舌但很護短。", "朋友聊天感，直接、吐槽、節奏快。", "可以吐槽嚴志豪，也會護短。不要太正式。"),
  shuxian: baseAI("shuxian", "尹書賢", "@shuxian", "images/shuxian.jpg", "情緒細膩、敏感、容易想很多，和韓祐成有拉扯。", "夜晚 emo 感，嘴硬、委屈、細膩。", "不要變成只會哭的人。"),
  youchen: baseAI("youchen", "韓祐成", "@youchen", "images/youchen.jpg", "偏冷淡、不擅長表達，其實很在意但常先否認。", "短句、克制、慢熱。", "不要突然變得熱情。"),
  minjun: baseAI("minjun", "姜珉俊", "@minjun", "images/minjun.jpg", "溫柔競爭者，對西島楓有好感或曖昧張力。", "溫柔、有分寸，但不完全退讓。", "不要失去界線，也不要自行加入重大事件。"),
  staff: baseAI("staff", "西江建設員工匿名", "@staff", "images/staff.jpg", "匿名觀察帳號，專門記錄理事長和理事長太太的八卦。", "像匿名小編，怕被抓但忍不住爆料。", "不要洩漏真實個資，不要變正式公告。")
};

app.use(express.json({ limit: "10mb" }));
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
    defaultModel: DEFAULT_MODEL
  });
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
    res.json({
      profiles,
      characters,
      aiCharacters: Object.values(aiCharacters),
      aiSettings,
      aiRequests,
      posts: assemblePosts(posts, comments, replies)
    });
  } catch (error) {
    handleApiError(res, error, "讀取資料失敗");
  }
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
      if (existingAdmin) return res.status(403).json({ error: "@kaede_728 管理者帳號已存在" });
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
    if (!owner_id) return res.status(400).json({ error: "缺少使用者 ID" });
    const profile = await getProfileRow(owner_id);
    const existingId = cleanCharacterId(req.body?.characterId || profile.player_character_id);
    const avatar_url = req.body?.avatarDataUrl ? await uploadDataUrl(req.body.avatarDataUrl, `characters/${owner_id}`) : undefined;
    const payload = {
      owner_id,
      name: normalizeText(req.body?.name).slice(0, 40),
      handle: normalizeHandle(req.body?.handle),
      personality: normalizeText(req.body?.personality).slice(0, 1200),
      appearance: normalizeText(req.body?.appearance).slice(0, 1200),
      speaking_style: normalizeText(req.body?.speakingStyle).slice(0, 1200),
      prompt: normalizeText(req.body?.prompt).slice(0, 2000),
      updated_at: new Date().toISOString()
    };
    if (!payload.name || !payload.handle) return res.status(400).json({ error: "請填角色名稱和 @帳號" });
    if (avatar_url) payload.avatar_url = avatar_url;

    let data;
    if (existingId) {
      const current = await maybeCharacter(existingId);
      if (current && current.owner_id === owner_id) {
        const result = await supabase.from("characters").update(payload).eq("id", existingId).select("*").single();
        if (result.error) throw result.error;
        data = result.data;
      }
    }
    if (!data) {
      const insert = { ...payload, id: `char_${crypto.randomUUID()}` };
      const result = await supabase.from("characters").insert(insert).select("*").single();
      if (result.error) throw result.error;
      data = result.data;
      const { error } = await supabase.from("profiles").update({ player_character_id: data.id, updated_at: new Date().toISOString() }).eq("id", owner_id);
      if (error) throw error;
    }
    res.json({ character: data });
  } catch (error) {
    handleApiError(res, error, "儲存 OC 失敗");
  }
});

app.post("/api/ai-settings", async (req, res) => {
  try {
    requireSupabase();
    const owner_id = cleanId(req.body?.ownerId);
    const character_id = cleanCharacterId(req.body?.characterId);
    if (!owner_id || !character_id) return res.status(400).json({ error: "缺少設定資料" });
    const payload = {
      owner_id,
      character_id,
      memory: normalizeText(req.body?.memory).slice(0, 3000),
      interaction_mode: normalizeText(req.body?.interactionMode).slice(0, 1600),
      nickname: normalizeText(req.body?.nickname).slice(0, 80),
      rules: normalizeText(req.body?.rules).slice(0, 2000),
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
    if (!owner_id) return res.status(400).json({ error: "缺少使用者 ID" });
    const payload = {
      owner_id,
      name: normalizeText(req.body?.name).slice(0, 40),
      handle: normalizeHandle(req.body?.handle),
      concept: normalizeText(req.body?.concept).slice(0, 1000),
      personality: normalizeText(req.body?.personality).slice(0, 1200),
      appearance: normalizeText(req.body?.appearance).slice(0, 1200),
      speaking_style: normalizeText(req.body?.speakingStyle).slice(0, 1200),
      prompt: normalizeText(req.body?.prompt).slice(0, 2000)
    };
    if (!payload.name || !payload.handle) return res.status(400).json({ error: "請填 AI 角色名稱和 @帳號" });
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
    const status = ["pending", "approved", "rejected"].includes(req.body?.status) ? req.body.status : "pending";
    const { data, error } = await supabase.from("ai_character_requests").update({ status, updated_at: new Date().toISOString() }).eq("id", req.params.id).select("*").single();
    if (error) throw error;
    res.json({ request: data });
  } catch (error) {
    handleApiError(res, error, "更新申請失敗");
  }
});

app.delete("/api/admin/characters/:id", async (req, res) => {
  try {
    requireSupabase();
    const admin = await requireAdmin(req.body?.adminId);
    const characterId = cleanCharacterId(req.params.id);
    const character = await maybeCharacter(characterId);
    if (!character) return res.status(404).json({ error: "找不到這個 OC" });
    if (character.owner_id === admin.id) return res.status(400).json({ error: "不能在這裡刪除自己的 OC" });

    const { error: profileError } = await supabase
      .from("profiles")
      .update({ player_character_id: null, updated_at: new Date().toISOString() })
      .eq("player_character_id", characterId);
    if (profileError) throw profileError;

    const { error } = await supabase.from("characters").delete().eq("id", characterId);
    if (error) throw error;
    res.json({ ok: true, characterId, ownerId: character.owner_id });
  } catch (error) {
    handleApiError(res, error, "刪除 OC 失敗");
  }
});

app.post("/api/posts", async (req, res) => {
  try {
    requireSupabase();
    const author_id = cleanId(req.body?.authorId);
    const character_id = cleanCharacterId(req.body?.characterId);
    const ai_character_id = aiCharacters[cleanCharacterId(req.body?.aiCharacterId)] ? cleanCharacterId(req.body?.aiCharacterId) : null;
    const text = normalizeText(req.body?.text).slice(0, 1200);
    if (!author_id || !character_id || !text) return res.status(400).json({ error: "貼文資料不完整" });
    const { data, error } = await supabase.from("posts").insert({ author_id, character_id, ai_character_id, text }).select("*").single();
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
    const post = await getPost(req.params.id);
    if (!(await canModifyPost(userId, post))) return res.status(403).json({ error: "沒有編輯權限" });
    const text = normalizeText(req.body?.text).slice(0, 1200);
    if (!text) return res.status(400).json({ error: "貼文不能是空的" });
    const { data, error } = await supabase.from("posts").update({ text }).eq("id", req.params.id).select("*").single();
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
    const post = await getPost(req.params.id);
    if (!(await canModifyPost(userId, post))) return res.status(403).json({ error: "沒有刪除權限" });
    const { error } = await supabase.from("posts").delete().eq("id", req.params.id);
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
    const ai_character_id = aiCharacters[requestedAiId] ? requestedAiId : null;
    const text = normalizeText(req.body?.text).slice(0, 600);
    if (!postId || !author_id || !text) return res.status(400).json({ error: "留言資料不完整" });
    const post = await getPost(postId);
    const { data: comment, error: commentError } = await supabase.from("comments").insert({ post_id: postId, author_id, text, ai_character_id }).select("*").single();
    if (commentError) throw commentError;
    if (!ai_character_id) return res.json({ comment: { ...comment, replies: [] } });

    const context = await getPostContext(postId, req.body?.postContext);
    const setting = await getAiSetting(author_id, ai_character_id);
    const userContext = await getUserContext(author_id, req.body?.userCharacter);
    const replyText = await createOneLineCharacterReply(aiCharacters[ai_character_id], post, text, context, setting, userContext);
    const { data: reply, error: replyError } = await supabase.from("comment_replies").insert({ comment_id: comment.id, character_id: ai_character_id, text: replyText }).select("*").single();
    if (replyError) throw replyError;
    res.json({ comment: { ...comment, replies: [reply] } });
  } catch (error) {
    handleApiError(res, error, "留言失敗");
  }
});

app.post("/api/post-ai-reply", async (req, res) => {
  try {
    requireSupabase();
    const postId = String(req.body?.postId || "");
    const ownerId = cleanId(req.body?.ownerId);
    const aiCharacterId = cleanCharacterId(req.body?.aiCharacterId);
    if (!postId || !ownerId || !aiCharacters[aiCharacterId]) return res.status(400).json({ error: "AI 回覆資料不完整" });
    const post = await getPost(postId);
    const { data: existing } = await supabase.from("comments").select("id").eq("post_id", postId).eq("text", "__ai_post_reply__").eq("ai_character_id", aiCharacterId).maybeSingle();
    if (existing) return res.status(409).json({ error: "AI 已回覆過這篇貼文" });

    const context = await getPostContext(postId, req.body?.postContext);
    const setting = await getAiSetting(ownerId, aiCharacterId);
    const userContext = await getUserContext(ownerId, req.body?.userCharacter);
    const replyText = await createOneLineCharacterReply(aiCharacters[aiCharacterId], post, `使用者在貼文中標記了 @${aiCharacters[aiCharacterId].handle.replace(/^@/, "")}`, context, setting, userContext);
    const { data: comment, error: commentError } = await supabase.from("comments").insert({ post_id: postId, author_id: ownerId, text: "__ai_post_reply__", ai_character_id: aiCharacterId }).select("*").single();
    if (commentError) throw commentError;
    const { data: reply, error: replyError } = await supabase.from("comment_replies").insert({ comment_id: comment.id, character_id: aiCharacterId, text: replyText }).select("*").single();
    if (replyError) throw replyError;
    res.json({ comment: { ...comment, replies: [reply] } });
  } catch (error) {
    handleApiError(res, error, "AI 回覆貼文失敗");
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const body = req.body || {};
    const characterId = cleanCharacterId(body.characterId);
    const character = aiCharacters[characterId];
    if (!character) return res.status(400).json({ error: "找不到 AI 角色" });
    const ownerId = cleanId(body.ownerId);
    const setting = ownerId ? await getAiSetting(ownerId, characterId) : null;
    const userContext = ownerId ? await getUserContext(ownerId, body.userCharacter) : formatUserContext(body.userCharacter);
    const reply = await createOpenAIResponse({
      model: body.model || DEFAULT_MODEL,
      instructions: buildChatInstructions(character, body, setting, userContext),
      input: buildChatInput(character, body),
      max_output_tokens: 420
    });
    res.json({ reply: normalizeAIChatReply(reply) });
  } catch (error) {
    handleApiError(res, error, "私訊回覆失敗");
  }
});

app.get("*", (_req, res) => res.sendFile(path.join(ROOT, "index.html")));

function baseAI(id, name, handle, avatar_url, personality, speaking_style, prompt) {
  return { id, name, handle, avatar_url, personality, appearance: "", speaking_style, prompt, isAI: true };
}

function createSupabaseClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

function requireSupabase() {
  if (!supabase) {
    const error = new Error("Supabase 尚未設定 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY");
    error.status = 503;
    throw error;
  }
}

async function requireAdmin(adminId) {
  const id = cleanId(adminId);
  const { data, error } = await supabase.from("profiles").select("role,username").eq("id", id).single();
  if (error || !data || data.role !== "admin" || data.username !== ADMIN_USERNAME) {
    const forbidden = new Error("只有 @kaede_728 可以使用管理者模式");
    forbidden.status = 403;
    throw forbidden;
  }
  return data;
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

function profileSelect() {
  return "id,username,role,display_name,avatar_url,player_character_id,created_at,updated_at";
}

async function selectAll(table, orderColumn, ascending, select = "*") {
  const { data, error } = await supabase.from(table).select(select).order(orderColumn, { ascending });
  if (error) throw error;
  return data || [];
}

function assemblePosts(postList, commentList, replyList) {
  const repliesByComment = groupBy(replyList, "comment_id");
  const commentsByPost = groupBy(commentList, "post_id");
  return postList.map(post => ({
    ...post,
    comments: (commentsByPost[post.id] || []).map(comment => ({ ...comment, replies: repliesByComment[comment.id] || [] }))
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

async function getProfileRow(userId) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
  if (error) throw error;
  return data;
}

async function maybeCharacter(characterId) {
  if (!characterId) return null;
  const { data } = await supabase.from("characters").select("*").eq("id", characterId).maybeSingle();
  return data || null;
}

async function getPost(postId) {
  const { data, error } = await supabase.from("posts").select("*").eq("id", postId).single();
  if (error) throw error;
  return data;
}

async function getPostContext(postId, clientContext = "") {
  if (clientContext) return normalizeText(clientContext).slice(0, 3000);
  const { data } = await supabase.from("comments").select("text,author_id,created_at").eq("post_id", postId).order("created_at", { ascending: true }).limit(12);
  return (data || []).map(comment => `${comment.author_id}: ${comment.text}`).join("\n");
}

async function getAiSetting(ownerId, characterId) {
  if (!supabase || !ownerId || !characterId) return null;
  const { data } = await supabase.from("ai_character_settings").select("*").eq("owner_id", ownerId).eq("character_id", characterId).maybeSingle();
  return data || null;
}

async function getUserContext(ownerId, fallbackCharacter) {
  if (!supabase || !ownerId) return formatUserContext(fallbackCharacter);
  const { data: profile } = await supabase.from("profiles").select(profileSelect()).eq("id", ownerId).maybeSingle();
  let character = null;
  if (profile?.player_character_id) {
    const { data } = await supabase.from("characters").select("*").eq("id", profile.player_character_id).maybeSingle();
    character = data;
  }
  return formatUserContext(character || fallbackCharacter, profile);
}

function formatUserContext(character, profile = null) {
  if (!character && !profile) return "使用者尚未提供 OC 設定。";
  return `
【使用者資料】
帳號：${profile?.username ? `@${profile.username}` : "未知"}
顯示名稱：${profile?.display_name || character?.name || "未知"}

【使用者 OC】
名稱：${character?.name || "未設定"}
帳號：${character?.handle || "未設定"}
外表：${character?.appearance || "未設定"}
性格：${character?.personality || "未設定"}
說話風格：${character?.speaking_style || "未設定"}
簡介：${character?.bio || "未設定"}
`;
}

async function createOneLineCharacterReply(character, post, userComment, context, setting, userContext) {
  return createOpenAIResponse({
    model: DEFAULT_MODEL,
    instructions: `
你正在扮演社群平台中的 AI 角色。

【角色】
姓名：${character.name}
帳號：${character.handle}
個性：${character.personality}
說話風格：${character.speaking_style}
不可崩壞：${character.prompt}

【使用者 OC 與關係】
${userContext}

【此角色對該使用者的重要記憶】
${formatSetting(setting)}

【留言回覆規則】
- 使用繁體中文。
- 只回一句話，最多兩句。
- 像社群貼文底下的留言，不要太長。
- 需要看貼文、留言上下文和使用者 OC。
- 不要像 AI，不要解釋設定，不要替使用者說話。
- 如果使用者與使用者互動，只有在明確 @ 到你時才回覆。
`,
    input: `
貼文內容：
${post.text || ""}

上下文：
${context || "無"}

使用者留言或標記：
${userComment}
`,
    max_output_tokens: 120
  });
}

function buildChatInstructions(character, body, setting, userContext) {
  return `
${body.prompt || ""}

【目前指定角色】
姓名：${character.name}
帳號：${character.handle}
個性：${character.personality}
說話風格：${character.speaking_style}
不可崩壞：${character.prompt}

【使用者 OC 與背景】
${userContext}

【此角色對該使用者的重要記憶】
${formatSetting(setting)}

【私訊回覆規則】
- 你只能扮演 ${character.name}。
- 必須查看使用者 OC、重要記憶與最近上下文。
- 約 80 到 130 字。
- 可以先用一小段 *動作或心理描寫*。
- 角色說話請用 **粗體**，而且台詞必須獨立成段，前後留空白行。
- 不要亂分行；自然小說段落即可。
- 不要替使用者說話，不要替使用者決定動作或情緒。
- 不要自行加入重大事件。
- 不要解釋你是 AI，也不要解釋角色設定。
`;
}

function buildChatInput(character, body) {
  const history = Array.isArray(body.context?.history) ? body.context.history.slice(-12) : [];
  const historyText = history.map(item => `${item.role === "me" ? "使用者" : character.name}：${item.text}`).join("\n");
  return [
    historyText ? `最近對話：\n${historyText}` : "",
    `使用者剛剛說：\n${body.message || ""}`,
    `請用 ${character.name} 的語氣回覆。`
  ].filter(Boolean).join("\n\n");
}

function formatSetting(setting) {
  if (!setting) return "無";
  return `
重要記憶：${setting.memory || "無"}
互動模式：${setting.interaction_mode || "無"}
角色對使用者的稱呼：${setting.nickname || "無"}
不可違規規則：${setting.rules || "無"}
`;
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
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) chunks.push(content.text);
    }
  }
  return chunks.join("").trim();
}

function normalizeAIChatReply(text) {
  let reply = normalizeText(text);
  if (!reply) return "";
  if (!/\*\*[\s\S]+?\*\*/.test(reply)) {
    reply = reply.replace(/^[「"]?(.+?)[」"]?$/s, "**$1**");
  }
  return reply;
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
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.some(bucket => bucket.name === AVATAR_BUCKET)) {
    await supabase.storage.createBucket(AVATAR_BUCKET, { public: true });
  }
  avatarBucketReady = true;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${derived.toString("hex")}`;
}

async function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const derived = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), derived);
}

function cleanId(value) {
  return String(value || "").trim().slice(0, 120);
}

function cleanCharacterId(value) {
  return String(value || "").trim().replace(/[^\w\-]/g, "").slice(0, 120);
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\r\n/g, "\n");
}

function normalizeHandle(value) {
  return String(value || "").replace(/^@/, "").trim().replace(/\s+/g, "_").replace(/[^\w\-\u4e00-\u9fff]/g, "").toLowerCase().slice(0, 40);
}

function handleApiError(res, error, fallback) {
  console.error(error);
  res.status(error.status || 500).json({ error: error.message || fallback });
}

app.listen(PORT, () => {
  console.log(`Dream Sugar Garden running on http://localhost:${PORT}`);
});

import { users, defaultPosts, buildDMNovelPrompt } from "./data.js";

const STORAGE_SESSION = "dream_sugar_session";
const STORAGE_MESSAGES = "dream_sugar_messages";
const STORAGE_CHAT_MODEL = "dream_sugar_chat_model";
const DEFAULT_CHARACTER_ID = "kaede";
const CHAT_MODELS = ["gpt-5.2", "gpt-5.1", "gpt-5", "gpt-4.1", "gpt-4o"];

const storage = typeof localStorage !== "undefined" ? localStorage : null;

let session = loadJSON(STORAGE_SESSION, null);
let authMode = "login";
let currentView = "home";
let currentProfileTab = "posts";
let currentProfileCharacterId = DEFAULT_CHARACTER_ID;
let currentChatUser = "zhihao";
let currentChatModel = storage?.getItem(STORAGE_CHAT_MODEL) || "gpt-5.2";
let messages = loadJSON(STORAGE_MESSAGES, {});
let likedPostIds = [];
let profiles = {};
let characters = {};
let aiSettings = {};
let aiRequests = [];
let posts = [];
let remoteReady = false;
let health = null;
let mentionQuery = "";

const baseCharacters = Object.fromEntries(Object.values(users).map(user => [user.id, {
  id: user.id,
  owner_id: "system",
  name: user.name,
  handle: user.handle,
  avatar_url: user.avatar,
  bio: user.bio,
  personality: user.profile?.personality || "",
  appearance: user.profile?.appearance || "",
  speaking_style: user.profile?.speakingStyle || "",
  prompt: user.prompt || "",
  isAI: true,
  isBase: true
}]));

init();

async function init() {
  hydrateFallbackData();
  renderShell();
  await refreshHealth();
  await refreshRemoteData({ silent: true });
  showHome();
}

function hydrateFallbackData() {
  characters = { ...baseCharacters };
  profiles.system = {
    id: "system",
    username: "kaede_728",
    role: "admin",
    display_name: "西島楓",
    avatar_url: "images/kaede.jpg",
    player_character_id: DEFAULT_CHARACTER_ID
  };
  posts = defaultPosts.map(post => ({
    id: String(post.id),
    author_id: "system",
    character_id: post.author || DEFAULT_CHARACTER_ID,
    ai_character_id: post.author || null,
    text: post.text,
    image_url: post.image || "",
    created_at: new Date(Date.now() - Number(post.id || 1) * 120000).toISOString(),
    comments: (post.comments || []).map(comment => ({
      id: String(comment.id),
      author_id: "system",
      text: comment.text,
      ai_character_id: null,
      created_at: new Date().toISOString(),
      replies: (comment.replies || []).map(reply => ({
        id: String(reply.id),
        character_id: reply.author || post.author || DEFAULT_CHARACTER_ID,
        text: reply.text,
        created_at: new Date().toISOString()
      }))
    }))
  }));
}

async function refreshHealth() {
  try {
    const response = await fetch("/api/health");
    health = await response.json();
  } catch {
    health = { ok: false, supabaseConfigured: false, openaiConfigured: false };
  }
  renderConnectionCard();
}

async function refreshRemoteData(options = {}) {
  try {
    const response = await fetch("/api/bootstrap");
    if (!response.ok) throw new Error(`API ${response.status}`);
    const data = await response.json();
    profiles = { ...profiles, ...Object.fromEntries((data.profiles || []).map(profile => [profile.id, profile])) };
    characters = { ...baseCharacters, ...Object.fromEntries((data.characters || []).map(character => [character.id, normalizeCharacter(character)])) };
    aiSettings = Object.fromEntries((data.aiSettings || []).map(setting => [`${setting.owner_id}:${setting.character_id}`, setting]));
    aiRequests = data.aiRequests || [];
    const remotePosts = (data.posts || []).map(normalizePost);
    if (remotePosts.length) posts = remotePosts;
    if (session?.id && profiles[session.id]) {
      session = { ...session, ...profiles[session.id] };
      saveJSON(STORAGE_SESSION, session);
    }
    remoteReady = true;
    renderShell();
    refreshCurrentView();
    if (!options.silent) showToast("花園已同步");
  } catch (error) {
    console.warn("bootstrap fallback:", error);
    remoteReady = false;
    renderShell();
    refreshCurrentView();
    if (!options.silent) showToast("尚未連接 Supabase，只能看本機預覽資料");
  }
  renderConnectionCard();
}

function normalizeCharacter(character) {
  const handle = normalizeHandle(character.handle || character.name || "oc");
  return {
    id: character.id,
    owner_id: character.owner_id,
    name: character.name || "未命名 OC",
    handle: `@${handle}`,
    avatar_url: character.avatar_url || "images/kaede.jpg",
    bio: [character.personality, character.appearance].filter(Boolean).join(" / "),
    personality: character.personality || "",
    appearance: character.appearance || "",
    speaking_style: character.speaking_style || "",
    prompt: character.prompt || "",
    isAI: false,
    isBase: false,
    created_at: character.created_at
  };
}

function normalizePost(post) {
  return {
    id: String(post.id),
    author_id: post.author_id || "system",
    character_id: post.character_id || DEFAULT_CHARACTER_ID,
    ai_character_id: post.ai_character_id || null,
    text: post.text || "",
    image_url: post.image_url || "",
    created_at: post.created_at || new Date().toISOString(),
    comments: (post.comments || []).map(comment => ({
      id: String(comment.id),
      author_id: comment.author_id || "system",
      text: comment.text || "",
      ai_character_id: comment.ai_character_id || null,
      created_at: comment.created_at || new Date().toISOString(),
      replies: (comment.replies || []).map(reply => ({
        id: String(reply.id),
        character_id: reply.character_id,
        text: reply.text || "",
        created_at: reply.created_at || new Date().toISOString()
      }))
    }))
  };
}

function isAdmin() {
  return session?.role === "admin" && session?.username === "kaede_728";
}

function getPlayerCharacter() {
  if (session?.player_character_id && characters[session.player_character_id]) return characters[session.player_character_id];
  return baseCharacters[DEFAULT_CHARACTER_ID];
}

function hasPlayerOC() {
  return Boolean(session?.player_character_id && characters[session.player_character_id] && !characters[session.player_character_id].isAI);
}

function getCharacter(id) {
  return characters[id] || baseCharacters[id] || baseCharacters[DEFAULT_CHARACTER_ID];
}

function getProfile(id) {
  const profile = profiles[id];
  if (!profile) return profiles.system;
  if (profile.player_character_id && characters[profile.player_character_id]) {
    const character = characters[profile.player_character_id];
    return { ...profile, display_name: character.name, avatar_url: character.avatar_url };
  }
  return profile;
}

function getAICharacters() {
  return Object.values(baseCharacters);
}

function getUserCharacters() {
  return Object.values(characters).filter(character => !character.isAI);
}

function getChatCharacters() {
  return getAICharacters().filter(character => character.id !== DEFAULT_CHARACTER_ID);
}

function getCharacterByHandle(handle, list) {
  const normalized = normalizeHandle(handle);
  return list.find(character => normalizeHandle(character.handle) === normalized);
}

function getMentionedAICharacter(text) {
  const matches = [...String(text || "").matchAll(/@([a-zA-Z0-9_\-\u4e00-\u9fff]+)/g)];
  for (const match of matches) {
    const character = getCharacterByHandle(match[1], getAICharacters());
    if (character) return character;
  }
  return null;
}

function renderShell() {
  const player = getPlayerCharacter();
  setText("composerName", player.name);
  setSrc("composerAvatar", player.avatar_url);
  setSrc("navProfileAvatar", player.avatar_url);
  const postInput = document.getElementById("postInput");
  if (postInput) {
    postInput.placeholder = session
      ? hasPlayerOC() ? "撒一點夢糖吧。輸入 @ 可以標記 AI 角色。" : "請先建立自己的 OC 才能發文。"
      : "訪客只能瀏覽。登入並建立 OC 後才能發文。";
  }
  const authBtn = document.getElementById("authBtn");
  if (authBtn) {
    authBtn.textContent = session ? (isAdmin() ? "管理" : "設定") : "登入";
    authBtn.onclick = session ? showOCManager : showAuth;
  }
  const adminPanel = document.getElementById("adminPanel");
  if (adminPanel) adminPanel.style.display = isAdmin() ? "grid" : "none";
  setValue("profileNameInput", session?.display_name || "");
  renderConnectionCard();
  renderMyOCList();
  renderAISettingSelect();
  renderAIRequests();
  renderAdminRequests();
}

function renderConnectionCard() {
  const card = document.getElementById("connectionCard");
  if (!card) return;
  if (!health) {
    card.innerHTML = `<strong>連線檢查中</strong><span>正在確認資料庫與 AI 狀態。</span>`;
    return;
  }
  const dbOk = Boolean(health.supabaseConfigured && remoteReady);
  card.className = `status-card ${dbOk ? "ok" : "warn"}`;
  card.innerHTML = `
    <strong>${dbOk ? "Supabase 已連接" : "Supabase 尚未連接"}</strong>
    <span>${dbOk ? "發文、留言與設定會存進資料庫。" : "請在 .env / Render 設定 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY，目前只會顯示本機預覽資料。"}</span>
  `;
}

function setActiveView(viewId) {
  document.querySelectorAll(".view").forEach(view => view.classList.remove("active"));
  document.getElementById(viewId)?.classList.add("active");
}

function setTopbar(title, showBack = false) {
  setText("topbarTitle", title);
  document.getElementById("backBtn").style.display = showBack ? "inline-flex" : "none";
}

function setNav(active) {
  document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
  if (active) document.getElementById(`nav${active}`)?.classList.add("active");
}

function showHome() {
  currentView = "home";
  setActiveView("homeView");
  setTopbar("夢糖庭院");
  setNav("Home");
  renderHomeFeed();
}

function showSearch() {
  currentView = "search";
  setActiveView("searchView");
  setTopbar("搜尋", true);
  setNav("Search");
  renderSearch();
}

function showMessages(characterId = currentChatUser) {
  if (!session) return requireLogin();
  if (!hasPlayerOC()) return requireOC();
  currentView = "messages";
  currentChatUser = characterId;
  setActiveView("messagesView");
  setTopbar("私語", true);
  setNav("Messages");
  renderMessages();
}

function showProfile(characterId) {
  currentView = "profile";
  currentProfileCharacterId = characterId;
  currentProfileTab = "posts";
  setActiveView("profileView");
  setTopbar(getCharacter(characterId).name, true);
  setNav("Profile");
  renderProfile();
  renderProfileFeed();
}

function showPlayerProfile() {
  showProfile(getPlayerCharacter().id);
}

function showAuth() {
  currentView = "auth";
  setActiveView("authView");
  setTopbar(authMode === "login" ? "登入" : "註冊", true);
  setNav("");
  renderAuthMode();
}

function showOCManager() {
  if (!session) return showAuth();
  currentView = "oc";
  setActiveView("ocView");
  setTopbar(isAdmin() ? "管理者模式" : "我的小庭院", true);
  setNav("Profile");
  renderShell();
}

function goBack() {
  showHome();
}

function renderAuthMode() {
  const isRegister = authMode === "register";
  setText("authTitle", isRegister ? "註冊" : "登入");
  setText("authToggle", isRegister ? "已有帳號？登入" : "沒有帳號？註冊");
  document.querySelectorAll(".register-only").forEach(element => element.style.display = isRegister ? "block" : "none");
}

function toggleAuthMode() {
  authMode = authMode === "login" ? "register" : "login";
  renderAuthMode();
}

async function submitAuth() {
  const username = normalizeText(getValue("authUsername"));
  const password = document.getElementById("authPassword").value;
  const displayName = normalizeText(getValue("authDisplayName"));
  if (!username || !password) return showToast("請輸入帳號和密碼");
  try {
    const response = await fetch(`/api/auth/${authMode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, displayName })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `API ${response.status}`);
    session = data.profile;
    saveJSON(STORAGE_SESSION, session);
    profiles[session.id] = session;
    await refreshRemoteData({ silent: true });
    showToast(isAdmin() ? "西島楓最高權限已開啟" : "登入成功");
    hasPlayerOC() || isAdmin() ? showHome() : showOCManager();
  } catch (error) {
    showToast(error.message || "登入失敗");
  }
}

function logout() {
  session = null;
  storage?.removeItem(STORAGE_SESSION);
  renderShell();
  showHome();
  showToast("已登出");
}

function renderHomeFeed() {
  renderFeed("homeFeed", sortPosts(posts));
}

function sortPosts(list) {
  return [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function renderFeed(containerId, list) {
  const container = document.getElementById(containerId);
  container.innerHTML = list.length ? list.map(renderPost).join("") : `<div class="empty">${remoteReady ? "庭院裡還沒有貼文" : "尚未連接 Supabase，目前顯示本機預覽資料"}</div>`;
}

function renderPost(post) {
  const author = getProfile(post.author_id);
  const posterCharacter = getCharacter(post.character_id);
  const targetAI = post.ai_character_id ? getCharacter(post.ai_character_id) : null;
  const liked = likedPostIds.includes(post.id);
  return `
    <article class="thread-post">
      <div class="thread-rail">
        <img class="avatar" src="${author.avatar_url || "images/kaede.jpg"}" alt="${escapeAttribute(author.display_name)}">
        <span></span>
      </div>
      <div class="thread-body">
        <header class="thread-head">
          <div>
            <strong>${escapeHTML(author.display_name)}</strong>
            <span>${escapeHTML(posterCharacter.handle || "")}</span>
            <span>${formatTime(post.created_at)}</span>
          </div>
          ${isAdmin() ? `<button class="danger-link" onclick="adminDeletePost('${post.id}')">刪除</button>` : ""}
        </header>
        <p class="thread-text">${linkMentions(post.text)}</p>
        ${targetAI ? `<div class="tag-row">標記 AI：<button onclick="showProfile('${targetAI.id}')">${escapeHTML(targetAI.handle)} ${escapeHTML(targetAI.name)}</button></div>` : ""}
        ${post.image_url ? `<img class="post-image" src="${post.image_url}" alt="">` : ""}
        <div class="actions">
          <button class="action ${liked ? "liked" : ""}" onclick="toggleLike('${post.id}')">${liked ? "♥" : "♡"}</button>
          <button class="action" onclick="focusComment('${post.id}')">↩</button>
          <button class="action" onclick="showToast('分享功能之後再加')">↗</button>
        </div>
        <div class="comments">${renderComments(post)}</div>
        <div class="reply-input">
          <input id="commentInput-${post.id}" placeholder="${session ? "留言。輸入 @AI 才會觸發角色回覆。" : "訪客只能觀看，登入後才能留言。"}" onkeydown="handleCommentKey(event, '${post.id}')">
          <button onclick="submitPostComment('${post.id}')">送出</button>
        </div>
      </div>
    </article>
  `;
}

function renderComments(post) {
  return (post.comments || []).map(comment => {
    const author = getProfile(comment.author_id);
    return `
      <div class="comment">
        <img class="avatar small" src="${author.avatar_url || "images/kaede.jpg"}" alt="${escapeAttribute(author.display_name)}">
        <div class="comment-body">
          <div class="comment-head">
            <strong>${escapeHTML(author.display_name)}</strong>
            <span>${formatTime(comment.created_at)}</span>
            ${isAdmin() ? `<button class="danger-link" onclick="adminDeleteComment('${comment.id}')">刪除</button>` : ""}
          </div>
          <div class="comment-text">${linkMentions(comment.text)}</div>
          ${renderCommentReplies(comment)}
        </div>
      </div>
    `;
  }).join("");
}

function renderCommentReplies(comment) {
  return (comment.replies || []).map(reply => {
    const character = getCharacter(reply.character_id);
    return `
      <div class="reply">
        <img class="avatar small" src="${character.avatar_url}" alt="${escapeAttribute(character.name)}">
        <div class="reply-bubble">
          <div class="comment-head"><strong>${escapeHTML(character.name)}</strong><span>${formatTime(reply.created_at)}</span></div>
          <div class="comment-text">${escapeHTML(reply.text)}</div>
        </div>
      </div>
    `;
  }).join("");
}

async function addPost() {
  if (!session) return requireLogin();
  if (!hasPlayerOC() && !isAdmin()) return requireOC();
  const input = document.getElementById("postInput");
  const text = normalizeText(input.value);
  if (!text) return showToast("請輸入貼文內容");
  const player = getPlayerCharacter();
  const mentionedAI = getMentionedAICharacter(text);
  try {
    const response = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authorId: session.id, characterId: player.id, aiCharacterId: mentionedAI?.id || null, text })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `API ${response.status}`);
    posts.unshift(normalizePost(data.post));
    input.value = "";
    closeMentionMenu();
    renderHomeFeed();
    await refreshRemoteData({ silent: true });
  } catch (error) {
    showToast(error.message || "發文失敗");
  }
}

async function submitPostComment(postId) {
  if (!session) return requireLogin();
  if (!hasPlayerOC() && !isAdmin()) return requireOC();
  const input = document.getElementById(`commentInput-${postId}`);
  const text = normalizeText(input?.value);
  if (!text) return showToast("請輸入留言");
  const post = posts.find(item => String(item.id) === String(postId));
  if (!post) return;
  const mentionedAI = getMentionedAICharacter(text);
  const tempComment = { id: `temp_${Date.now()}`, author_id: session.id, text, ai_character_id: mentionedAI?.id || null, created_at: new Date().toISOString(), replies: [] };
  post.comments.push(tempComment);
  input.value = "";
  refreshCurrentView();
  try {
    const response = await fetch("/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId, authorId: session.id, text, aiCharacterId: mentionedAI?.id || null })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `API ${response.status}`);
    const index = post.comments.findIndex(comment => comment.id === tempComment.id);
    if (index >= 0) post.comments[index] = normalizePost({ comments: [data.comment] }).comments[0];
    await refreshRemoteData({ silent: true });
  } catch (error) {
    showToast(error.message || "留言失敗");
  }
}

function handlePostInput() {
  const input = document.getElementById("postInput");
  const beforeCursor = input.value.slice(0, input.selectionStart);
  const match = beforeCursor.match(/@([a-zA-Z0-9_\-\u4e00-\u9fff]*)$/);
  if (!match) return closeMentionMenu();
  mentionQuery = match[1].toLowerCase();
  renderMentionMenu();
}

function handlePostKey(event) {
  if (event.key === "Escape") closeMentionMenu();
}

function renderMentionMenu() {
  const menu = document.getElementById("mentionMenu");
  const matches = getAICharacters().filter(character => `${character.handle} ${character.name}`.toLowerCase().includes(mentionQuery)).slice(0, 8);
  if (!matches.length) return closeMentionMenu();
  menu.innerHTML = matches.map(character => `
    <button type="button" onclick="insertMention('${character.id}')">
      <img src="${character.avatar_url}" alt="${escapeAttribute(character.name)}">
      <span><strong>${escapeHTML(character.name)}</strong><small>${escapeHTML(character.handle)}</small></span>
    </button>
  `).join("");
  menu.classList.add("show");
}

function insertMention(characterId) {
  const input = document.getElementById("postInput");
  const character = getCharacter(characterId);
  const start = input.value.slice(0, input.selectionStart).replace(/@([a-zA-Z0-9_\-\u4e00-\u9fff]*)$/, `${character.handle} `);
  const end = input.value.slice(input.selectionStart);
  input.value = start + end;
  input.focus();
  input.selectionStart = input.selectionEnd = start.length;
  closeMentionMenu();
}

function closeMentionMenu() {
  const menu = document.getElementById("mentionMenu");
  if (!menu) return;
  menu.classList.remove("show");
  menu.innerHTML = "";
}

async function saveProfile(options = {}) {
  if (!session) return showAuth();
  const displayName = normalizeText(getValue("profileNameInput") || session.display_name);
  const file = document.getElementById("profileAvatarInput")?.files?.[0];
  const avatarDataUrl = file ? await fileToDataUrl(file) : "";
  try {
    const response = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: session.id, displayName, avatarDataUrl })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `API ${response.status}`);
    session = { ...session, ...data.profile };
    saveJSON(STORAGE_SESSION, session);
    profiles[session.id] = session;
    renderShell();
    if (!options.silent) showToast("帳號資料已儲存");
  } catch (error) {
    showToast(error.message || "儲存失敗");
  }
}

async function createOC() {
  if (!session) return showAuth();
  const name = normalizeText(getValue("ocNameInput"));
  const handle = normalizeHandle(getValue("ocHandleInput") || name);
  const personality = normalizeText(getValue("ocPersonalityInput"));
  const appearance = normalizeText(getValue("ocAppearanceInput"));
  const speakingStyle = normalizeText(getValue("ocSpeakingInput"));
  const file = document.getElementById("ocAvatarInput")?.files?.[0];
  const avatarDataUrl = file ? await fileToDataUrl(file) : "";
  if (!name || !handle) return showToast("請填角色名字和 @帳號");
  try {
    const response = await fetch("/api/characters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerId: session.id, name, handle, personality, appearance, speakingStyle, avatarDataUrl })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `API ${response.status}`);
    const character = normalizeCharacter(data.character);
    characters[character.id] = character;
    session = { ...session, player_character_id: character.id };
    profiles[session.id] = { ...profiles[session.id], player_character_id: character.id };
    saveJSON(STORAGE_SESSION, session);
    ["ocNameInput", "ocHandleInput", "ocPersonalityInput", "ocAppearanceInput", "ocSpeakingInput"].forEach(id => setValue(id, ""));
    renderShell();
    refreshCurrentView();
    showToast("OC 已儲存");
  } catch (error) {
    showToast(error.message || "OC 儲存失敗");
  }
}

function renderAISettingSelect() {
  const select = document.getElementById("aiSettingCharacterSelect");
  if (!select) return;
  const oldValue = select.value || currentChatUser;
  select.innerHTML = getChatCharacters().map(character => `<option value="${character.id}">${escapeHTML(character.name)} ${escapeHTML(character.handle)}</option>`).join("");
  select.value = getChatCharacters().some(character => character.id === oldValue) ? oldValue : "zhihao";
  loadAISettingForm();
}

function loadAISettingForm() {
  const characterId = document.getElementById("aiSettingCharacterSelect")?.value;
  const setting = aiSettings[`${session?.id}:${characterId}`] || {};
  setValue("aiMemoryInput", setting.memory || "");
  setValue("aiModeInput", setting.interaction_mode || "");
  setValue("aiNicknameInput", setting.nickname || "");
  setValue("aiRulesInput", setting.rules || "");
}

async function saveAISetting() {
  if (!session) return requireLogin();
  if (!hasPlayerOC() && !isAdmin()) return requireOC();
  const characterId = document.getElementById("aiSettingCharacterSelect")?.value;
  try {
    const response = await fetch("/api/ai-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerId: session.id, characterId, memory: getValue("aiMemoryInput"), interactionMode: getValue("aiModeInput"), nickname: getValue("aiNicknameInput"), rules: getValue("aiRulesInput") })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `API ${response.status}`);
    aiSettings[`${session.id}:${characterId}`] = data.setting;
    showToast("AI 記憶已儲存");
  } catch (error) {
    showToast(error.message || "儲存 AI 記憶失敗");
  }
}

async function submitAIRequest() {
  if (!session) return requireLogin();
  const payload = {
    ownerId: session.id,
    name: getValue("requestAINameInput"),
    handle: getValue("requestAIHandleInput"),
    concept: getValue("requestAIConceptInput"),
    personality: getValue("requestAIPersonalityInput"),
    appearance: getValue("requestAIAppearanceInput"),
    speakingStyle: getValue("requestAISpeakingInput"),
    prompt: getValue("requestAIPromptInput")
  };
  if (!payload.name || !payload.handle) return showToast("請填 AI 角色名字和帳號");
  try {
    const response = await fetch("/api/ai-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `API ${response.status}`);
    aiRequests.unshift(data.request);
    ["requestAINameInput", "requestAIHandleInput", "requestAIConceptInput", "requestAIPersonalityInput", "requestAIAppearanceInput", "requestAISpeakingInput", "requestAIPromptInput"].forEach(id => setValue(id, ""));
    renderAIRequests();
    showToast("申請已送出，等待管理者審核");
  } catch (error) {
    showToast(error.message || "送出申請失敗");
  }
}

function renderAIRequests() {
  const list = document.getElementById("myAIRequestList");
  if (!list) return;
  const mine = session ? aiRequests.filter(request => request.owner_id === session.id) : [];
  list.innerHTML = mine.length ? mine.map(renderRequestCard).join("") : `<div class="empty slim">尚未送出 AI 角色申請。</div>`;
}

function renderAdminRequests() {
  const list = document.getElementById("adminRequestList");
  if (!list) return;
  if (!isAdmin()) {
    list.innerHTML = "";
    return;
  }
  list.innerHTML = aiRequests.length ? aiRequests.map(request => `
    ${renderRequestCard(request)}
    <div class="admin-actions">
      <button class="ghost-btn" onclick="adminUpdateRequest('${request.id}', 'approved')">通過</button>
      <button class="ghost-btn" onclick="adminUpdateRequest('${request.id}', 'rejected')">拒絕</button>
      <button class="ghost-btn" onclick="adminUpdateRequest('${request.id}', 'pending')">待審</button>
    </div>
  `).join("") : `<div class="empty slim">目前沒有 AI 角色申請。</div>`;
}

function renderRequestCard(request) {
  const owner = getProfile(request.owner_id);
  return `
    <div class="request-card">
      <strong>${escapeHTML(request.name)} <span>@${escapeHTML(request.handle)}</span></strong>
      <p>${escapeHTML(request.concept || "沒有填寫概念")}</p>
      <small>${escapeHTML(owner.display_name || "玩家")} · ${statusLabel(request.status)}</small>
    </div>
  `;
}

async function adminUpdateRequest(id, status) {
  if (!isAdmin()) return showToast("只有 @kaede_728 可以管理");
  try {
    const response = await fetch(`/api/admin/ai-requests/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminId: session.id, status })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `API ${response.status}`);
    aiRequests = aiRequests.map(request => request.id === id ? data.request : request);
    renderAdminRequests();
    renderAIRequests();
    showToast("申請狀態已更新");
  } catch (error) {
    showToast(error.message || "更新失敗");
  }
}

async function adminDeletePost(postId) {
  if (!isAdmin()) return showToast("只有 @kaede_728 可以管理");
  try {
    const response = await fetch(`/api/admin/posts/${postId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminId: session.id })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `API ${response.status}`);
    posts = posts.filter(post => post.id !== postId);
    refreshCurrentView();
    showToast("貼文已刪除");
  } catch (error) {
    showToast(error.message || "刪除失敗");
  }
}

async function adminDeleteComment(commentId) {
  if (!isAdmin()) return showToast("只有 @kaede_728 可以管理");
  try {
    const response = await fetch(`/api/admin/comments/${commentId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminId: session.id })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `API ${response.status}`);
    posts.forEach(post => post.comments = post.comments.filter(comment => comment.id !== commentId));
    refreshCurrentView();
    showToast("留言已刪除");
  } catch (error) {
    showToast(error.message || "刪除失敗");
  }
}

function renderMyOCList() {
  const list = document.getElementById("myOCList");
  if (!list) return;
  if (!session) {
    list.innerHTML = `<div class="empty slim">登入後可以建立自己的 OC。</div>`;
    return;
  }
  const owned = getUserCharacters().filter(character => character.owner_id === session.id);
  list.innerHTML = owned.length ? owned.map(character => renderAccountCard(character)).join("") : `<div class="empty slim">還沒有 OC。請先建立一個角色。</div>`;
}

function renderSearch() {
  const keyword = normalizeText(getValue("searchInput")).toLowerCase();
  const playerCharacters = getUserCharacters().filter(character => `${character.name} ${character.handle} ${character.bio}`.toLowerCase().includes(keyword));
  const aiCharacters = getAICharacters().filter(character => `${character.name} ${character.handle} ${character.bio}`.toLowerCase().includes(keyword));
  document.getElementById("accountList").innerHTML = `
    <section class="search-section">
      <h2>玩家帳號 / OC</h2>
      <div class="account-list">${playerCharacters.length ? playerCharacters.map(renderAccountCard).join("") : `<div class="empty slim">沒有找到玩家 OC</div>`}</div>
    </section>
    <section class="search-section">
      <h2>AI 角色</h2>
      <div class="account-list">${aiCharacters.length ? aiCharacters.map(renderAccountCard).join("") : `<div class="empty slim">沒有找到 AI 角色</div>`}</div>
    </section>
  `;
}

function renderAccountCard(character) {
  return `
    <button class="account-card" onclick="showProfile('${character.id}')">
      <img class="avatar" src="${character.avatar_url}" alt="${escapeAttribute(character.name)}">
      <div class="account-info">
        <strong>${escapeHTML(character.name)}</strong>
        <span>${escapeHTML(character.handle)} ${character.isAI ? "AI" : "OC"}</span>
        <p>${escapeHTML(character.bio || "尚未填寫角色設定")}</p>
      </div>
    </button>
  `;
}

function renderMessages() {
  const contacts = getChatCharacters();
  if (!contacts.length) return;
  if (!contacts.some(character => character.id === currentChatUser)) currentChatUser = contacts[0].id;
  const currentCharacter = getCharacter(currentChatUser);
  const conversation = getConversation(currentChatUser);
  const modelOptions = CHAT_MODELS.map(model => `<option value="${model}" ${model === currentChatModel ? "selected" : ""}>${model}</option>`).join("");
  document.getElementById("conversationList").innerHTML = contacts.map(character => `
    <button class="conversation-card ${character.id === currentChatUser ? "active" : ""}" onclick="openConversation('${character.id}')">
      <img src="${character.avatar_url}" alt="${escapeAttribute(character.name)}">
      <span>${escapeHTML(character.name)}</span>
    </button>
  `).join("");
  document.getElementById("chatHeader").innerHTML = `
    <img src="${currentCharacter.avatar_url}" alt="${escapeAttribute(currentCharacter.name)}">
    <div class="chat-title"><strong>${escapeHTML(currentCharacter.name)}</strong><span>${escapeHTML(currentCharacter.handle)} · 私語</span></div>
    <label class="model-picker"><span>模型</span><select onchange="setChatModel(this.value)">${modelOptions}</select></label>
  `;
  document.getElementById("chatLog").innerHTML = conversation.map(item => `<div class="message ${item.role === "me" ? "me" : "them"}">${formatMessageHTML(item.text)}</div>`).join("");
  const log = document.getElementById("chatLog");
  log.scrollTop = log.scrollHeight;
}

function getConversation(characterId) {
  if (!messages[characterId]) {
    messages[characterId] = [{ role: "them", text: `*${getCharacter(characterId).name} 抬眼看向你。*\n\n**說吧。**` }];
    saveJSON(STORAGE_MESSAGES, messages);
  }
  return messages[characterId];
}

function openConversation(characterId) {
  currentChatUser = characterId;
  renderMessages();
}

function setChatModel(model) {
  currentChatModel = CHAT_MODELS.includes(model) ? model : "gpt-5.2";
  storage?.setItem(STORAGE_CHAT_MODEL, currentChatModel);
}

function handleMessageKey(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

async function sendMessage() {
  if (!session) return requireLogin();
  if (!hasPlayerOC() && !isAdmin()) return requireOC();
  const input = document.getElementById("messageInput");
  const text = normalizeText(input.value);
  if (!text) return showToast("請輸入訊息");
  const conversation = getConversation(currentChatUser);
  const character = getCharacter(currentChatUser);
  conversation.push({ role: "me", text });
  input.value = "";
  saveJSON(STORAGE_MESSAGES, messages);
  renderMessages();
  setText("chatStatus", `${character.name} 正在回覆...`);
  const reply = await createCharacterReply(character, text, { history: conversation.slice(-10) });
  conversation.push({ role: "them", text: reply });
  saveJSON(STORAGE_MESSAGES, messages);
  setText("chatStatus", "");
  renderMessages();
}

async function createCharacterReply(character, text, context) {
  const prompt = users[character.id] ? buildDMNovelPrompt(users[character.id]) : "";
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerId: session.id, characterId: character.id, characterName: character.name, model: currentChatModel, prompt, message: text, context })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `API ${response.status}`);
    return normalizeText(data.reply) || fallbackReply(character.id);
  } catch (error) {
    showToast(error.message || "AI 回覆失敗");
    return fallbackReply(character.id);
  }
}

function renderProfile() {
  const character = getCharacter(currentProfileCharacterId);
  const list = posts.filter(post => post.character_id === character.id || post.ai_character_id === character.id);
  document.getElementById("profileArea").innerHTML = `
    <div class="profile-inner">
      <img class="avatar-big" src="${character.avatar_url}" alt="${escapeAttribute(character.name)}">
      <div class="display-name">${escapeHTML(character.name)}</div>
      <div class="handle">${escapeHTML(character.handle)} ${character.isAI ? "AI 角色" : "玩家 OC"}</div>
      <p class="bio">${escapeHTML(character.bio || character.personality || "尚未填寫角色設定")}</p>
      <div class="stats"><span><strong>${list.length}</strong> 貼文</span><span><strong>${getProfileReplyCount(character.id)}</strong> 回覆</span></div>
    </div>
  `;
}

function setProfileTab(tab, element) {
  currentProfileTab = tab;
  document.querySelectorAll("#profileView .tab").forEach(item => item.classList.remove("active"));
  element?.classList.add("active");
  renderProfileFeed();
}

function renderProfileFeed() {
  const character = getCharacter(currentProfileCharacterId);
  let list = posts.filter(post => post.character_id === character.id || post.ai_character_id === character.id);
  if (currentProfileTab === "replies") list = posts.filter(post => post.comments.some(comment => comment.replies.some(reply => reply.character_id === character.id)));
  renderFeed("profileFeed", sortPosts(list));
}

function getProfileReplyCount(characterId) {
  return posts.reduce((count, post) => count + post.comments.reduce((sum, comment) => sum + comment.replies.filter(reply => reply.character_id === characterId).length, 0), 0);
}

function toggleLike(postId) {
  likedPostIds = likedPostIds.includes(postId) ? likedPostIds.filter(id => id !== postId) : [...likedPostIds, postId];
  refreshCurrentView();
}

function focusComment(postId) {
  if (!session) return requireLogin();
  document.getElementById(`commentInput-${postId}`)?.focus();
}

function handleCommentKey(event, postId) {
  if (event.key === "Enter") {
    event.preventDefault();
    submitPostComment(postId);
  }
}

function focusComposer() {
  showHome();
  if (!session) return requireLogin();
  if (!hasPlayerOC() && !isAdmin()) return requireOC();
  setTimeout(() => document.getElementById("postInput")?.focus(), 100);
}

function requireLogin() {
  showToast("訪客只能觀看，請先登入");
  showAuth();
}

function requireOC() {
  showToast("請先建立自己的 OC");
  showOCManager();
}

function fallbackReply(characterId) {
  const character = getCharacter(characterId);
  return `**${character.name} 沉默了一下。**\n\n*他的視線停在你身上，像是在等你把話說完。*`;
}

function refreshCurrentView() {
  if (currentView === "home") renderHomeFeed();
  if (currentView === "search") renderSearch();
  if (currentView === "messages") renderMessages();
  if (currentView === "profile") {
    renderProfile();
    renderProfileFeed();
  }
  if (currentView === "oc") renderShell();
}

function statusLabel(status) {
  return { pending: "待審", approved: "已通過", rejected: "已拒絕" }[status] || status;
}

function loadJSON(key, fallback) {
  try {
    const saved = storage?.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  storage?.setItem(key, JSON.stringify(value));
}

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeHandle(value) {
  return String(value || "").replace(/^@/, "").trim().replace(/\s+/g, "_").replace(/[^\w\-\u4e00-\u9fff]/g, "").toLowerCase();
}

function formatTime(value) {
  if (!value) return "剛剛";
  const diff = Date.now() - new Date(value).getTime();
  if (Number.isNaN(diff) || diff < 60000) return "剛剛";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分鐘前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小時前`;
  return `${Math.floor(diff / 86400000)} 天前`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function linkMentions(value) {
  return escapeHTML(value).replace(/@([a-zA-Z0-9_\-\u4e00-\u9fff]+)/g, "<span class=\"mention\">@$1</span>");
}

function escapeHTML(value) {
  return String(value || "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[char]));
}

function escapeAttribute(value) {
  return escapeHTML(value).replace(/`/g, "&#096;");
}

function formatMessageHTML(value) {
  return escapeHTML(value).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>").replace(/\n/g, "<br>");
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setSrc(id, value) {
  const element = document.getElementById(id);
  if (element) element.src = value;
}

function setValue(id, value) {
  const element = document.getElementById(id);
  if (element) element.value = value;
}

function getValue(id) {
  return normalizeText(document.getElementById(id)?.value);
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1800);
}

if (typeof window !== "undefined") {
  Object.assign(window, {
    addPost,
    adminDeleteComment,
    adminDeletePost,
    adminUpdateRequest,
    createOC,
    focusComment,
    focusComposer,
    goBack,
    handleCommentKey,
    handleMessageKey,
    handlePostInput,
    handlePostKey,
    insertMention,
    loadAISettingForm,
    logout,
    openConversation,
    refreshRemoteData,
    renderSearch,
    saveAISetting,
    saveProfile,
    sendMessage,
    setChatModel,
    setProfileTab,
    showAuth,
    showHome,
    showMessages,
    showOCManager,
    showPlayerProfile,
    showProfile,
    showSearch,
    submitAIRequest,
    submitAuth,
    submitPostComment,
    toggleAuthMode,
    toggleLike
  });
}

import { users, buildDMNovelPrompt } from "./data.js";

const STORAGE_SESSION = "dream_sugar_session";
const STORAGE_MESSAGES = "dream_sugar_messages";
const STORAGE_CHAT_MODEL = "dream_sugar_chat_model";
const STORAGE_OC_EXTRA = "dream_sugar_oc_extra";
const STORAGE_NOTIFICATIONS = "dream_sugar_notifications";
const CHAT_MODELS = ["gpt-5.2", "gpt-5.1", "gpt-5", "gpt-4.1", "gpt-4o"];

const storage = typeof localStorage !== "undefined" ? localStorage : null;

let session = loadJSON(STORAGE_SESSION, null);
let authMode = "login";
let currentView = "home";
let currentProfileTab = "posts";
let currentProfileCharacterId = null;
let currentChatUser = "zhihao";
let currentChatModel = storage?.getItem(STORAGE_CHAT_MODEL) || "gpt-5.2";
let messages = loadJSON(STORAGE_MESSAGES, {});
let ocExtra = loadJSON(STORAGE_OC_EXTRA, {});
let notifications = loadJSON(STORAGE_NOTIFICATIONS, []);
let likedPostIds = [];
let profiles = {};
let characters = {};
let aiSettings = {};
let aiRequests = [];
let posts = [];
let remoteReady = false;
let mentionQuery = "";
let mentionInputId = "postInput";

const playerDefault = {
  id: "kaede_player",
  owner_id: "system",
  name: "西島楓",
  handle: "@kaede_728",
  avatar_url: "images/kaede.jpg",
  bio: "夢糖庭院的主人。",
  personality: "",
  appearance: "",
  speaking_style: "",
  isAI: false,
  isBase: true
};

const baseCharacters = Object.fromEntries(
  Object.values(users)
    .filter(user => user.id !== "kaede")
    .map(user => [user.id, {
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
    }])
);

init();

async function init() {
  hydrateFallbackData();
  renderShell();
  await refreshRemoteData({ silent: true });
  showHome();
}

function hydrateFallbackData() {
  characters = { ...baseCharacters, [playerDefault.id]: playerDefault };
  profiles.system = {
    id: "system",
    username: "kaede_728",
    role: "admin",
    display_name: "西島楓",
    avatar_url: "images/kaede.jpg",
    player_character_id: playerDefault.id
  };
  posts = [];
}

async function refreshRemoteData(options = {}) {
  try {
    const response = await fetch("/api/bootstrap");
    if (!response.ok) throw new Error(`API ${response.status}`);
    const data = await response.json();
    profiles = { ...profiles, ...Object.fromEntries((data.profiles || []).map(profile => [profile.id, profile])) };
    characters = {
      ...baseCharacters,
      [playerDefault.id]: playerDefault,
      ...Object.fromEntries((data.characters || []).map(character => [character.id, normalizeCharacter(character)]))
    };
    aiSettings = Object.fromEntries((data.aiSettings || []).map(setting => [`${setting.owner_id}:${setting.character_id}`, setting]));
    aiRequests = data.aiRequests || [];
    posts = (data.posts || []).map(normalizePost);
    if (session?.id && profiles[session.id]) {
      session = { ...session, ...profiles[session.id] };
      saveJSON(STORAGE_SESSION, session);
    }
    remoteReady = true;
    scanNotifications();
    renderShell();
    refreshCurrentView();
    if (!options.silent) showToast("已同步");
  } catch (error) {
    console.warn("bootstrap fallback:", error);
    remoteReady = false;
    renderShell();
    refreshCurrentView();
    if (!options.silent) showToast("資料同步失敗，請稍後再試");
  }
}

function normalizeCharacter(character) {
  const handle = normalizeHandle(character.handle || character.name || "oc");
  return {
    id: character.id,
    owner_id: character.owner_id,
    name: character.name || "未命名 OC",
    handle: `@${handle}`,
    avatar_url: character.avatar_url || "images/kaede.jpg",
    bio: getOCExtra(character.id).bio || [character.personality, character.appearance].filter(Boolean).join(" / "),
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
    character_id: post.character_id || getPlayerCharacter().id,
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
  if (isAdmin()) return playerDefault;
  return playerDefault;
}

function hasPlayerOC() {
  return Boolean(isAdmin() || (session?.player_character_id && characters[session.player_character_id] && !characters[session.player_character_id].isAI));
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

function getCharacter(id) {
  return characters[id] || baseCharacters[id] || playerDefault;
}

function getAICharacters() {
  return Object.values(baseCharacters);
}

function getUserCharacters() {
  return Object.values(characters).filter(character => !character.isAI);
}

function getMentionTargets() {
  return [...getUserCharacters(), ...getAICharacters()];
}

function getChatCharacters() {
  return getAICharacters();
}

function getOCExtra(characterId) {
  return ocExtra[characterId] || {};
}

function setOCExtra(characterId, patch) {
  ocExtra[characterId] = { ...getOCExtra(characterId), ...patch };
  saveJSON(STORAGE_OC_EXTRA, ocExtra);
}

function getCharacterByHandle(handle, list = getMentionTargets()) {
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

function getMentionedUserHandles(text) {
  return [...String(text || "").matchAll(/@([a-zA-Z0-9_\-\u4e00-\u9fff]+)/g)].map(match => normalizeHandle(match[1]));
}

function renderShell() {
  const player = getPlayerCharacter();
  setText("composerName", player.name);
  setSrc("composerAvatar", player.avatar_url);
  setSrc("navProfileAvatar", player.avatar_url);
  const authBtn = document.getElementById("authBtn");
  if (authBtn) {
    authBtn.textContent = session ? "設定" : "登入";
    authBtn.onclick = session ? showMemberArea : showAuth;
  }
  const adminBtn = document.getElementById("adminEntryBtn");
  if (adminBtn) adminBtn.style.display = isAdmin() ? "inline-flex" : "none";
  setValue("profileNameInput", session?.display_name || "");
  hydrateOCForm();
  renderNotifyBadge();
  renderAIRequests();
  renderAdminRequests();
}

function hydrateOCForm() {
  const player = getPlayerCharacter();
  const extra = getOCExtra(player.id);
  setValue("ocNameInput", player.isBase ? "" : player.name);
  setValue("ocHandleInput", player.isBase ? "" : normalizeHandle(player.handle));
  setValue("ocBioInput", extra.bio || player.bio || "");
  setValue("ocPersonalityInput", player.personality || "");
  setValue("ocAppearanceInput", player.appearance || "");
  setValue("ocSpeakingInput", player.speaking_style || "");
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

function showNotifications() {
  currentView = "notifications";
  setActiveView("notificationsView");
  setTopbar("通知", true);
  setNav("");
  renderNotifications();
}

function showMessages(characterId = currentChatUser) {
  if (!session) return requireLogin();
  if (!hasPlayerOC()) return requireOC();
  currentView = "messages";
  currentChatUser = characterId;
  setActiveView("messagesView");
  setTopbar("角色聊天區", true);
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
  showOCSettings();
}

function showAuth() {
  currentView = "auth";
  setActiveView("authView");
  setTopbar(authMode === "login" ? "登入" : "註冊", true);
  setNav("");
  renderAuthMode();
}

function showMemberArea() {
  if (!session) return showAuth();
  currentView = "member";
  setActiveView("memberView");
  setTopbar("會員專區", true);
  setNav("Profile");
  renderShell();
}

function showOCSettings() {
  if (!session) return requireLogin();
  currentView = "ocSettings";
  setActiveView("ocSettingsView");
  setTopbar("OC 設定", true);
  setNav("Profile");
  renderShell();
}

function showAIRequestPage() {
  if (!session) return requireLogin();
  currentView = "aiRequest";
  setActiveView("aiRequestView");
  setTopbar("申請 AI 角色", true);
  renderAIRequests();
}

function showAdminPanel() {
  if (!isAdmin()) return showToast("只有 @kaede_728 可以使用管理者模式");
  currentView = "admin";
  setActiveView("adminView");
  setTopbar("管理者模式", true);
  renderAdminRequests();
}

function goBack() {
  showHome();
}

function renderAuthMode() {
  const isRegister = authMode === "register";
  setText("authTitle", isRegister ? "註冊夢糖庭院" : "登入夢糖庭院");
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
    showToast(isAdmin() ? "西島楓管理者模式已開啟" : "登入成功");
    showMemberArea();
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
  container.innerHTML = list.length ? list.map(renderPost).join("") : `<div class="empty">目前還沒有任何貼文。</div>`;
}

function renderPost(post) {
  const author = getProfile(post.author_id);
  const posterCharacter = getCharacter(post.character_id);
  const targetAI = post.ai_character_id ? getCharacter(post.ai_character_id) : null;
  const liked = likedPostIds.includes(post.id);
  const canModify = session && (isAdmin() || post.author_id === session.id);
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
          ${canModify ? `<div class="post-tools"><button onclick="editPost('${post.id}')">編輯</button><button class="danger-link" onclick="deletePost('${post.id}')">刪除</button></div>` : ""}
        </header>
        <p class="thread-text" id="postText-${post.id}">${linkMentions(post.text)}</p>
        ${targetAI ? `<div class="tag-row">標記 AI：<button onclick="showProfile('${targetAI.id}')">${escapeHTML(targetAI.handle)} ${escapeHTML(targetAI.name)}</button></div>` : ""}
        ${post.image_url ? `<img class="post-image" src="${post.image_url}" alt="">` : ""}
        <div class="actions">
          <button class="action ${liked ? "liked" : ""}" onclick="toggleLike('${post.id}')">${liked ? "♥" : "♡"}</button>
          <button class="action" onclick="focusComment('${post.id}')">↩</button>
        </div>
        <div class="comments">${renderComments(post)}</div>
        <div class="reply-input mention-wrap">
          <input id="commentInput-${post.id}" placeholder="${session ? "留言。輸入 @ 可以選擇 AI 或玩家。" : "訪客只能觀看，登入後才能留言。"}" oninput="handleMentionInput('commentInput-${post.id}')" onkeydown="handleCommentKey(event, '${post.id}')">
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
          <div class="comment-head"><strong>${escapeHTML(author.display_name)}</strong><span>${formatTime(comment.created_at)}</span></div>
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
  if (!hasPlayerOC()) return requireOC();
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
    notifyMentions(text, "有人在貼文中提到了你");
    renderHomeFeed();
    await refreshRemoteData({ silent: true });
  } catch (error) {
    showToast(error.message || "發文失敗");
  }
}

async function editPost(postId) {
  const post = posts.find(item => item.id === postId);
  if (!post) return;
  const nextText = prompt("編輯貼文", post.text);
  if (nextText === null) return;
  const text = normalizeText(nextText);
  if (!text) return showToast("貼文不能空白");
  try {
    const response = await fetch(`/api/posts/${postId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: session.id, text })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `API ${response.status}`);
    post.text = data.post.text;
    refreshCurrentView();
    showToast("貼文已更新");
  } catch (error) {
    showToast(error.message || "編輯失敗");
  }
}

async function deletePost(postId) {
  if (!confirm("確定刪除這篇貼文？")) return;
  try {
    const response = await fetch(`/api/posts/${postId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: session.id })
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

async function submitPostComment(postId) {
  if (!session) return requireLogin();
  if (!hasPlayerOC()) return requireOC();
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
    if (data.comment?.replies?.length) addNotification("AI 回覆了你的留言", data.comment.replies[0].text);
    if (post.author_id !== session.id) addNotification("你回覆了一篇貼文", text);
    notifyMentions(text, "有人在留言中提到了你");
    await refreshRemoteData({ silent: true });
  } catch (error) {
    showToast(error.message || "留言失敗");
  }
}

function handleMentionInput(inputId) {
  mentionInputId = inputId;
  const input = document.getElementById(inputId);
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
  const targets = getMentionTargets()
    .filter(character => `${character.handle} ${character.name}`.toLowerCase().includes(mentionQuery))
    .slice(0, 10);
  if (!targets.length) return closeMentionMenu();
  menu.innerHTML = targets.map(character => `
    <button type="button" onclick="insertMention('${character.id}')">
      <img src="${character.avatar_url}" alt="${escapeAttribute(character.name)}">
      <span><strong>${escapeHTML(character.name)}</strong><small>${escapeHTML(character.handle)} ${character.isAI ? "AI" : "玩家"}</small></span>
    </button>
  `).join("");
  const input = document.getElementById(mentionInputId);
  input?.parentElement?.appendChild(menu);
  menu.classList.add("show");
}

function insertMention(characterId) {
  const input = document.getElementById(mentionInputId);
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
  const bio = normalizeText(getValue("ocBioInput"));
  const personality = normalizeText(getValue("ocPersonalityInput"));
  const appearance = normalizeText(getValue("ocAppearanceInput"));
  const speakingStyle = normalizeText(getValue("ocSpeakingInput"));
  const avatarFile = document.getElementById("ocAvatarInput")?.files?.[0];
  const coverFile = document.getElementById("ocCoverInput")?.files?.[0];
  const avatarDataUrl = avatarFile ? await fileToDataUrl(avatarFile) : "";
  const coverDataUrl = coverFile ? await fileToDataUrl(coverFile) : "";
  if (!name || !handle) return showToast("請填角色名字和 @帳號");
  const current = getPlayerCharacter();
  const isUpdate = current?.id && !current.isBase && current.owner_id === session.id;
  try {
    const response = await fetch(isUpdate ? `/api/characters/${current.id}` : "/api/characters", {
      method: isUpdate ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerId: session.id, name, handle, personality, appearance, speakingStyle, avatarDataUrl })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `API ${response.status}`);
    const character = normalizeCharacter(data.character);
    characters[character.id] = character;
    setOCExtra(character.id, { bio, cover_url: coverDataUrl || getOCExtra(character.id).cover_url || "" });
    session = { ...session, player_character_id: character.id };
    profiles[session.id] = { ...profiles[session.id], player_character_id: character.id };
    saveJSON(STORAGE_SESSION, session);
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

function renderChatMemoryPanel(characterId = currentChatUser) {
  const panel = document.getElementById("chatMemoryPanel");
  if (!panel) return;
  const setting = aiSettings[`${session?.id}:${characterId}`] || {};
  panel.innerHTML = `
    <details>
      <summary>該角色對你的 AI 記憶</summary>
      <label>重要記憶</label>
      <textarea class="field area" id="chatMemoryInput">${escapeHTML(setting.memory || "")}</textarea>
      <label>互動模式</label>
      <textarea class="field area" id="chatModeInput">${escapeHTML(setting.interaction_mode || "")}</textarea>
      <label>稱呼</label>
      <input class="field" id="chatNicknameInput" value="${escapeAttribute(setting.nickname || "")}">
      <label>不可違規規則</label>
      <textarea class="field area" id="chatRulesInput">${escapeHTML(setting.rules || "")}</textarea>
      <button class="primary-btn" onclick="saveChatAISetting()">儲存記憶</button>
    </details>
  `;
}

function loadAISettingForm() {
  const characterId = document.getElementById("aiSettingCharacterSelect")?.value;
  const setting = aiSettings[`${session?.id}:${characterId}`] || {};
  setValue("aiMemoryInput", setting.memory || "");
  setValue("aiModeInput", setting.interaction_mode || "");
  setValue("aiNicknameInput", setting.nickname || "");
  setValue("aiRulesInput", setting.rules || "");
}

async function saveAISetting(characterId = document.getElementById("aiSettingCharacterSelect")?.value, values = null) {
  if (!session) return requireLogin();
  if (!hasPlayerOC()) return requireOC();
  const payload = values || {
    memory: getValue("aiMemoryInput"),
    interactionMode: getValue("aiModeInput"),
    nickname: getValue("aiNicknameInput"),
    rules: getValue("aiRulesInput")
  };
  try {
    const response = await fetch("/api/ai-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerId: session.id, characterId, ...payload })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `API ${response.status}`);
    aiSettings[`${session.id}:${characterId}`] = data.setting;
    showToast("AI 記憶已儲存");
  } catch (error) {
    showToast(error.message || "儲存 AI 記憶失敗");
  }
}

function saveChatAISetting() {
  return saveAISetting(currentChatUser, {
    memory: getValue("chatMemoryInput"),
    interactionMode: getValue("chatModeInput"),
    nickname: getValue("chatNicknameInput"),
    rules: getValue("chatRulesInput")
  });
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
    renderAIRequests();
    showToast("申請已送出");
  } catch (error) {
    showToast(error.message || "送出申請失敗");
  }
}

function renderAIRequests() {
  const list = document.getElementById("myAIRequestList");
  if (!list) return;
  const mine = session ? aiRequests.filter(request => request.owner_id === session.id) : [];
  list.innerHTML = mine.length ? mine.map(renderRequestCard).join("") : `<div class="empty slim">尚未送出申請。</div>`;
}

function renderAdminRequests() {
  const list = document.getElementById("adminRequestList");
  if (!list) return;
  list.innerHTML = aiRequests.length ? aiRequests.map(request => `
    ${renderRequestCard(request)}
    <div class="admin-actions">
      <button class="ghost-btn" onclick="adminUpdateRequest('${request.id}', 'approved')">通過</button>
      <button class="ghost-btn" onclick="adminUpdateRequest('${request.id}', 'rejected')">拒絕</button>
      <button class="ghost-btn" onclick="adminUpdateRequest('${request.id}', 'pending')">待審</button>
    </div>
  `).join("") : `<div class="empty slim">目前沒有申請。</div>`;
}

function renderRequestCard(request) {
  const owner = getProfile(request.owner_id);
  return `<div class="request-card"><strong>${escapeHTML(request.name)} <span>@${escapeHTML(request.handle)}</span></strong><p>${escapeHTML(request.concept || "沒有填寫概念")}</p><small>${escapeHTML(owner.display_name || "玩家")} · ${statusLabel(request.status)}</small></div>`;
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
    showToast("申請狀態已更新");
  } catch (error) {
    showToast(error.message || "更新失敗");
  }
}

function renderSearch() {
  const keyword = normalizeText(getValue("searchInput")).toLowerCase();
  const playerCharacters = getUserCharacters().filter(character => `${character.name} ${character.handle} ${character.bio}`.toLowerCase().includes(keyword));
  const aiCharacters = getAICharacters().filter(character => `${character.name} ${character.handle} ${character.bio}`.toLowerCase().includes(keyword));
  document.getElementById("accountList").innerHTML = `
    <section class="search-section"><h2>使用者帳號 / OC</h2><div class="account-list">${playerCharacters.length ? playerCharacters.map(renderAccountCard).join("") : `<div class="empty slim">沒有找到使用者</div>`}</div></section>
    <section class="search-section"><h2>AI 角色</h2><div class="account-list">${aiCharacters.length ? aiCharacters.map(renderAccountCard).join("") : `<div class="empty slim">沒有找到 AI 角色</div>`}</div></section>
  `;
}

function renderAccountCard(character) {
  return `<button class="account-card" onclick="showProfile('${character.id}')"><img class="avatar" src="${character.avatar_url}" alt="${escapeAttribute(character.name)}"><div class="account-info"><strong>${escapeHTML(character.name)}</strong><span>${escapeHTML(character.handle)} ${character.isAI ? "AI" : "OC"}</span><p>${escapeHTML(character.bio || "尚未填寫角色設定")}</p></div></button>`;
}

function renderMessages() {
  const contacts = getChatCharacters();
  if (!contacts.some(character => character.id === currentChatUser)) currentChatUser = contacts[0]?.id || "zhihao";
  const currentCharacter = getCharacter(currentChatUser);
  const conversation = getConversation(currentChatUser);
  const modelOptions = CHAT_MODELS.map(model => `<option value="${model}" ${model === currentChatModel ? "selected" : ""}>${model}</option>`).join("");
  document.getElementById("conversationList").innerHTML = contacts.map(character => `<button class="conversation-card ${character.id === currentChatUser ? "active" : ""}" onclick="openConversation('${character.id}')"><img src="${character.avatar_url}" alt="${escapeAttribute(character.name)}"><span>${escapeHTML(character.name)}</span></button>`).join("");
  document.getElementById("chatHeader").innerHTML = `<img src="${currentCharacter.avatar_url}" alt="${escapeAttribute(currentCharacter.name)}"><div class="chat-title"><strong>${escapeHTML(currentCharacter.name)}</strong><span>${escapeHTML(currentCharacter.handle)} · 私訊</span></div><label class="model-picker"><span>模型</span><select onchange="setChatModel(this.value)">${modelOptions}</select></label>`;
  renderChatMemoryPanel(currentChatUser);
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
  if (!hasPlayerOC()) return requireOC();
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
  const extra = getOCExtra(character.id);
  const list = posts.filter(post => post.character_id === character.id || post.ai_character_id === character.id);
  document.getElementById("profileArea").innerHTML = `
    <div class="profile-cover" style="${extra.cover_url ? `background-image:url('${extra.cover_url}')` : ""}"></div>
    <div class="profile-inner">
      <img class="avatar-big" src="${character.avatar_url}" alt="${escapeAttribute(character.name)}">
      <div class="display-name">${escapeHTML(character.name)}</div>
      <div class="handle">${escapeHTML(character.handle)} ${character.isAI ? "AI 角色" : "玩家 OC"}</div>
      <p class="bio">${escapeHTML(extra.bio || character.bio || character.personality || "尚未填寫角色簡介")}</p>
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

function scanNotifications() {
  if (!session) return;
  const mine = getPlayerCharacter();
  posts.forEach(post => {
    post.comments.forEach(comment => {
      if (comment.author_id !== session.id && (post.author_id === session.id || getMentionedUserHandles(comment.text).includes(normalizeHandle(mine.handle)))) {
        addNotification("你有新的留言或提及", comment.text, false);
      }
      comment.replies.forEach(reply => {
        if (comment.author_id === session.id) addNotification("AI 回覆了你的留言", reply.text, false);
      });
    });
  });
}

function notifyMentions(text, title) {
  if (!session) return;
  const myHandle = normalizeHandle(getPlayerCharacter().handle);
  if (getMentionedUserHandles(text).includes(myHandle)) addNotification(title, text);
}

function addNotification(title, body, popup = true) {
  const id = `${title}:${body}`.slice(0, 180);
  if (notifications.some(item => item.id === id)) return;
  notifications.unshift({ id, title, body, time: new Date().toISOString(), read: false });
  notifications = notifications.slice(0, 50);
  saveJSON(STORAGE_NOTIFICATIONS, notifications);
  renderNotifyBadge();
  if (popup && typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification(title, { body, icon: "images/icon.png" });
  }
}

function renderNotifyBadge() {
  const badge = document.getElementById("notifyBadge");
  if (!badge) return;
  const count = notifications.filter(item => !item.read).length;
  badge.textContent = count ? String(count) : "";
  badge.style.display = count ? "inline-flex" : "none";
}

function renderNotifications() {
  const list = document.getElementById("notificationList");
  notifications = notifications.map(item => ({ ...item, read: true }));
  saveJSON(STORAGE_NOTIFICATIONS, notifications);
  renderNotifyBadge();
  list.innerHTML = notifications.length ? notifications.map(item => `<div class="request-card"><strong>${escapeHTML(item.title)}</strong><p>${escapeHTML(item.body)}</p><small>${formatTime(item.time)}</small></div>`).join("") : `<div class="empty slim">目前沒有通知。</div>`;
}

async function requestNotificationPermission() {
  if (typeof Notification === "undefined") return showToast("這個瀏覽器不支援通知");
  const result = await Notification.requestPermission();
  showToast(result === "granted" ? "通知已開啟" : "尚未允許通知");
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
  if (!hasPlayerOC()) return requireOC();
  setTimeout(() => document.getElementById("postInput")?.focus(), 100);
}

function requireLogin() {
  showToast("請先登入");
  showAuth();
}

function requireOC() {
  showToast("請先建立自己的 OC");
  showOCSettings();
}

function fallbackReply(characterId) {
  const character = getCharacter(characterId);
  return `**${character.name} 沉默了一下。**\n\n*他的視線停在你身上，像是在等你把話說完。*`;
}

function refreshCurrentView() {
  if (currentView === "home") renderHomeFeed();
  if (currentView === "search") renderSearch();
  if (currentView === "messages") renderMessages();
  if (currentView === "notifications") renderNotifications();
  if (currentView === "profile") {
    renderProfile();
    renderProfileFeed();
  }
  if (["member", "ocSettings", "aiRequest", "admin"].includes(currentView)) renderShell();
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
    adminUpdateRequest,
    createOC,
    deletePost,
    editPost,
    focusComment,
    focusComposer,
    goBack,
    handleCommentKey,
    handleMentionInput,
    handleMessageKey,
    handlePostKey,
    insertMention,
    loadAISettingForm,
    logout,
    openConversation,
    refreshRemoteData,
    renderSearch,
    requestNotificationPermission,
    saveAISetting,
    saveChatAISetting,
    saveProfile,
    sendMessage,
    setChatModel,
    setProfileTab,
    showAIRequestPage,
    showAdminPanel,
    showAuth,
    showHome,
    showMemberArea,
    showMessages,
    showNotifications,
    showOCSettings,
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

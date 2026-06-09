import { users, defaultPosts, buildDMNovelPrompt } from "./data.js";

const STORAGE_SESSION = "threads_oc_session";
const STORAGE_MESSAGES = "threads_oc_messages";
const STORAGE_CHAT_MODEL = "threads_oc_chat_model";
const DEFAULT_CHARACTER_ID = "kaede";
const CHAT_MODELS = ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"];

const storage = typeof localStorage !== "undefined" ? localStorage : null;

let session = loadJSON(STORAGE_SESSION, null);
let authMode = "login";
let currentView = "home";
let previousView = "home";
let currentProfileTab = "posts";
let currentProfileCharacterId = DEFAULT_CHARACTER_ID;
let currentChatUser = "zhihao";
let currentChatModel = storage?.getItem(STORAGE_CHAT_MODEL) || "gpt-4o";
let messages = loadJSON(STORAGE_MESSAGES, {});
let likedPostIds = [];
let profiles = {};
let characters = {};
let posts = [];
let remoteReady = false;
let mentionQuery = "";

const baseCharacters = Object.fromEntries(
  Object.values(users)
    .filter(user => user.id !== "me")
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

function hydrateFallbackData() {
  characters = { ...baseCharacters };
  profiles.system = {
    id: "system",
    display_name: "西島楓",
    avatar_url: "images/kaede.jpg",
    player_character_id: DEFAULT_CHARACTER_ID
  };
  posts = defaultPosts.map(post => ({
    id: String(post.id),
    author_id: "system",
    character_id: post.author || DEFAULT_CHARACTER_ID,
    text: post.text,
    image_url: post.image || "",
    created_at: new Date(Date.now() - Number(post.id || 1) * 120000).toISOString(),
    comments: (post.comments || []).map(comment => ({
      id: String(comment.id),
      author_id: "system",
      text: comment.text,
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

async function refreshRemoteData(options = {}) {
  try {
    const response = await fetch("/api/bootstrap");
    if (!response.ok) throw new Error(`API ${response.status}`);
    const data = await response.json();

    profiles = {
      ...profiles,
      ...Object.fromEntries((data.profiles || []).map(profile => [profile.id, profile]))
    };
    characters = {
      ...baseCharacters,
      ...Object.fromEntries((data.characters || []).map(character => [character.id, normalizeCharacter(character)]))
    };
    const remotePosts = (data.posts || []).map(normalizePost);
    if (remotePosts.length) posts = remotePosts;

    if (session?.id && profiles[session.id]) {
      session = { ...session, ...profiles[session.id] };
      saveJSON(STORAGE_SESSION, session);
    }

    remoteReady = true;
    renderShell();
    refreshCurrentView();
    if (!options.silent) showToast("已同步");
  } catch (error) {
    console.warn("bootstrap fallback:", error);
    remoteReady = false;
    renderShell();
    refreshCurrentView();
    if (!options.silent) showToast("尚未連上 Supabase，先顯示本機內容");
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
    bio: [character.personality, character.appearance].filter(Boolean).join(" / "),
    personality: character.personality || "",
    appearance: character.appearance || "",
    speaking_style: character.speaking_style || "",
    prompt: character.prompt || "",
    isBase: false,
    created_at: character.created_at
  };
}

function normalizePost(post) {
  return {
    id: String(post.id),
    author_id: post.author_id || "system",
    character_id: post.character_id || getPlayerCharacter().id,
    text: post.text || "",
    image_url: post.image_url || "",
    created_at: post.created_at || new Date().toISOString(),
    comments: (post.comments || []).map(comment => ({
      id: String(comment.id),
      author_id: comment.author_id || "system",
      text: comment.text || "",
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

function getPlayerCharacter() {
  if (session?.player_character_id && characters[session.player_character_id]) {
    return characters[session.player_character_id];
  }
  return baseCharacters[DEFAULT_CHARACTER_ID];
}

function getCurrentAuthorProfile() {
  const player = getPlayerCharacter();
  if (session) {
    return {
      id: session.id,
      display_name: player.name,
      avatar_url: player.avatar_url,
      player_character_id: player.id
    };
  }
  return profiles.system;
}

function getCharacter(id) {
  return characters[id] || baseCharacters[id] || baseCharacters[DEFAULT_CHARACTER_ID];
}

function getProfile(id) {
  const profile = profiles[id];
  if (!profile) return profiles.system;
  if (profile.player_character_id && characters[profile.player_character_id]) {
    const character = characters[profile.player_character_id];
    return {
      ...profile,
      display_name: character.name,
      avatar_url: character.avatar_url
    };
  }
  return profile;
}

function getAllCharacters() {
  return Object.values(characters).sort((a, b) => {
    if (a.isBase && !b.isBase) return -1;
    if (!a.isBase && b.isBase) return 1;
    return a.name.localeCompare(b.name, "zh-Hant");
  });
}

function getChatCharacters() {
  const playerId = getPlayerCharacter().id;
  return getAllCharacters().filter(character => {
    if (character.id === DEFAULT_CHARACTER_ID) return false;
    if (character.id === playerId) return false;
    return true;
  });
}

function getCharacterByHandle(handle) {
  const normalized = normalizeHandle(handle);
  return getAllCharacters().find(character => normalizeHandle(character.handle) === normalized);
}

function getMentionedCharacter(text) {
  const matches = [...String(text || "").matchAll(/@([a-zA-Z0-9_\-\u4e00-\u9fff]+)/g)];
  for (const match of matches) {
    const character = getCharacterByHandle(match[1]);
    if (character) return character;
  }
  return getPlayerCharacter();
}

function renderShell() {
  const player = getPlayerCharacter();
  const author = getCurrentAuthorProfile();
  const authBtn = document.getElementById("authBtn");
  const composerAvatar = document.getElementById("composerAvatar");
  const composerName = document.getElementById("composerName");
  const navAvatar = document.getElementById("navProfileAvatar");
  const logoutBtn = document.getElementById("logoutBtn");
  const profileNameInput = document.getElementById("profileNameInput");

  if (composerAvatar) composerAvatar.src = player.avatar_url;
  if (composerName) composerName.textContent = player.name;
  if (navAvatar) navAvatar.src = player.avatar_url;
  if (authBtn) {
    authBtn.textContent = session ? "設定" : "登入";
    authBtn.onclick = session ? showOCManager : showAuth;
  }
  if (logoutBtn) logoutBtn.style.display = session ? "inline-flex" : "none";
  if (profileNameInput) profileNameInput.value = session?.display_name || author.display_name || "";
  renderMyOCList();
}

function setActiveView(viewId) {
  document.querySelectorAll(".view").forEach(view => view.classList.remove("active"));
  document.getElementById(viewId)?.classList.add("active");
}

function setTopbar(title, showBack = false) {
  document.getElementById("topbarTitle").textContent = title;
  document.getElementById("backBtn").style.display = showBack ? "inline-flex" : "none";
}

function setNav(active) {
  document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
  document.getElementById(`nav${active}`)?.classList.add("active");
}

function showHome() {
  previousView = currentView;
  currentView = "home";
  setActiveView("homeView");
  setTopbar("Threads OC");
  setNav("Home");
  renderHomeFeed();
}

function showSearch() {
  previousView = currentView;
  currentView = "search";
  setActiveView("searchView");
  setTopbar("搜尋", true);
  setNav("Search");
  renderSearch();
}

function showMessages(characterId = currentChatUser) {
  previousView = currentView;
  currentView = "messages";
  currentChatUser = characterId;
  setActiveView("messagesView");
  setTopbar("私訊", true);
  setNav("Messages");
  renderMessages();
}

function showProfile(characterId) {
  previousView = currentView;
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
  previousView = currentView;
  currentView = "auth";
  setActiveView("authView");
  setTopbar(authMode === "login" ? "登入" : "註冊", true);
  setNav("");
  renderAuthMode();
}

function showOCManager() {
  if (!session) {
    showAuth();
    return;
  }
  previousView = currentView;
  currentView = "oc";
  setActiveView("ocView");
  setTopbar("我的 OC", true);
  setNav("Profile");
  renderShell();
}

function goBack() {
  showHome();
}

function renderAuthMode() {
  const isRegister = authMode === "register";
  document.getElementById("authTitle").textContent = isRegister ? "註冊" : "登入";
  document.getElementById("authToggle").textContent = isRegister ? "已有帳號？登入" : "還沒有帳號？註冊";
  document.querySelectorAll(".register-only").forEach(element => {
    element.style.display = isRegister ? "block" : "none";
  });
}

function toggleAuthMode() {
  authMode = authMode === "login" ? "register" : "login";
  renderAuthMode();
  setTopbar(authMode === "login" ? "登入" : "註冊", true);
}

async function submitAuth() {
  const username = normalizeText(document.getElementById("authUsername").value);
  const password = document.getElementById("authPassword").value;
  const displayName = normalizeText(document.getElementById("authDisplayName").value);
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
    showToast(authMode === "login" ? "登入成功" : "註冊成功，請建立 OC");
    session.player_character_id ? showHome() : showOCManager();
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
  container.innerHTML = list.length
    ? list.map(renderPost).join("")
    : `<div class="empty">${remoteReady ? "還沒有串文。" : "正在等待 Supabase 設定，先顯示本機範例。"}</div>`;
}

function renderPost(post) {
  const target = getCharacter(post.character_id);
  const author = getProfile(post.author_id);
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
            <span>${formatTime(post.created_at)}</span>
          </div>
          <button class="more-btn" onclick="showMessages('${target.id}')">${target.id === DEFAULT_CHARACTER_ID ? "" : "私訊"}</button>
        </header>
        <p class="thread-text">${linkMentions(post.text)}</p>
        <div class="tag-row">AI 回覆角色：<button onclick="showProfile('${target.id}')">${escapeHTML(target.handle || "@oc")} ${escapeHTML(target.name)}</button></div>
        ${post.image_url ? `<img class="post-image" src="${post.image_url}" alt="">` : ""}
        <div class="actions">
          <button class="action ${liked ? "liked" : ""}" onclick="toggleLike('${post.id}')">${liked ? "♥" : "♡"}</button>
          <button class="action" onclick="focusComment('${post.id}')">💬</button>
          <button class="action" onclick="showToast('已分享')">↗</button>
        </div>
        <div class="comments">${renderComments(post)}</div>
        <div class="reply-input">
          <input id="commentInput-${post.id}" placeholder="回覆 ${escapeAttribute(author.display_name)}..." onkeydown="handleCommentKey(event, '${post.id}')">
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
          <div class="comment-text">${escapeHTML(comment.text)}</div>
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
  const input = document.getElementById("postInput");
  const text = normalizeText(input.value);
  if (!text) return showToast("先寫一點內容");
  const target = getMentionedCharacter(text);
  const author = getCurrentAuthorProfile();

  if (!session) {
    addLocalPost(text, target.id, author.id);
    input.value = "";
    closeMentionMenu();
    showToast("未登入，這篇暫存在本機");
    return;
  }

  try {
    const response = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authorId: session.id, characterId: target.id, text })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `API ${response.status}`);
    posts.unshift(normalizePost(data.post));
    input.value = "";
    closeMentionMenu();
    renderHomeFeed();
    await refreshRemoteData({ silent: true });
  } catch (error) {
    showToast(error.message || "發布失敗");
  }
}

function addLocalPost(text, characterId, authorId) {
  posts.unshift({
    id: `local_${Date.now()}`,
    author_id: authorId,
    character_id: characterId,
    text,
    image_url: "",
    created_at: new Date().toISOString(),
    comments: []
  });
  renderHomeFeed();
}

async function submitPostComment(postId) {
  const input = document.getElementById(`commentInput-${postId}`);
  const text = normalizeText(input?.value);
  if (!text) return showToast("先輸入回覆");
  const post = posts.find(item => String(item.id) === String(postId));
  if (!post) return;
  const author = getCurrentAuthorProfile();
  const tempComment = {
    id: `temp_${Date.now()}`,
    author_id: author.id,
    text,
    created_at: new Date().toISOString(),
    replies: []
  };
  post.comments.push(tempComment);
  input.value = "";
  refreshCurrentView();

  if (!session || String(postId).startsWith("local_")) {
    tempComment.replies.push({
      id: `reply_${Date.now()}`,
      character_id: post.character_id,
      text: buildLocalCommentReply(post.character_id),
      created_at: new Date().toISOString()
    });
    refreshCurrentView();
    return;
  }

  try {
    const response = await fetch("/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId, authorId: session.id, text })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `API ${response.status}`);
    const index = post.comments.findIndex(comment => comment.id === tempComment.id);
    if (index >= 0) post.comments[index] = data.comment;
    await refreshRemoteData({ silent: true });
  } catch (error) {
    showToast(error.message || "回覆失敗");
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
  const matches = getAllCharacters()
    .filter(character => `${character.handle} ${character.name}`.toLowerCase().includes(mentionQuery))
    .slice(0, 8);
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
  const displayName = normalizeText(document.getElementById("profileNameInput")?.value || session.display_name);
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
    if (!options.silent) showToast("已儲存");
  } catch (error) {
    showToast(error.message || "儲存失敗");
  }
}

async function createOC() {
  if (!session) return showAuth();
  const name = normalizeText(document.getElementById("ocNameInput").value);
  const handle = normalizeHandle(document.getElementById("ocHandleInput").value || name);
  const personality = normalizeText(document.getElementById("ocPersonalityInput").value);
  const appearance = normalizeText(document.getElementById("ocAppearanceInput").value);
  const speakingStyle = normalizeText(document.getElementById("ocSpeakingInput").value);
  const file = document.getElementById("ocAvatarInput")?.files?.[0];
  const avatarDataUrl = file ? await fileToDataUrl(file) : "";
  if (!name || !handle) return showToast("請填角色名稱和帳號");

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
    saveJSON(STORAGE_SESSION, session);
    clearOCForm();
    renderShell();
    refreshCurrentView();
    showToast("OC 已儲存");
  } catch (error) {
    showToast(error.message || "OC 儲存失敗");
  }
}

function clearOCForm() {
  ["ocNameInput", "ocHandleInput", "ocPersonalityInput", "ocAppearanceInput", "ocSpeakingInput"].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.value = "";
  });
  const file = document.getElementById("ocAvatarInput");
  if (file) file.value = "";
}

function renderMyOCList() {
  const list = document.getElementById("myOCList");
  if (!list) return;
  if (!session) {
    list.innerHTML = `<div class="empty">請先登入或註冊。</div>`;
    return;
  }
  const owned = Object.values(characters).filter(character => character.owner_id === session.id);
  list.innerHTML = owned.length ? owned.map(character => `
    <button class="account-card" onclick="showProfile('${character.id}')">
      <img class="avatar" src="${character.avatar_url}" alt="${escapeAttribute(character.name)}">
      <div class="account-info">
        <strong>${escapeHTML(character.name)}</strong>
        <span>${escapeHTML(character.handle)}</span>
        <p>${escapeHTML(character.bio || "尚未填寫設定。")}</p>
      </div>
    </button>
  `).join("") : `<div class="empty">還沒有 OC，建立後會取代西島楓成為你的玩家身份。</div>`;
}

function renderSearch() {
  const keyword = normalizeText(document.getElementById("searchInput")?.value).toLowerCase();
  const list = getAllCharacters().filter(character => `${character.name} ${character.handle} ${character.bio}`.toLowerCase().includes(keyword));
  document.getElementById("accountList").innerHTML = list.map(character => `
    <button class="account-card" onclick="showProfile('${character.id}')">
      <img class="avatar" src="${character.avatar_url}" alt="${escapeAttribute(character.name)}">
      <div class="account-info">
        <strong>${escapeHTML(character.name)}</strong>
        <span>${escapeHTML(character.handle)}</span>
        <p>${escapeHTML(character.bio || "角色設定尚未公開。")}</p>
      </div>
    </button>
  `).join("") || `<div class="empty">找不到角色。</div>`;
}

function renderMessages() {
  const contacts = getChatCharacters();
  if (!contacts.length) {
    document.getElementById("conversationList").innerHTML = "";
    document.getElementById("chatHeader").innerHTML = "";
    document.getElementById("chatLog").innerHTML = `<div class="empty">目前沒有可聊天角色。西島楓是玩家身份，不會出現在聊天列表。</div>`;
    return;
  }
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
    <div class="chat-title"><strong>${escapeHTML(currentCharacter.name)}</strong><span>${escapeHTML(currentCharacter.handle)} · DM</span></div>
    <label class="model-picker"><span>模型</span><select onchange="setChatModel(this.value)">${modelOptions}</select></label>
  `;
  document.getElementById("chatLog").innerHTML = conversation.map(item => `
    <div class="message ${item.role === "me" ? "me" : "them"}">${formatMessageHTML(item.text)}</div>
  `).join("");
  const log = document.getElementById("chatLog");
  log.scrollTop = log.scrollHeight;
}

function getConversation(characterId) {
  if (!messages[characterId]) {
    messages[characterId] = [{ role: "them", text: `${getCharacter(characterId).name} 看了你一眼，像是在等你開口。` }];
    saveJSON(STORAGE_MESSAGES, messages);
  }
  return messages[characterId];
}

function openConversation(characterId) {
  currentChatUser = characterId;
  renderMessages();
}

function setChatModel(model) {
  currentChatModel = CHAT_MODELS.includes(model) ? model : "gpt-4o";
  storage?.setItem(STORAGE_CHAT_MODEL, currentChatModel);
}

function handleMessageKey(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

async function sendMessage() {
  const input = document.getElementById("messageInput");
  const text = normalizeText(input.value);
  if (!text) return showToast("先輸入訊息");
  const conversation = getConversation(currentChatUser);
  const character = getCharacter(currentChatUser);
  conversation.push({ role: "me", text });
  input.value = "";
  saveJSON(STORAGE_MESSAGES, messages);
  renderMessages();
  setChatStatus(`${character.name} 正在輸入...`);
  const reply = await createCharacterReply(character, text, { history: conversation.slice(-10) });
  conversation.push({ role: "them", text: reply });
  saveJSON(STORAGE_MESSAGES, messages);
  setChatStatus("");
  renderMessages();
}

async function createCharacterReply(character, text, context) {
  const prompt = character.isBase ? buildDMNovelPrompt(users[character.id]) : buildOCDMPrompt(character);
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId: character.id, characterName: character.name, model: currentChatModel, prompt, message: text, context })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `API ${response.status}`);
    return normalizeText(data.reply) || buildLocalCommentReply(character.id);
  } catch {
    return buildLocalCommentReply(character.id);
  }
}

function buildOCDMPrompt(character) {
  return `
你正在進行沉浸式小說角色扮演。
你正在扮演：${character.name}
外表：${character.appearance || "未設定"}
性格：${character.personality || "未設定"}
說話方式：${character.speaking_style || "自然、像真人"}
規則：使用繁體中文。旁白和心理描寫用斜體，角色說話用粗體。一次只回一小段，不要替使用者說話。
`;
}

function renderProfile() {
  const character = getCharacter(currentProfileCharacterId);
  const list = posts.filter(post => post.author_id === session?.id || post.character_id === character.id);
  document.getElementById("profileArea").innerHTML = `
    <div class="profile-inner">
      <img class="avatar-big" src="${character.avatar_url}" alt="${escapeAttribute(character.name)}">
      <div class="display-name">${escapeHTML(character.name)}</div>
      <div class="handle">${escapeHTML(character.handle)}</div>
      <p class="bio">${escapeHTML(character.bio || character.personality || "還沒有角色簡介。")}</p>
      <div class="stats"><span><strong>${list.length}</strong> 串文</span><span><strong>${getProfileReplyCount(character.id)}</strong> 回覆</span></div>
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
  let list = posts.filter(post => post.author_id === session?.id || post.character_id === character.id);
  if (currentProfileTab === "replies") {
    list = posts.filter(post => post.comments.some(comment => comment.replies.some(reply => reply.character_id === character.id)));
  }
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
  setTimeout(() => document.getElementById("postInput")?.focus(), 100);
}

function setChatStatus(text) {
  document.getElementById("chatStatus").textContent = text;
}

function buildLocalCommentReply(characterId) {
  return `${getCharacter(characterId).name} 只回了一句：「這句我記住了。」`;
}

function refreshCurrentView() {
  if (currentView === "home") renderHomeFeed();
  if (currentView === "search") renderSearch();
  if (currentView === "messages") renderMessages();
  if (currentView === "profile") renderProfileFeed();
  if (currentView === "oc") renderShell();
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
  return String(value || "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}

function escapeAttribute(value) {
  return escapeHTML(value).replace(/`/g, "&#096;");
}

function formatMessageHTML(value) {
  return escapeHTML(value).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>").replace(/\n/g, "<br>");
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
    createOC,
    focusComment,
    focusComposer,
    goBack,
    handleCommentKey,
    handleMessageKey,
    handlePostInput,
    handlePostKey,
    insertMention,
    logout,
    openConversation,
    refreshRemoteData,
    renderSearch,
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
    submitAuth,
    submitPostComment,
    toggleAuthMode,
    toggleLike
  });
}

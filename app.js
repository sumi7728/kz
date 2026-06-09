import { users, buildDMNovelPrompt, buildCommentPrompt } from "./data.js";

const STORAGE_SESSION = "dream_sugar_session";
const STORAGE_MESSAGES = "dream_sugar_messages";
const STORAGE_MODEL = "dream_sugar_chat_model";
const STORAGE_EXTRA = "dream_sugar_oc_extra";
const STORAGE_NOTIFICATIONS = "dream_sugar_notifications";
const STORAGE_LIKES = "dream_sugar_likes";
const DEFAULT_MODEL = "gpt-5.2";
const CHAT_MODELS = ["gpt-5.2", "gpt-5.1", "gpt-5", "gpt-4.1", "gpt-4o"];
const POST_AI_DELAY_MS = 30000;

let session = loadJSON(STORAGE_SESSION, null);
let messages = loadJSON(STORAGE_MESSAGES, {});
let ocExtra = loadJSON(STORAGE_EXTRA, {});
let notifications = loadJSON(STORAGE_NOTIFICATIONS, []);
let likedPostIds = loadJSON(STORAGE_LIKES, []);
let authMode = "login";
let currentView = "home";
let currentProfileTab = "posts";
let currentProfileCharacterId = "guest_player";
let currentChatUser = "zhihao";
let currentChatModel = localStorage.getItem(STORAGE_MODEL) || DEFAULT_MODEL;
let profiles = {};
let characters = {};
let aiSettings = {};
let aiRequests = [];
let posts = [];
let remoteReady = false;
let mentionInputId = "postInput";
let mentionQuery = "";
let cropFiles = {};

const playerDefault = {
  id: "kaede_player",
  owner_id: "system",
  name: "西島楓",
  handle: "@kaede_728",
  avatar_url: "images/kaede.jpg",
  bio: "最高權限玩家帳號。甜美、靈動，也很會頂嘴。",
  personality: users.kaede.profile.personality,
  appearance: users.kaede.profile.appearance,
  speaking_style: users.kaede.profile.speakingStyle,
  prompt: users.kaede.prompt,
  isAI: false,
  isBase: true
};

const guestDefault = {
  id: "guest_player",
  owner_id: "guest",
  name: "登入後使用",
  handle: "@guest",
  avatar_url: "images/guest-avatar.svg",
  bio: "登入後可以建立自己的 OC。",
  personality: "",
  appearance: "",
  speaking_style: "",
  prompt: "",
  isAI: false,
  isBase: true,
  isGuest: true
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
      personality: user.profile.personality,
      appearance: user.profile.appearance,
      speaking_style: user.profile.speakingStyle,
      prompt: user.prompt,
      isAI: true,
      isBase: true
    }])
);

init();

async function init() {
  hydrateFallbackData();
  setupCropInputs();
  renderShell();
  await refreshRemoteData({ silent: true });
  showHome();
}

function hydrateFallbackData() {
  characters = { ...baseCharacters, [playerDefault.id]: playerDefault, [guestDefault.id]: guestDefault };
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
    profiles = {
      ...profiles,
      ...Object.fromEntries((data.profiles || []).map(profile => [profile.id, profile]))
    };
    characters = {
      ...baseCharacters,
      [playerDefault.id]: playerDefault,
      [guestDefault.id]: guestDefault,
      ...Object.fromEntries((data.characters || []).map(item => [item.id, normalizeCharacter(item)]))
    };
    aiSettings = Object.fromEntries((data.aiSettings || []).map(item => [`${item.owner_id}:${item.character_id}`, item]));
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
    if (!options.silent) showToast("已更新資料");
  } catch (error) {
    console.warn("bootstrap failed:", error);
    remoteReady = false;
    renderShell();
    refreshCurrentView();
    if (!options.silent) showToast("資料庫暫時連不上，請稍後再試");
  }
}

function normalizeCharacter(item) {
  const handle = normalizeHandle(item.handle || item.name || "oc");
  return {
    id: item.id,
    owner_id: item.owner_id,
    name: item.name || "未命名 OC",
    handle: `@${handle}`,
    avatar_url: item.avatar_url || "images/kaede.jpg",
    bio: getOCExtra(item.id).bio || [item.personality, item.appearance].filter(Boolean).join(" / "),
    personality: item.personality || "",
    appearance: item.appearance || "",
    speaking_style: item.speaking_style || "",
    prompt: item.prompt || "",
    isAI: false,
    isBase: false,
    created_at: item.created_at
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

function renderShell() {
  const player = getPlayerCharacter();
  setText("topbarTitle", titleForView());
  setAttr("composerAvatar", "src", player.avatar_url || "images/guest-avatar.svg");
  setText("composerName", player.name || "登入後使用");
  setAttr("navProfileAvatar", "src", player.avatar_url || "images/guest-avatar.svg");
  setText("authBtn", session ? "齒輪" : "登入");
  const adminBtn = document.getElementById("adminEntryBtn");
  if (adminBtn) adminBtn.style.display = isAdmin() ? "block" : "none";
  document.querySelectorAll(".register-only").forEach(item => {
    item.style.display = authMode === "register" ? "block" : "none";
  });
  renderBadge();
}

function titleForView() {
  const titles = {
    home: "夢糖庭院",
    search: "搜尋",
    notifications: "通知",
    messages: "私訊",
    profile: "個人頁",
    auth: authMode === "login" ? "登入" : "註冊",
    member: "會員專區",
    oc: "OC 設定",
    aiRequest: "AI 申請",
    admin: "管理者模式",
    aiMemory: "AI 記憶"
  };
  return titles[currentView] || "夢糖庭院";
}

function showView(viewName, viewId) {
  currentView = viewName;
  document.querySelectorAll(".view").forEach(view => view.classList.remove("active"));
  document.getElementById(viewId)?.classList.add("active");
  document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
  const navMap = { home: "navHome", search: "navSearch", messages: "navMessages", profile: "navProfile" };
  if (navMap[viewName]) document.getElementById(navMap[viewName])?.classList.add("active");
  document.getElementById("backBtn").style.display = viewName === "home" ? "none" : "inline-flex";
  renderShell();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showHome() {
  showView("home", "homeView");
  renderHomeFeed();
}

function showSearch() {
  showView("search", "searchView");
  renderSearch();
}

function showNotifications() {
  showView("notifications", "notificationsView");
  renderNotifications();
}

function showAuth() {
  if (session) return showMemberArea();
  showView("auth", "authView");
  renderAuth();
}

function showMemberArea() {
  if (!session) return showAuth();
  showView("member", "memberView");
}

function showOCSettings() {
  if (!session) return requireLogin();
  showView("oc", "ocSettingsView");
  fillOCForm();
}

function showAIRequestPage() {
  if (!session) return requireLogin();
  showView("aiRequest", "aiRequestView");
  renderAIRequests();
}

function showAdminPanel() {
  if (!isAdmin()) return showToast("只有 @kaede_728 可以使用管理者模式");
  showView("admin", "adminView");
  renderAdminCharacters();
  renderAdminRequests();
}

function showMessages(characterId = currentChatUser) {
  if (!session) return requireLogin();
  if (!hasPlayerOC()) return requireOC();
  currentChatUser = characterId || currentChatUser;
  showView("messages", "messagesView");
  renderMessages();
}

function showPlayerProfile() {
  if (!session) return showAuth();
  showProfile(getPlayerCharacter().id);
}

function showProfile(characterId) {
  currentProfileCharacterId = characterId || getPlayerCharacter().id;
  currentProfileTab = "posts";
  showView("profile", "profileView");
  renderProfile();
  renderProfileFeed();
}

function goBack() {
  if (currentView === "messages") return showHome();
  if (currentView === "profile") return showHome();
  if (currentView === "aiMemory") return showMessages(currentChatUser);
  if (["oc", "aiRequest", "admin"].includes(currentView)) return showMemberArea();
  showHome();
}

function refreshCurrentView() {
  if (currentView === "home") renderHomeFeed();
  if (currentView === "search") renderSearch();
  if (currentView === "messages") renderMessages();
  if (currentView === "profile") {
    renderProfile();
    renderProfileFeed();
  }
  if (currentView === "notifications") renderNotifications();
  if (currentView === "aiRequest") renderAIRequests();
  if (currentView === "admin") {
    renderAdminCharacters();
    renderAdminRequests();
  }
}

function renderHomeFeed() {
  renderFeed("homeFeed", sortPosts(posts));
}

function renderFeed(targetId, list) {
  const target = document.getElementById(targetId);
  if (!target) return;
  target.innerHTML = list.length ? list.map(renderPost).join("") : `<div class="empty">目前還沒有貼文。登入並建立 OC 後，可以發第一篇。</div>`;
}

function renderPost(post) {
  const author = getProfile(post.author_id);
  const poster = getCharacter(post.character_id);
  const targetAI = post.ai_character_id ? getCharacter(post.ai_character_id) : null;
  const liked = likedPostIds.includes(post.id);
  const canModify = session && (isAdmin() || post.author_id === session.id);
  return `
    <article class="thread-post">
      <div class="thread-rail">
        <button class="avatar-button" onclick="showProfile('${escapeAttribute(poster.id)}')">
          <img class="avatar" src="${escapeAttribute(poster.avatar_url || author.avatar_url || "images/kaede.jpg")}" alt="${escapeAttribute(poster.name)}">
        </button>
        <span></span>
      </div>
      <div class="thread-body">
        <header class="thread-head">
          <div>
            <button class="name-link strong" onclick="showProfile('${escapeAttribute(poster.id)}')">${escapeHTML(poster.name || author.display_name)}</button>
            <span>${escapeHTML(poster.handle || "")}</span>
            <span>${formatTime(post.created_at)}</span>
          </div>
          ${canModify ? `<div class="post-tools"><button onclick="editPost('${post.id}')">編輯</button><button class="danger-link" onclick="deletePost('${post.id}')">刪除</button></div>` : ""}
        </header>
        <p class="thread-text" id="postText-${post.id}">${linkMentions(post.text)}</p>
        ${targetAI ? `<div class="tag-row">標記 AI：<button onclick="showProfile('${targetAI.id}')">${escapeHTML(targetAI.handle)} ${escapeHTML(targetAI.name)}</button></div>` : ""}
        ${post.image_url ? `<img class="post-image" src="${escapeAttribute(post.image_url)}" alt="">` : ""}
        <div class="actions">
          <button class="action ${liked ? "liked" : ""}" onclick="toggleLike('${post.id}')">${liked ? "已喜歡" : "喜歡"}</button>
          <button class="action" onclick="focusComment('${post.id}')">回覆</button>
        </div>
        <div class="comments">${renderComments(post)}</div>
        <div class="reply-input mention-wrap">
          <input id="commentInput-${post.id}" placeholder="${session ? "留言，輸入 @ 可選擇 AI 或玩家。" : "訪客只能觀看，登入後才能留言。"}" oninput="handleMentionInput('commentInput-${post.id}')" onkeydown="handleCommentKey(event, '${post.id}')">
          <button onclick="submitPostComment('${post.id}')">送出</button>
        </div>
      </div>
    </article>
  `;
}

function renderComments(post) {
  return (post.comments || []).map(comment => {
    if (comment.text === "__ai_post_reply__") return renderCommentReplies(comment, true);
    const authorProfile = getProfile(comment.author_id);
    const authorCharacter = authorProfile.player_character_id ? getCharacter(authorProfile.player_character_id) : authorProfile;
    return `
      <div class="comment">
        <button class="avatar-button" onclick="showProfile('${escapeAttribute(authorCharacter.id || getPlayerCharacter().id)}')">
          <img class="avatar small" src="${escapeAttribute(authorProfile.avatar_url || authorCharacter.avatar_url || "images/kaede.jpg")}" alt="${escapeAttribute(authorProfile.display_name)}">
        </button>
        <div class="comment-body">
          <div class="comment-head">
            <button class="name-link strong" onclick="showProfile('${escapeAttribute(authorCharacter.id || getPlayerCharacter().id)}')">${escapeHTML(authorProfile.display_name)}</button>
            <span>${formatTime(comment.created_at)}</span>
          </div>
          <div class="comment-text">${linkMentions(comment.text)}</div>
          ${renderCommentReplies(comment)}
        </div>
      </div>
    `;
  }).join("");
}

function renderCommentReplies(comment, topLevel = false) {
  return (comment.replies || []).map(reply => {
    const character = getCharacter(reply.character_id);
    return `
      <div class="${topLevel ? "comment ai-top-comment" : "reply"}">
        <button class="avatar-button" onclick="showProfile('${escapeAttribute(character.id)}')">
          <img class="avatar small" src="${escapeAttribute(character.avatar_url)}" alt="${escapeAttribute(character.name)}">
        </button>
        <div class="reply-bubble">
          <div class="comment-head">
            <button class="name-link strong" onclick="showProfile('${escapeAttribute(character.id)}')">${escapeHTML(character.name)}</button>
            <span>${formatTime(reply.created_at)}</span>
          </div>
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
    const newPost = normalizePost(data.post);
    posts.unshift(newPost);
    input.value = "";
    closeMentionMenu();
    notifyMentions(text, "有人在貼文中提到了你");
    renderHomeFeed();
    if (mentionedAI) schedulePostAIReply(newPost.id, mentionedAI.id);
    await refreshRemoteData({ silent: true });
  } catch (error) {
    showToast(error.message || "發文失敗");
  }
}

function schedulePostAIReply(postId, aiCharacterId) {
  showToast(`${getCharacter(aiCharacterId).name} 會在 30 秒後回覆`);
  setTimeout(() => requestPostAIReply(postId, aiCharacterId), POST_AI_DELAY_MS);
}

async function requestPostAIReply(postId, aiCharacterId) {
  if (!session) return;
  const post = posts.find(item => item.id === String(postId));
  if (!post || post.comments.some(comment => comment.text === "__ai_post_reply__" && comment.ai_character_id === aiCharacterId)) return;
  try {
    const response = await fetch("/api/post-ai-reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postId,
        ownerId: session.id,
        aiCharacterId,
        userCharacter: getPlayerCharacter(),
        postContext: buildPostContext(post)
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `API ${response.status}`);
    post.comments.push(normalizePost({ comments: [data.comment] }).comments[0]);
    addNotification(`${getCharacter(aiCharacterId).name} 回覆了你的貼文`, data.comment.replies?.[0]?.text || "");
    refreshCurrentView();
  } catch (error) {
    showToast(error.message || "AI 回覆貼文失敗");
  }
}

async function editPost(postId) {
  const post = posts.find(item => item.id === postId);
  if (!post) return;
  const nextText = prompt("編輯貼文", post.text);
  if (nextText === null) return;
  const text = normalizeText(nextText);
  if (!text) return showToast("貼文不能是空的");
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
  if (!confirm("確定要刪除這篇貼文嗎？")) return;
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
  const post = posts.find(item => item.id === String(postId));
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
      body: JSON.stringify({
        postId,
        authorId: session.id,
        text,
        aiCharacterId: mentionedAI?.id || null,
        userCharacter: getPlayerCharacter(),
        postContext: buildPostContext(post)
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `API ${response.status}`);
    const index = post.comments.findIndex(comment => comment.id === tempComment.id);
    if (index >= 0) post.comments[index] = normalizePost({ comments: [data.comment] }).comments[0];
    if (data.comment?.replies?.length) addNotification("AI 回覆了你的留言", data.comment.replies[0].text);
    if (post.author_id !== session.id) addNotification("有人回覆了你的貼文", text);
    notifyMentions(text, "有人在留言中提到了你");
    await refreshRemoteData({ silent: true });
  } catch (error) {
    showToast(error.message || "留言失敗");
  }
}

function handlePostKey(event) {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) addPost();
}

function handleCommentKey(event, postId) {
  if (event.key === "Enter") {
    event.preventDefault();
    submitPostComment(postId);
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

function renderMentionMenu() {
  const menu = document.getElementById("mentionMenu");
  const input = document.getElementById(mentionInputId);
  if (!menu || !input) return;
  const list = getMentionTargets()
    .filter(character => `${character.name} ${character.handle}`.toLowerCase().includes(mentionQuery))
    .slice(0, 8);
  if (!list.length) return closeMentionMenu();
  menu.innerHTML = list.map(character => `
    <button onclick="insertMention('${character.id}')">
      <img src="${escapeAttribute(character.avatar_url)}" alt="">
      <span><strong>${escapeHTML(character.name)}</strong><small>${escapeHTML(character.handle)} ${character.isAI ? "AI" : "玩家"}</small></span>
    </button>
  `).join("");
  menu.classList.add("open");
  if (mentionInputId !== "postInput") {
    input.parentElement?.appendChild(menu);
  } else {
    document.querySelector(".composer .mention-wrap")?.appendChild(menu);
  }
}

function insertMention(characterId) {
  const character = getCharacter(characterId);
  const input = document.getElementById(mentionInputId);
  if (!input) return;
  const startText = input.value.slice(0, input.selectionStart).replace(/@([a-zA-Z0-9_\-\u4e00-\u9fff]*)$/, `${character.handle} `);
  const endText = input.value.slice(input.selectionStart);
  input.value = startText + endText;
  input.focus();
  input.selectionStart = input.selectionEnd = startText.length;
  closeMentionMenu();
}

function closeMentionMenu() {
  const menu = document.getElementById("mentionMenu");
  if (!menu) return;
  menu.classList.remove("open");
  menu.innerHTML = "";
}

async function submitAuth() {
  const username = normalizeHandle(getValue("authUsername"));
  const password = getValue("authPassword");
  const displayName = getValue("authDisplayName") || username;
  if (!username || !password) return showToast("請輸入帳號與密碼");
  try {
    const response = await fetch(`/api/auth/${authMode === "login" ? "login" : "register"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, displayName })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `API ${response.status}`);
    session = data.profile;
    profiles[session.id] = session;
    saveJSON(STORAGE_SESSION, session);
    await refreshRemoteData({ silent: true });
    showToast(authMode === "login" ? "登入成功" : "註冊成功，請建立你的 OC");
    if (hasPlayerOC()) showHome();
    else showOCSettings();
  } catch (error) {
    showToast(error.message || "登入失敗");
  }
}

function toggleAuthMode() {
  authMode = authMode === "login" ? "register" : "login";
  renderAuth();
  renderShell();
}

function renderAuth() {
  setText("authTitle", authMode === "login" ? "登入夢糖庭院" : "註冊夢糖庭院");
  setText("authToggle", authMode === "login" ? "沒有帳號，註冊" : "已經有帳號，登入");
  renderShell();
}

function logout() {
  session = null;
  saveJSON(STORAGE_SESSION, null);
  showHome();
  renderShell();
}

async function saveProfile() {
  if (!session) return requireLogin();
  const displayName = normalizeText(getValue("profileNameInput") || session.display_name);
  const avatarDataUrl = await getCroppedDataUrl("profileAvatar", 512, 512);
  try {
    const response = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: session.id, displayName, avatarDataUrl })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `API ${response.status}`);
    session = { ...session, ...data.profile };
    profiles[session.id] = session;
    saveJSON(STORAGE_SESSION, session);
    renderShell();
    showToast("帳號資料已儲存");
  } catch (error) {
    showToast(error.message || "帳號儲存失敗");
  }
}

async function createOC() {
  if (!session) return requireLogin();
  const name = normalizeText(getValue("ocNameInput"));
  const handle = normalizeHandle(getValue("ocHandleInput"));
  if (!name || !handle) return showToast("請填角色名稱和 @帳號");
  const avatarDataUrl = await getCroppedDataUrl("ocAvatar", 512, 512);
  const coverDataUrl = await getCroppedDataUrl("ocCover", 1200, 450);
  const payload = {
    ownerId: session.id,
    characterId: session.player_character_id,
    name,
    handle,
    personality: getValue("ocPersonalityInput"),
    appearance: getValue("ocAppearanceInput"),
    speakingStyle: getValue("ocSpeakingInput"),
    prompt: "",
    avatarDataUrl
  };
  try {
    const response = await fetch("/api/characters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `API ${response.status}`);
    const character = normalizeCharacter(data.character);
    characters[character.id] = character;
    session = { ...session, player_character_id: character.id };
    profiles[session.id] = { ...profiles[session.id], player_character_id: character.id };
    saveJSON(STORAGE_SESSION, session);
    setOCExtra(character.id, { bio: getValue("ocBioInput"), cover_url: coverDataUrl || getOCExtra(character.id).cover_url });
    renderShell();
    showToast("OC 已儲存");
    showProfile(character.id);
  } catch (error) {
    showToast(error.message || "OC 儲存失敗");
  }
}

function fillOCForm() {
  if (!session) return;
  const character = getPlayerCharacter();
  const extra = getOCExtra(character.id);
  setValue("profileNameInput", session.display_name || character.name);
  setValue("ocNameInput", character.name === "西島楓" && !isAdmin() ? "" : character.name);
  setValue("ocHandleInput", character.handle?.replace(/^@/, "") || "");
  setValue("ocBioInput", extra.bio || character.bio || "");
  setValue("ocPersonalityInput", character.personality || "");
  setValue("ocAppearanceInput", character.appearance || "");
  setValue("ocSpeakingInput", character.speaking_style || "");
}

function renderSearch() {
  const keyword = normalizeText(getValue("searchInput")).toLowerCase();
  const playerCharacters = getUserCharacters().filter(item => `${item.name} ${item.handle} ${item.bio}`.toLowerCase().includes(keyword));
  const aiCharacters = getAICharacters().filter(item => `${item.name} ${item.handle} ${item.bio}`.toLowerCase().includes(keyword));
  document.getElementById("accountList").innerHTML = `
    <section class="search-section"><h2>玩家 / OC</h2><div class="account-list">${playerCharacters.length ? playerCharacters.map(renderAccountCard).join("") : `<div class="empty slim">沒有找到玩家。</div>`}</div></section>
    <section class="search-section"><h2>AI 角色</h2><div class="account-list">${aiCharacters.length ? aiCharacters.map(renderAccountCard).join("") : `<div class="empty slim">沒有找到 AI 角色。</div>`}</div></section>
  `;
}

function renderAccountCard(character) {
  return `<button class="account-card" onclick="showProfile('${character.id}')"><img class="avatar" src="${escapeAttribute(character.avatar_url)}" alt="${escapeAttribute(character.name)}"><div class="account-info"><strong>${escapeHTML(character.name)}</strong><span>${escapeHTML(character.handle)} ${character.isAI ? "AI" : "OC"}</span><p>${escapeHTML(character.bio || "尚未填寫簡介")}</p></div></button>`;
}

function renderMessages() {
  const contacts = getChatCharacters();
  if (!contacts.some(character => character.id === currentChatUser)) currentChatUser = contacts[0]?.id || "zhihao";
  const currentCharacter = getCharacter(currentChatUser);
  const conversation = getConversation(currentChatUser);
  const modelOptions = CHAT_MODELS.map(model => `<option value="${model}" ${model === currentChatModel ? "selected" : ""}>${model}</option>`).join("");
  document.getElementById("conversationList").innerHTML = contacts.map(character => `
    <button class="conversation-card ${character.id === currentChatUser ? "active" : ""}" onclick="openConversation('${character.id}')">
      <img src="${escapeAttribute(character.avatar_url)}" alt="${escapeAttribute(character.name)}">
      <span>${escapeHTML(character.name)}</span>
    </button>
  `).join("");
  document.getElementById("chatHeader").innerHTML = `
    <button class="avatar-button" onclick="showProfile('${currentCharacter.id}')"><img src="${escapeAttribute(currentCharacter.avatar_url)}" alt="${escapeAttribute(currentCharacter.name)}"></button>
    <div class="chat-title"><button class="name-link strong" onclick="showProfile('${currentCharacter.id}')">${escapeHTML(currentCharacter.name)}</button><span>${escapeHTML(currentCharacter.handle)} · 私訊</span></div>
    <button class="ghost-btn memory-link" onclick="showAIMemoryPage('${currentCharacter.id}')">對你的記憶</button>
    <label class="model-picker"><span>模型</span><select onchange="setChatModel(this.value)">${modelOptions}</select></label>
  `;
  document.getElementById("chatLog").innerHTML = conversation.map(renderMessageItem).join("");
  const log = document.getElementById("chatLog");
  log.scrollTop = log.scrollHeight;
}

function renderMessageItem(item) {
  if (item.role === "me") return `<div class="message me">${formatMessageHTML(item.text)}</div>`;
  return formatAIMessageBlock(item.text);
}

function formatAIMessageBlock(text) {
  const lines = String(text || "").split(/\n+/).map(line => line.trim()).filter(Boolean);
  const actionLines = [];
  const speechLines = [];
  for (const line of lines) {
    if (/^\*[^*].*\*$/.test(line)) actionLines.push(line.replace(/^\*|\*$/g, ""));
    else speechLines.push(line);
  }
  return `
    ${actionLines.map(line => `<div class="message-action">${escapeHTML(line)}</div>`).join("")}
    <div class="message them">${formatMessageHTML(speechLines.join("\n\n") || text)}</div>
  `;
}

function getConversation(characterId) {
  if (!messages[characterId]) {
    messages[characterId] = [{ role: "them", text: `*${getCharacter(characterId).name} 抬眼看向你，語氣放得很輕。*\n\n**你來了。**` }];
    saveJSON(STORAGE_MESSAGES, messages);
  }
  return messages[characterId];
}

function openConversation(characterId) {
  currentChatUser = characterId;
  renderMessages();
}

function setChatModel(model) {
  currentChatModel = CHAT_MODELS.includes(model) ? model : DEFAULT_MODEL;
  localStorage.setItem(STORAGE_MODEL, currentChatModel);
  renderMessages();
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
  const reply = await createCharacterReply(character, text, { history: conversation.slice(-12) });
  conversation.push({ role: "them", text: reply });
  saveJSON(STORAGE_MESSAGES, messages);
  setText("chatStatus", "");
  renderMessages();
}

async function createCharacterReply(character, text, context) {
  const prompt = users[character.id] ? buildDMNovelPrompt(users[character.id]) : buildCustomCharacterPrompt(character, "dm");
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ownerId: session.id,
        characterId: character.id,
        characterName: character.name,
        model: currentChatModel,
        prompt,
        message: text,
        context,
        userCharacter: getPlayerCharacter()
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `API ${response.status}`);
    return normalizeText(data.reply) || fallbackReply(character.id);
  } catch (error) {
    showToast(error.message || "AI 回覆失敗");
    return fallbackReply(character.id);
  }
}

function showAIMemoryPage(characterId = currentChatUser) {
  if (!session) return requireLogin();
  currentChatUser = characterId;
  const character = getCharacter(characterId);
  const setting = aiSettings[`${session.id}:${characterId}`] || {};
  showView("aiMemory", "aiMemoryView");
  setText("aiMemoryTitle", `${character.name} 對你的記憶`);
  setValue("aiMemoryPageInput", setting.memory || "");
  setValue("aiModePageInput", setting.interaction_mode || "");
  setValue("aiNicknamePageInput", setting.nickname || "");
  setValue("aiRulesPageInput", setting.rules || "");
}

async function saveAIMemoryPage() {
  if (!session) return requireLogin();
  await saveAISetting(currentChatUser, {
    memory: getValue("aiMemoryPageInput"),
    interactionMode: getValue("aiModePageInput"),
    nickname: getValue("aiNicknamePageInput"),
    rules: getValue("aiRulesPageInput")
  });
  showMessages(currentChatUser);
}

async function saveAISetting(characterId, values) {
  if (!session) return requireLogin();
  try {
    const response = await fetch("/api/ai-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerId: session.id, characterId, ...values })
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
  if (!payload.name || !payload.handle) return showToast("請填 AI 角色名稱和 @帳號");
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

function renderAdminCharacters() {
  const list = document.getElementById("adminCharacterList");
  if (!list) return;
  const playerCharacters = getUserCharacters()
    .filter(character => !character.isBase && character.owner_id !== session?.id)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "zh-Hant"));
  list.innerHTML = playerCharacters.length ? playerCharacters.map(renderAdminCharacterCard).join("") : `<div class="empty slim">目前沒有其他玩家 OC。</div>`;
}

function renderAdminCharacterCard(character) {
  const owner = getProfile(character.owner_id);
  return `
    <div class="admin-character-card">
      <button class="account-card compact" onclick="showProfile('${character.id}')">
        <img class="avatar" src="${escapeAttribute(character.avatar_url || "images/kaede.jpg")}" alt="${escapeAttribute(character.name)}">
        <div class="account-info">
          <strong>${escapeHTML(character.name)}</strong>
          <span>${escapeHTML(character.handle)} · 擁有者：${escapeHTML(owner.display_name || owner.username || "玩家")}</span>
          <p>${escapeHTML(character.bio || character.personality || "尚未填寫簡介")}</p>
        </div>
      </button>
      <button class="danger-btn" onclick="adminDeleteCharacter('${character.id}')">刪除 OC</button>
    </div>
  `;
}

function renderRequestCard(request) {
  const owner = getProfile(request.owner_id);
  return `<div class="request-card"><strong>${escapeHTML(request.name)} <span>@${escapeHTML(normalizeHandle(request.handle))}</span></strong><p>${escapeHTML(request.concept || "沒有填寫概念")}</p><small>${escapeHTML(owner.display_name || "玩家")} · ${statusLabel(request.status)}</small></div>`;
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

async function adminDeleteCharacter(characterId) {
  if (!isAdmin()) return showToast("只有 @kaede_728 可以管理");
  const character = getCharacter(characterId);
  if (!confirm(`確定要刪除 ${character.name} ${character.handle} 嗎？\n刪除後該玩家需要重新建立 OC。`)) return;
  try {
    const response = await fetch(`/api/admin/characters/${characterId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminId: session.id })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `API ${response.status}`);
    delete characters[characterId];
    Object.keys(profiles).forEach(profileId => {
      if (profiles[profileId]?.player_character_id === characterId) profiles[profileId].player_character_id = null;
    });
    delete ocExtra[characterId];
    saveJSON(STORAGE_EXTRA, ocExtra);
    renderAdminCharacters();
    refreshCurrentView();
    showToast("OC 已刪除");
  } catch (error) {
    showToast(error.message || "刪除 OC 失敗");
  }
}

function renderProfile() {
  const character = getCharacter(currentProfileCharacterId);
  const extra = getOCExtra(character.id);
  const ownedPosts = posts.filter(post => post.character_id === character.id || post.ai_character_id === character.id);
  document.getElementById("profileArea").innerHTML = `
    <div class="profile-cover" style="${extra.cover_url ? `background-image:url('${escapeAttribute(extra.cover_url)}')` : ""}"></div>
    <div class="profile-inner">
      <img class="avatar-big" src="${escapeAttribute(character.avatar_url)}" alt="${escapeAttribute(character.name)}">
      <div class="display-name">${escapeHTML(character.name)}</div>
      <div class="handle">${escapeHTML(character.handle)} ${character.isAI ? "AI 角色" : "玩家 OC"}</div>
      <p class="bio">${escapeHTML(extra.bio || character.bio || character.personality || "尚未填寫簡介")}</p>
      <div class="stats">
        <span><strong>${ownedPosts.length}</strong> 貼文</span>
        <span><strong>${likedPostIds.length}</strong> 按讚</span>
        <span><strong>${getProfileReplyCount(character.id)}</strong> 回覆</span>
      </div>
      ${session && getPlayerCharacter().id === character.id ? `<button class="ghost-btn" onclick="showOCSettings()">編輯個人頁</button>` : ""}
    </div>
  `;
  document.querySelectorAll("#profileView .tab").forEach(item => item.classList.remove("active"));
  document.querySelector(`#profileView .tab[onclick*="${currentProfileTab}"]`)?.classList.add("active");
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
  if (currentProfileTab === "liked") list = posts.filter(post => likedPostIds.includes(post.id));
  if (currentProfileTab === "reposts") list = [];
  if (currentProfileTab === "replies") list = posts.filter(post => post.comments.some(comment => comment.replies.some(reply => reply.character_id === character.id) || comment.author_id === character.owner_id));
  renderFeed("profileFeed", sortPosts(list));
}

function toggleLike(postId) {
  likedPostIds = likedPostIds.includes(postId) ? likedPostIds.filter(id => id !== postId) : [...likedPostIds, postId];
  saveJSON(STORAGE_LIKES, likedPostIds);
  refreshCurrentView();
}

function focusComment(postId) {
  document.getElementById(`commentInput-${postId}`)?.focus();
}

function focusComposer() {
  if (!session) return requireLogin();
  if (!hasPlayerOC()) return requireOC();
  showHome();
  document.getElementById("postInput")?.focus();
}

function renderNotifications() {
  const list = document.getElementById("notificationList");
  list.innerHTML = notifications.length ? notifications.map(item => `
    <div class="notification-card ${item.read ? "" : "unread"}">
      <strong>${escapeHTML(item.title)}</strong>
      <p>${escapeHTML(item.body || "")}</p>
      <span>${formatTime(item.created_at)}</span>
    </div>
  `).join("") : `<div class="empty slim">目前沒有通知。</div>`;
  notifications = notifications.map(item => ({ ...item, read: true }));
  saveJSON(STORAGE_NOTIFICATIONS, notifications);
  renderBadge();
}

function addNotification(title, body = "", push = true) {
  notifications.unshift({ id: `n_${Date.now()}`, title, body, created_at: new Date().toISOString(), read: false });
  notifications = notifications.slice(0, 80);
  saveJSON(STORAGE_NOTIFICATIONS, notifications);
  renderBadge();
  if (push && "Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon: "images/icon.png" });
  }
}

function renderBadge() {
  const badge = document.getElementById("notifyBadge");
  if (!badge) return;
  const count = notifications.filter(item => !item.read).length;
  badge.style.display = count ? "inline-flex" : "none";
  badge.textContent = String(Math.min(count, 9));
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) return showToast("這個瀏覽器不支援推播");
  const result = await Notification.requestPermission();
  showToast(result === "granted" ? "已開啟推播" : "尚未允許推播");
}

function scanNotifications() {
  if (!session) return;
  const mine = getPlayerCharacter();
  for (const post of posts) {
    if (post.author_id !== session.id && getMentionedUserHandles(post.text).includes(normalizeHandle(mine.handle))) {
      addNotification("有人在貼文中提到了你", post.text, false);
    }
  }
}

function notifyMentions(text, title) {
  if (!session) return;
  const mine = getPlayerCharacter();
  if (getMentionedUserHandles(text).includes(normalizeHandle(mine.handle))) addNotification(title, text);
}

function setupCropInputs() {
  for (const key of ["profileAvatar", "ocAvatar", "ocCover"]) {
    const input = document.getElementById(`${key}Input`);
    if (!input) continue;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      cropFiles[key] = file;
      const url = URL.createObjectURL(file);
      const preview = document.getElementById(`${key}Preview`);
      const panel = document.getElementById(`${key}CropPanel`);
      if (preview) preview.src = url;
      if (panel) panel.hidden = false;
      updateCropPreview(key);
    });
    for (const part of ["X", "Y", "Zoom"]) {
      document.getElementById(`${key}Crop${part}`)?.addEventListener("input", () => updateCropPreview(key));
    }
  }
}

function updateCropPreview(key) {
  const preview = document.getElementById(`${key}Preview`);
  if (!preview) return;
  const x = getNumber(`${key}CropX`, 50);
  const y = getNumber(`${key}CropY`, 50);
  const zoom = getNumber(`${key}CropZoom`, 100);
  preview.style.objectPosition = `${x}% ${y}%`;
  preview.style.transform = `scale(${zoom / 100})`;
}

async function getCroppedDataUrl(key, width, height) {
  const file = cropFiles[key];
  if (!file) return "";
  const image = await loadImage(URL.createObjectURL(file));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const zoom = getNumber(`${key}CropZoom`, 100) / 100;
  const xPercent = getNumber(`${key}CropX`, 50) / 100;
  const yPercent = getNumber(`${key}CropY`, 50) / 100;
  const scale = Math.max(width / image.width, height / image.height) * zoom;
  const drawW = image.width * scale;
  const drawH = image.height * scale;
  const dx = (width - drawW) * xPercent;
  const dy = (height - drawH) * yPercent;
  context.drawImage(image, dx, dy, drawW, drawH);
  return canvas.toDataURL("image/jpeg", 0.9);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function getPlayerCharacter() {
  if (!session) return guestDefault;
  if (session?.player_character_id && characters[session.player_character_id]) return characters[session.player_character_id];
  if (isAdmin()) return playerDefault;
  return guestDefault;
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
  return characters[id] || baseCharacters[id] || {
    id: id || "deleted_character",
    owner_id: "deleted",
    name: "已刪除的 OC",
    handle: "@deleted",
    avatar_url: "images/kaede.jpg",
    bio: "這個 OC 已被管理者刪除。",
    personality: "",
    appearance: "",
    speaking_style: "",
    prompt: "",
    isAI: false,
    isDeleted: true
  };
}

function getAICharacters() {
  return Object.values(characters).filter(character => character.isAI);
}

function getUserCharacters() {
  return Object.values(characters).filter(character => !character.isAI && !character.isGuest);
}

function getMentionTargets() {
  return [...getUserCharacters(), ...getAICharacters()];
}

function getChatCharacters() {
  return getAICharacters();
}

function getMentionedAICharacter(text) {
  const handles = getMentionedUserHandles(text);
  return getAICharacters().find(character => handles.includes(normalizeHandle(character.handle)));
}

function getMentionedUserHandles(text) {
  return [...String(text || "").matchAll(/@([a-zA-Z0-9_\-\u4e00-\u9fff]+)/g)].map(match => normalizeHandle(match[1]));
}

function getOCExtra(characterId) {
  return ocExtra[characterId] || {};
}

function setOCExtra(characterId, patch) {
  ocExtra[characterId] = { ...getOCExtra(characterId), ...patch };
  saveJSON(STORAGE_EXTRA, ocExtra);
}

function isAdmin() {
  return session?.role === "admin" && session?.username === "kaede_728";
}

function sortPosts(list) {
  return [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function getProfileReplyCount(characterId) {
  return posts.reduce((count, post) => count + post.comments.reduce((sum, comment) => sum + comment.replies.filter(reply => reply.character_id === characterId).length, 0), 0);
}

function buildPostContext(post) {
  return [
    `貼文：${post.text}`,
    ...post.comments.slice(-8).map(comment => {
      const author = getProfile(comment.author_id);
      const replies = comment.replies.map(reply => `${getCharacter(reply.character_id).name}：${reply.text}`).join("\n");
      return `${author.display_name}：${comment.text}${replies ? `\n${replies}` : ""}`;
    })
  ].join("\n");
}

function buildCustomCharacterPrompt(character, mode) {
  if (mode === "comment") {
    return `你正在扮演 ${character.name}，帳號 ${character.handle}。個性：${character.personality}。外表：${character.appearance}。說話風格：${character.speaking_style}。規則：用繁體中文，只回一句社群留言，不要像 AI。`;
  }
  return `你正在扮演 ${character.name}，帳號 ${character.handle}。個性：${character.personality}。外表：${character.appearance}。說話風格：${character.speaking_style}。請用沉浸式小說格式，動作用斜體，台詞用粗體且獨立一段，約 100 字，不要替使用者說話。`;
}

function fallbackReply(characterId) {
  const fallback = {
    zhihao: "*嚴志豪的目光停在你身上，語氣低而冷。*\n\n**說清楚。**",
    xiayan: "*夏妍挑眉，像是已經看穿了什麼。*\n\n**你這句很有故事喔。**",
    shuxian: "*尹書賢垂下眼，聲音很輕。*\n\n**我不是不在意，只是不知道怎麼說。**",
    youchen: "*韓祐成沉默幾秒，終於抬眼。*\n\n**我聽見了。**",
    minjun: "*姜珉俊微微一笑，語氣仍然溫和。*\n\n**如果你願意，我可以陪你慢慢說。**",
    staff: "*匿名帳號像是偷偷上線，字句都壓得很小心。*\n\n**我什麼都沒說，但這很值得記錄。**"
  };
  return fallback[characterId] || "*對方看著你。*\n\n**我在。**";
}

function statusLabel(status) {
  return { pending: "待審", approved: "已通過", rejected: "已拒絕" }[status] || status;
}

function requireLogin() {
  showToast("請先登入");
  showAuth();
}

function requireOC() {
  showToast("請先建立你的 OC");
  showOCSettings();
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function formatMessageHTML(value) {
  return escapeHTML(value)
    .replace(/\*\*(.+?)\*\*/gs, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/gs, "<em>$1</em>")
    .replace(/\n/g, "<br>");
}

function linkMentions(value) {
  return escapeHTML(value).replace(/@([a-zA-Z0-9_\-\u4e00-\u9fff]+)/g, "<span class=\"mention\">@$1</span>");
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "剛剛";
  const seconds = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "剛剛";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分鐘`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小時`;
  return `${Math.floor(seconds / 86400)} 天`;
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+\n/g, "\n").slice(0, 5000);
}

function normalizeHandle(value) {
  return String(value || "").replace(/^@/, "").trim().replace(/\s+/g, "_").replace(/[^\w\-\u4e00-\u9fff]/g, "").toLowerCase().slice(0, 40);
}

function getValue(id) {
  return document.getElementById(id)?.value || "";
}

function setValue(id, value) {
  const element = document.getElementById(id);
  if (element) element.value = value || "";
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value || "";
}

function setAttr(id, attr, value) {
  const element = document.getElementById(id);
  if (element) element.setAttribute(attr, value || "");
}

function getNumber(id, fallback) {
  const value = Number(document.getElementById(id)?.value);
  return Number.isFinite(value) ? value : fallback;
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, JSON.stringify(value));
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function escapeAttribute(value) {
  return escapeHTML(value).replace(/`/g, "&#96;");
}

Object.assign(window, {
  refreshRemoteData,
  showHome,
  showSearch,
  showNotifications,
  showAuth,
  showMemberArea,
  showOCSettings,
  showAIRequestPage,
  showAdminPanel,
  showMessages,
  showAIMemoryPage,
  saveAIMemoryPage,
  showPlayerProfile,
  showProfile,
  goBack,
  addPost,
  editPost,
  deletePost,
  submitPostComment,
  handlePostKey,
  handleCommentKey,
  handleMentionInput,
  insertMention,
  submitAuth,
  toggleAuthMode,
  logout,
  saveProfile,
  createOC,
  renderSearch,
  openConversation,
  setChatModel,
  handleMessageKey,
  sendMessage,
  submitAIRequest,
  adminUpdateRequest,
  adminDeleteCharacter,
  setProfileTab,
  toggleLike,
  focusComment,
  focusComposer,
  requestNotificationPermission
});

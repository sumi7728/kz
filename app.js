import { users, defaultPosts, buildDMNovelPrompt } from "./data.js";

const STORAGE_USER_ID = "jz_user_id";
const STORAGE_PROFILE = "jz_profile";
const STORAGE_MESSAGES = "jz_messages_v1";
const STORAGE_CHAT_MODEL = "jz_chat_model_v1";
const browserStorage = typeof localStorage !== "undefined" ? localStorage : null;
const CHAT_MODELS = ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"];
const DEFAULT_CHARACTER_ID = "kaede";

let currentView = "home";
let previousView = "home";
let currentProfileUser = DEFAULT_CHARACTER_ID;
let currentProfileTab = "posts";
let currentChatUser = "zhihao";
let currentChatModel = browserStorage?.getItem(STORAGE_CHAT_MODEL) || "gpt-4o";
let messages = loadJSON(STORAGE_MESSAGES, {});
let likedPostIds = [];
let profiles = {};
let characters = {};
let posts = [];
let remoteReady = false;
let mentionQuery = "";
let currentProfile = loadJSON(STORAGE_PROFILE, null) || {
  id: getOrCreateUserId(),
  display_name: "匿名玩家",
  avatar_url: "images/kaede.jpg"
};

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

initializeApp();

async function initializeApp() {
  hydrateFallbackData();
  renderUserShell();
  await saveProfile({ silent: true });
  await refreshRemoteData({ silent: true });
  showHome();
}

function getOrCreateUserId() {
  const saved = browserStorage?.getItem(STORAGE_USER_ID);
  if (saved) return saved;
  const id = `anon_${crypto.randomUUID()}`;
  browserStorage?.setItem(STORAGE_USER_ID, id);
  return id;
}

function loadJSON(key, fallback) {
  try {
    const saved = browserStorage?.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  browserStorage?.setItem(key, JSON.stringify(value));
}

function hydrateFallbackData() {
  profiles[currentProfile.id] = currentProfile;
  characters = { ...baseCharacters };
  posts = defaultPosts.map(post => ({
    id: String(post.id),
    author_id: currentProfile.id,
    character_id: post.author || DEFAULT_CHARACTER_ID,
    text: post.text,
    image_url: post.image || "",
    created_at: new Date(Date.now() - Number(post.id || 1) * 120000).toISOString(),
    comments: (post.comments || []).map(comment => ({
      id: String(comment.id),
      author_id: currentProfile.id,
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

    profiles = Object.fromEntries((data.profiles || []).map(profile => [profile.id, profile]));
    profiles[currentProfile.id] = profiles[currentProfile.id] || currentProfile;

    characters = {
      ...baseCharacters,
      ...Object.fromEntries((data.characters || []).map(character => [character.id, normalizeCharacter(character)]))
    };

    const remotePosts = (data.posts || []).map(normalizePost);
    posts = remotePosts.length ? remotePosts : posts;
    remoteReady = true;
    renderUserShell();
    refreshCurrentView();
    if (!options.silent) showToast("已同步最新動態");
  } catch (error) {
    console.warn("remote bootstrap fallback:", error);
    remoteReady = false;
    renderUserShell();
    refreshCurrentView();
    if (!options.silent) showToast("目前使用本機資料，請確認 Supabase 設定");
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
    author_id: post.author_id,
    character_id: post.character_id || DEFAULT_CHARACTER_ID,
    text: post.text || "",
    image_url: post.image_url || "",
    created_at: post.created_at || new Date().toISOString(),
    comments: (post.comments || []).map(comment => ({
      id: String(comment.id),
      author_id: comment.author_id,
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

function renderUserShell() {
  const avatar = document.getElementById("composerAvatar");
  const name = document.getElementById("composerName");
  const profileNameInput = document.getElementById("profileNameInput");

  if (avatar) avatar.src = currentProfile.avatar_url || "images/kaede.jpg";
  if (name) name.textContent = currentProfile.display_name || "匿名玩家";
  if (profileNameInput) profileNameInput.value = currentProfile.display_name || "";
  renderMyOCList();
}

function getCharacter(id) {
  return characters[id] || baseCharacters[id] || baseCharacters[DEFAULT_CHARACTER_ID];
}

function getProfile(id) {
  return profiles[id] || {
    id,
    display_name: "匿名玩家",
    avatar_url: "images/kaede.jpg"
  };
}

function getAllCharacters() {
  return Object.values(characters).sort((a, b) => {
    if (a.isBase && !b.isBase) return -1;
    if (!a.isBase && b.isBase) return 1;
    return a.name.localeCompare(b.name, "zh-Hant");
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
  return getCharacter(DEFAULT_CHARACTER_ID);
}

function setActiveView(viewId) {
  document.querySelectorAll(".view").forEach(view => view.classList.remove("active"));
  document.getElementById(viewId)?.classList.add("active");
}

function setTopbar(title, showBack = false) {
  document.getElementById("topbarTitle").textContent = title;
  document.getElementById("backBtn").style.display = showBack ? "flex" : "none";
}

function setNav(active) {
  document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
  document.getElementById(`nav${active}`)?.classList.add("active");
}

function showHome() {
  previousView = currentView;
  currentView = "home";
  setActiveView("homeView");
  setTopbar("動態");
  setNav("Home");
  renderHomeFeed();
  scrollToTop();
}

function showProfile(characterId) {
  previousView = currentView;
  currentView = "profile";
  currentProfileUser = characterId;
  currentProfileTab = "posts";
  setActiveView("profileView");
  setTopbar(getCharacter(characterId).name, true);
  setNav("Search");
  renderProfile();
  renderProfileFeed();
  scrollToTop();
}

function showSearch() {
  previousView = currentView;
  currentView = "search";
  setActiveView("searchView");
  setTopbar("搜尋", true);
  setNav("Search");
  renderSearch();
  scrollToTop();
}

function showMessages(characterId = currentChatUser) {
  previousView = currentView;
  currentView = "messages";
  currentChatUser = characterId;
  setActiveView("messagesView");
  setTopbar("私訊", true);
  setNav("Messages");
  renderMessages();
  scrollToTop();
}

function showOCManager() {
  previousView = currentView;
  currentView = "oc";
  setActiveView("ocView");
  setTopbar("我的 OC", true);
  setNav("OC");
  renderUserShell();
  scrollToTop();
}

function goBack() {
  showHome();
}

function scrollToTop() {
  globalThis.scrollTo?.({ top: 0, behavior: "smooth" });
}

function sortPosts(list) {
  return [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function renderHomeFeed() {
  renderFeed("homeFeed", sortPosts(posts));
}

function renderProfile() {
  const character = getCharacter(currentProfileUser);
  const userPosts = posts.filter(post => post.character_id === character.id);
  document.getElementById("profileArea").innerHTML = `
    <div class="profile-inner">
      <div class="identity-row">
        <div>
          <img class="avatar-big" src="${character.avatar_url}" alt="${escapeAttribute(character.name)}">
          <div class="display-name">${escapeHTML(character.name)}</div>
          <div class="handle">${escapeHTML(character.handle || "@oc")}</div>
        </div>
        <div class="profile-actions">
          <button class="profile-action" onclick="showMessages('${character.id}')">私訊</button>
        </div>
      </div>
      <p class="bio">${escapeHTML(character.bio || character.personality || "還沒有角色簡介。")}</p>
      <div class="stats">
        <span><strong>${userPosts.length}</strong> 貼文</span>
        <span><strong>${getProfileReplyCount(character.id)}</strong> 回覆</span>
      </div>
    </div>
  `;
}

function getProfileReplyCount(characterId) {
  return posts.reduce((count, post) => {
    return count + post.comments.reduce((sum, comment) => {
      return sum + comment.replies.filter(reply => reply.character_id === characterId).length;
    }, 0);
  }, 0);
}

function setProfileTab(tab, element) {
  currentProfileTab = tab;
  document.querySelectorAll("#profileView .tab").forEach(item => item.classList.remove("active"));
  element?.classList.add("active");
  renderProfileFeed();
}

function renderProfileFeed() {
  let list = posts.filter(post => post.character_id === currentProfileUser);
  if (currentProfileTab === "replies") {
    list = posts.filter(post => post.comments.some(comment => {
      return comment.replies.some(reply => reply.character_id === currentProfileUser);
    }));
  }
  renderFeed("profileFeed", sortPosts(list));
}

function renderFeed(containerId, list) {
  const container = document.getElementById(containerId);
  container.innerHTML = list.length
    ? list.map(renderPost).join("")
    : `<div class="empty">${remoteReady ? "還沒有貼文。" : "正在等待 Supabase 設定，先顯示本機範例資料。"}</div>`;
}

function renderPost(post) {
  const character = getCharacter(post.character_id);
  const author = getProfile(post.author_id);
  const liked = likedPostIds.includes(post.id);
  return `
    <article class="post">
      <header class="post-head">
        <img class="avatar" src="${character.avatar_url}" alt="${escapeAttribute(character.name)}" onclick="showProfile('${character.id}')">
        <div class="post-meta">
          <div class="author" onclick="showProfile('${character.id}')">
            <strong>${escapeHTML(character.name)}</strong>
            <span>${escapeHTML(character.handle || "@oc")} · ${formatTime(post.created_at)}</span>
          </div>
          <div class="tagged-by">由 ${escapeHTML(author.display_name)} 發布</div>
        </div>
        <button class="more" onclick="showMessages('${character.id}')">私訊</button>
      </header>
      <p class="post-text">${linkMentions(post.text)}</p>
      ${post.image_url ? `<img class="post-image" src="${post.image_url}" alt="">` : ""}
      <div class="actions">
        <button class="action ${liked ? "liked" : ""}" onclick="toggleLike('${post.id}')">${liked ? "♥" : "♡"}</button>
        <button class="action" onclick="focusComment('${post.id}')">💬</button>
        <button class="action" onclick="showToast('已分享')">↗</button>
      </div>
      <div class="count">${post.comments.length} 則留言</div>
      <div class="comments">${renderComments(post)}</div>
      <div class="reply-input">
        <input id="commentInput-${post.id}" placeholder="留言給 ${escapeAttribute(character.name)}..." onkeydown="handleCommentKey(event, '${post.id}')">
        <button onclick="submitPostComment('${post.id}')">送出</button>
      </div>
    </article>
  `;
}

function renderComments(post) {
  if (!post.comments.length) return "";
  return post.comments.map(comment => {
    const author = getProfile(comment.author_id);
    return `
      <div class="comment">
        <img class="avatar" src="${author.avatar_url || "images/kaede.jpg"}" alt="${escapeAttribute(author.display_name)}">
        <div class="comment-body">
          <div class="comment-bubble">
            <div class="comment-head"><strong>${escapeHTML(author.display_name)}</strong><span>${formatTime(comment.created_at)}</span></div>
            <div class="comment-text">${escapeHTML(comment.text)}</div>
          </div>
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
        <img class="avatar" src="${character.avatar_url}" alt="${escapeAttribute(character.name)}">
        <div class="reply-bubble">
          <div class="reply-head"><strong>${escapeHTML(character.name)}</strong><span>${formatTime(reply.created_at)}</span></div>
          <div class="reply-text">${escapeHTML(reply.text)}</div>
        </div>
      </div>
    `;
  }).join("");
}

function toggleLike(postId) {
  likedPostIds = likedPostIds.includes(postId)
    ? likedPostIds.filter(id => id !== postId)
    : [...likedPostIds, postId];
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

async function submitPostComment(postId) {
  const input = document.getElementById(`commentInput-${postId}`);
  const commentText = normalizeText(input?.value);
  if (!commentText) return showToast("先輸入留言");

  const post = posts.find(item => String(item.id) === String(postId));
  if (!post) return;

  const tempComment = {
    id: `temp_${Date.now()}`,
    author_id: currentProfile.id,
    text: commentText,
    created_at: new Date().toISOString(),
    replies: []
  };

  post.comments.push(tempComment);
  input.value = "";
  refreshCurrentView();

  try {
    const response = await fetch("/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postId,
        authorId: currentProfile.id,
        text: commentText
      })
    });
    if (!response.ok) throw new Error(`API ${response.status}`);
    const data = await response.json();
    const index = post.comments.findIndex(comment => comment.id === tempComment.id);
    if (index >= 0) post.comments[index] = data.comment;
    showToast(`${getCharacter(post.character_id).name} 回覆了你`);
    await refreshRemoteData({ silent: true });
  } catch (error) {
    console.warn("comment fallback:", error);
    tempComment.replies.push({
      id: `local_reply_${Date.now()}`,
      character_id: post.character_id,
      text: buildLocalCommentReply(post.character_id),
      created_at: new Date().toISOString()
    });
    refreshCurrentView();
    showToast("後端尚未連線，先用本機回覆");
  }
}

async function addPost() {
  const input = document.getElementById("postInput");
  const text = normalizeText(input.value);
  if (!text) return showToast("先寫一點內容");

  const character = getMentionedCharacter(text);

  try {
    const response = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authorId: currentProfile.id,
        characterId: character.id,
        text
      })
    });
    if (!response.ok) throw new Error(`API ${response.status}`);
    const data = await response.json();
    posts.unshift(normalizePost(data.post));
    input.value = "";
    closeMentionMenu();
    renderHomeFeed();
    showToast(`已用 ${character.handle} 發布`);
    await refreshRemoteData({ silent: true });
  } catch (error) {
    console.warn("post fallback:", error);
    posts.unshift({
      id: `local_${Date.now()}`,
      author_id: currentProfile.id,
      character_id: character.id,
      text,
      image_url: "",
      created_at: new Date().toISOString(),
      comments: []
    });
    input.value = "";
    closeMentionMenu();
    renderHomeFeed();
    showToast("Supabase 尚未連線，暫存在本機畫面");
  }
}

function handlePostInput() {
  const input = document.getElementById("postInput");
  const text = input.value.slice(0, input.selectionStart);
  const match = text.match(/@([a-zA-Z0-9_\-\u4e00-\u9fff]*)$/);
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
    .filter(character => {
      const content = `${character.handle} ${character.name}`.toLowerCase();
      return content.includes(mentionQuery);
    })
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
  menu.classList.remove("show");
  menu.innerHTML = "";
}

function focusComposer() {
  showHome();
  setTimeout(() => document.getElementById("postInput")?.focus(), 120);
}

async function saveProfile(options = {}) {
  const nameInput = document.getElementById("profileNameInput");
  const fileInput = document.getElementById("profileAvatarInput");
  const displayName = normalizeText(nameInput?.value || currentProfile.display_name) || "匿名玩家";
  const avatarDataUrl = fileInput?.files?.[0] ? await fileToDataUrl(fileInput.files[0]) : "";
  currentProfile = { ...currentProfile, display_name: displayName };

  try {
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: currentProfile.id, displayName, avatarDataUrl })
    });
    if (!response.ok) throw new Error(`API ${response.status}`);
    const data = await response.json();
    currentProfile = {
      ...currentProfile,
      ...data.profile,
      avatar_url: data.profile.avatar_url || currentProfile.avatar_url
    };
    profiles[currentProfile.id] = currentProfile;
    saveJSON(STORAGE_PROFILE, currentProfile);
    renderUserShell();
    if (!options.silent) showToast("身分已儲存");
  } catch (error) {
    console.warn("profile fallback:", error);
    profiles[currentProfile.id] = currentProfile;
    saveJSON(STORAGE_PROFILE, currentProfile);
    renderUserShell();
    if (!options.silent) showToast("本機已儲存，Supabase 尚未連線");
  }
}

async function createOC() {
  const name = normalizeText(document.getElementById("ocNameInput")?.value);
  const handle = normalizeHandle(document.getElementById("ocHandleInput")?.value || name);
  const personality = normalizeText(document.getElementById("ocPersonalityInput")?.value);
  const appearance = normalizeText(document.getElementById("ocAppearanceInput")?.value);
  const speakingStyle = normalizeText(document.getElementById("ocSpeakingInput")?.value);
  const file = document.getElementById("ocAvatarInput")?.files?.[0];
  if (!name) return showToast("請輸入 OC 名稱");
  if (!handle) return showToast("請輸入可用帳號");

  const avatarDataUrl = file ? await fileToDataUrl(file) : "";

  try {
    const response = await fetch("/api/characters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ownerId: currentProfile.id,
        name,
        handle,
        personality,
        appearance,
        speakingStyle,
        avatarDataUrl
      })
    });
    if (!response.ok) throw new Error(`API ${response.status}`);
    const data = await response.json();
    characters[data.character.id] = normalizeCharacter(data.character);
    clearOCForm();
    renderUserShell();
    showToast(`OC 已建立：@${handle}`);
  } catch (error) {
    console.warn("oc fallback:", error);
    const id = `local_oc_${Date.now()}`;
    characters[id] = {
      id,
      owner_id: currentProfile.id,
      name,
      handle: `@${handle}`,
      avatar_url: avatarDataUrl || "images/kaede.jpg",
      bio: [personality, appearance].filter(Boolean).join(" / "),
      personality,
      appearance,
      speaking_style: speakingStyle,
      prompt: "",
      isBase: false
    };
    clearOCForm();
    renderUserShell();
    showToast("Supabase 尚未連線，OC 暫存在本機畫面");
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
  const owned = Object.values(characters).filter(character => character.owner_id === currentProfile.id);
  list.innerHTML = owned.length ? owned.map(character => `
    <button class="account-card" onclick="showProfile('${character.id}')">
      <img class="avatar" src="${character.avatar_url}" alt="${escapeAttribute(character.name)}">
      <div class="account-info">
        <strong>${escapeHTML(character.name)}</strong>
        <span>${escapeHTML(character.handle || "@oc")}</span>
        <p>${escapeHTML(character.bio || "尚未填寫設定。")}</p>
      </div>
    </button>
  `).join("") : `<div class="empty">還沒有 OC，先建立一個吧。</div>`;
}

function renderSearch() {
  const keyword = normalizeText(document.getElementById("searchInput")?.value).toLowerCase();
  const list = getAllCharacters().filter(character => {
    const content = `${character.name} ${character.handle} ${character.bio}`.toLowerCase();
    return content.includes(keyword);
  });
  const accountList = document.getElementById("accountList");
  accountList.innerHTML = list.map(character => `
    <button class="account-card" onclick="showProfile('${character.id}')">
      <img class="avatar" src="${character.avatar_url}" alt="${escapeAttribute(character.name)}">
      <div class="account-info">
        <strong>${escapeHTML(character.name)}</strong>
        <span>${escapeHTML(character.handle || "@oc")}</span>
        <p>${escapeHTML(character.bio || "角色設定尚未公開。")}</p>
      </div>
    </button>
  `).join("") || `<div class="empty">找不到角色。</div>`;
}

function renderMessages() {
  const contacts = getAllCharacters();
  if (!characters[currentChatUser]) currentChatUser = contacts[0]?.id || DEFAULT_CHARACTER_ID;
  const currentCharacter = getCharacter(currentChatUser);
  const conversation = getConversation(currentChatUser);
  const modelOptions = CHAT_MODELS.map(model => `
    <option value="${model}" ${model === currentChatModel ? "selected" : ""}>${model}</option>
  `).join("");

  document.getElementById("conversationList").innerHTML = contacts.map(character => `
    <button class="conversation-card ${character.id === currentChatUser ? "active" : ""}" onclick="openConversation('${character.id}')">
      <img src="${character.avatar_url}" alt="${escapeAttribute(character.name)}">
      <span>${escapeHTML(character.name)}</span>
    </button>
  `).join("");

  document.getElementById("chatHeader").innerHTML = `
    <img src="${currentCharacter.avatar_url}" alt="${escapeAttribute(currentCharacter.name)}">
    <div class="chat-title">
      <strong>${escapeHTML(currentCharacter.name)}</strong>
      <span>${escapeHTML(currentCharacter.handle || "@oc")} · Render API</span>
    </div>
    <label class="model-picker">
      <span>模型</span>
      <select id="modelSelect" onchange="setChatModel(this.value)">${modelOptions}</select>
    </label>
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
  browserStorage?.setItem(STORAGE_CHAT_MODEL, currentChatModel);
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
      body: JSON.stringify({
        characterId: character.id,
        characterName: character.name,
        model: currentChatModel,
        prompt,
        message: text,
        context
      })
    });
    if (!response.ok) throw new Error(`API ${response.status}`);
    const data = await response.json();
    return normalizeText(data.reply) || buildLocalCommentReply(character.id);
  } catch (error) {
    console.warn("chat fallback:", error);
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

規則：
- 使用繁體中文。
- 旁白、動作、心理描寫用斜體。
- 角色說話用粗體。
- 一次只回一小段。
- 不要替使用者說話。
- 不要解釋自己是 AI。
  `;
}

function setChatStatus(text) {
  document.getElementById("chatStatus").textContent = text;
}

function buildLocalCommentReply(characterId) {
  const character = getCharacter(characterId);
  return `${character.name} 只回了一句：「這句我記住了。」`;
}

function refreshCurrentView() {
  if (currentView === "home") renderHomeFeed();
  if (currentView === "profile") renderProfileFeed();
  if (currentView === "search") renderSearch();
  if (currentView === "messages") renderMessages();
  if (currentView === "oc") renderUserShell();
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1800);
}

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeHandle(value) {
  return String(value || "")
    .replace(/^@/, "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\w\-\u4e00-\u9fff]/g, "")
    .toLowerCase();
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
  return escapeHTML(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br>");
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
    openConversation,
    refreshRemoteData,
    renderSearch,
    saveProfile,
    sendMessage,
    setChatModel,
    setProfileTab,
    showHome,
    showMessages,
    showOCManager,
    showProfile,
    showSearch,
    showToast,
    submitPostComment,
    toggleLike
  });
}

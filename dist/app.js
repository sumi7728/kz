const STORAGE_POSTS = "jz_posts_v2_comments";
const STORAGE_LIKES = "jz_likes_v1";
const STORAGE_MESSAGES = "jz_messages_v1";
const STORAGE_PROMPTS = "jz_prompts_v1";
const STORAGE_OPEN_MODE = "jz_open_mode_v1";

let currentView = "home";
let previousView = "home";
let currentProfileUser = "kaede";
let currentProfileTab = "posts";
let currentChatUser = "zhihao";

let posts = normalizePosts(loadJSON(STORAGE_POSTS, defaultPosts));
let likedPostIds = loadJSON(STORAGE_LIKES, []);
let messages = loadJSON(STORAGE_MESSAGES, {});
let savedCharacterPrompts = loadJSON(STORAGE_PROMPTS, {});
let characterPrompts = Object.fromEntries(Object.values(users).map(user => [
  user.id,
  savedCharacterPrompts[user.id] || buildCommentPrompt(user)
]));
let openMode = localStorage.getItem(STORAGE_OPEN_MODE) === "true";

function loadJSON(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function normalizePosts(list) {
  return list.map((post, index) => {
    const comments = Array.isArray(post.comments) ? post.comments : [];

    if (post.reply && comments.length === 0) {
      comments.push({
        id: Number(`${post.id}01`),
        author: "me",
        text: "我想聽你怎麼說。",
        time: "剛剛",
        replies: [{
          id: Number(`${post.id}02`),
          author: post.reply.author,
          text: post.reply.text,
          time: "剛剛"
        }]
      });
    }

    return {
      ...post,
      reply: undefined,
      comments,
      createdAt: post.createdAt || post.id || index
    };
  });
}

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function getUser(id) {
  return users[id] || users.me || users.kaede;
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
  if (active === "home") document.getElementById("navHome").classList.add("active");
  if (active === "search") document.getElementById("navSearch").classList.add("active");
  if (active === "messages") document.getElementById("navMessages").classList.add("active");
  if (active === "liked") document.getElementById("navLiked").classList.add("active");
  if (active === "profile") document.getElementById("navProfile").classList.add("active");
}

function showHome() {
  previousView = currentView;
  currentView = "home";
  setActiveView("homeView");
  setNav("home");
  setTopbar("動態", false);
  renderHomeFeed();
  scrollToTop();
}

function showProfile(userId = "kaede") {
  previousView = currentView;
  currentView = "profile";
  currentProfileUser = userId;
  currentProfileTab = "posts";
  setActiveView("profileView");
  setNav(userId === "kaede" ? "profile" : "");
  setTopbar(getUser(userId).name, true);
  renderProfile();
  renderProfileFeed();
  scrollToTop();
}

function showSearch() {
  previousView = currentView;
  currentView = "search";
  setActiveView("searchView");
  setNav("search");
  setTopbar("搜尋", false);
  renderSearch();
  scrollToTop();
}

function showMessages(userId = currentChatUser) {
  previousView = currentView;
  currentView = "messages";
  currentChatUser = userId === "me" ? "zhihao" : userId;
  setActiveView("messagesView");
  setNav("messages");
  setTopbar("私訊", false);
  renderMessages();
  scrollToTop();
}

function showLiked() {
  previousView = currentView;
  currentView = "liked";
  setActiveView("likedView");
  setNav("liked");
  setTopbar("已喜歡", false);
  renderLikedFeed();
  scrollToTop();
}

function showAdmin() {
  previousView = currentView;
  currentView = "admin";
  setActiveView("adminView");
  setNav("");
  setTopbar("管理者模式", true);
  renderPromptSelect();
  scrollToTop();
}

function goBack() {
  showHome();
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function sortPosts(list) {
  return [...list].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

function renderHomeFeed() {
  renderFeed("homeFeed", sortPosts(posts));
}

function renderLikedFeed() {
  const liked = sortPosts(posts.filter(post => likedPostIds.includes(post.id)));
  document.getElementById("likedFeed").innerHTML = liked.length ? "" : `<div class="empty">還沒有喜歡的貼文。</div>`;
  if (liked.length) renderFeed("likedFeed", liked);
}

function renderProfile() {
  const user = getUser(currentProfileUser);
  const userPosts = posts.filter(post => post.author === user.id);

  document.getElementById("profileArea").innerHTML = `
    <div class="profile-inner">
      <div class="identity-row">
        <img class="avatar-big" src="${user.avatar}" alt="${escapeAttribute(user.name)}">
        ${
          user.id === "me" || user.id === "kaede"
            ? `<button class="profile-action" onclick="focusComposer()">新增動態</button>`
            : `<div class="profile-actions">
                <button class="profile-action" onclick="showMessages('${user.id}')">私訊</button>
                <button class="profile-action light" onclick="showToast('已追蹤 ${escapeAttribute(user.name)}')">追蹤</button>
              </div>`
        }
      </div>
      <h1 class="display-name">${escapeHTML(user.name)}</h1>
      <div class="handle">${escapeHTML(user.handle)}</div>
      <p class="bio">${escapeHTML(user.bio)}</p>
      <div class="tags">${(user.tags || []).map(tag => `<span class="tag">${escapeHTML(tag)}</span>`).join("")}</div>
      <div class="stats">
        <span><strong>${userPosts.length}</strong> 則貼文</span>
        <span><strong>${getProfileReplyCount(user.id)}</strong> 則回覆</span>
      </div>
    </div>
  `;

  document.querySelectorAll("#profileView .tab").forEach(tab => tab.classList.remove("active"));
  document.querySelector("#profileView .tab")?.classList.add("active");
}

function getProfileReplyCount(userId) {
  return posts.reduce((count, post) => {
    return count + post.comments.reduce((sum, comment) => {
      const ownComment = comment.author === userId ? 1 : 0;
      const nestedReplies = (comment.replies || []).filter(reply => reply.author === userId).length;
      return sum + ownComment + nestedReplies;
    }, 0);
  }, 0);
}

function setProfileTab(tab, button) {
  currentProfileTab = tab;
  document.querySelectorAll("#profileView .tab").forEach(item => item.classList.remove("active"));
  button.classList.add("active");
  renderProfileFeed();
}

function renderProfileFeed() {
  let list = posts.filter(post => post.author === currentProfileUser);
  if (currentProfileTab === "replies") {
    list = posts.filter(post => post.comments.some(comment => {
      return comment.author === currentProfileUser || (comment.replies || []).some(reply => reply.author === currentProfileUser);
    }));
  }
  renderFeed("profileFeed", sortPosts(list));
}

function renderFeed(containerId, list) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!list.length) {
    container.innerHTML = `<div class="empty">這裡還沒有貼文。</div>`;
    return;
  }

  container.innerHTML = list.map(renderPost).join("");
}

function renderPost(post) {
  const author = getUser(post.author);
  const liked = likedPostIds.includes(post.id);

  return `
    <article class="thread">
      <div class="thread-left">
        <img class="avatar" src="${author.avatar}" alt="${escapeAttribute(author.name)}" onclick="showProfile('${author.id}')">
        <div class="thread-line"></div>
      </div>
      <div class="thread-main">
        <div class="post-head">
          <div class="author" onclick="showProfile('${author.id}')">
            <span class="post-name">${escapeHTML(author.name)}</span>
            <span class="post-id">${escapeHTML(author.handle)}</span>
            <span class="post-time">· ${escapeHTML(post.time || "剛剛")}</span>
          </div>
          <button class="more" onclick="showMessages('${author.id}')">私訊</button>
        </div>
        <p class="post-text">${escapeHTML(post.text)}</p>
        ${post.image ? `<div class="post-photo"><img src="${post.image}" alt="貼文圖片"></div>` : ""}
        <div class="actions">
          <button class="action ${liked ? "liked" : ""}" onclick="toggleLike(${post.id})">${liked ? "♥" : "♡"}</button>
          <button class="action" onclick="focusComment(${post.id})">💬</button>
          <button class="action" onclick="showToast('已分享')">↗</button>
        </div>
        <div class="meta">${Number(post.replies || 0)} 則回覆 · ${Number(post.likes || 0) + (liked ? 1 : 0)} 個喜歡</div>
        ${renderComments(post)}
        <div class="reply-input">
          <input id="commentInput-${post.id}" placeholder="留言給 ${escapeAttribute(author.name)}..." onkeydown="handleCommentKey(event, ${post.id})">
          <button onclick="submitPostComment(${post.id})">送出</button>
        </div>
      </div>
    </article>
  `;
}

function renderComments(post) {
  if (!post.comments.length) return "";

  return `
    <div class="comment-list">
      ${post.comments.map(comment => {
        const commentUser = getUser(comment.author);
        return `
          <div class="comment-item">
            <img class="avatar comment-avatar" src="${commentUser.avatar}" alt="${escapeAttribute(commentUser.name)}">
            <div class="comment-main">
              <div class="comment-bubble">
                <span class="comment-name">${escapeHTML(commentUser.name)}</span>
                <span class="comment-text">${escapeHTML(comment.text)}</span>
              </div>
              <div class="comment-time">${escapeHTML(comment.time || "剛剛")}</div>
              ${renderCommentReplies(comment)}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderCommentReplies(comment) {
  if (!comment.replies?.length) return "";

  return `
    <div class="comment-replies">
      ${comment.replies.map(reply => {
        const replyUser = getUser(reply.author);
        return `
          <div class="comment-reply">
            <img class="avatar comment-avatar small" src="${replyUser.avatar}" alt="${escapeAttribute(replyUser.name)}">
            <div class="comment-main">
              <div class="comment-bubble reply-bubble">
                <span class="comment-name">${escapeHTML(replyUser.name)}</span>
                <span class="comment-text">${escapeHTML(reply.text)}</span>
              </div>
              <div class="comment-time">${escapeHTML(reply.time || "剛剛")}</div>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function toggleLike(postId) {
  if (likedPostIds.includes(postId)) {
    likedPostIds = likedPostIds.filter(id => id !== postId);
  } else {
    likedPostIds.push(postId);
  }
  saveJSON(STORAGE_LIKES, likedPostIds);
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

  if (!commentText) {
    showToast("先輸入留言內容");
    return;
  }

  const postIndex = posts.findIndex(post => Number(post.id) === Number(postId));
  if (postIndex === -1) return;

  const post = posts[postIndex];
  const commentId = Date.now();
  const comment = {
    id: commentId,
    author: "me",
    text: commentText,
    time: "剛剛",
    replies: []
  };

  post.comments.push(comment);
  post.replies = Number(post.replies || 0) + 1;
  input.value = "";
  persistPosts();
  refreshCurrentView();

  try {
    showToast(`${getUser(post.author).name} 正在回覆...`);
    const response = await fetch("/api/comment-reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        characterId: post.author,
        characterPrompt: buildCommentPrompt(users[post.author]),
        characterName: users[post.author].name,
        postText: post.text,
        userComment: commentText
      })
    });

    if (!response.ok) {
      throw new Error(`API ${response.status}`);
    }

    const data = await response.json();
    const latestPost = posts.find(item => Number(item.id) === Number(postId));
    const latestComment = latestPost?.comments.find(item => Number(item.id) === Number(commentId));

    if (latestComment) {
      latestComment.replies.push({
        id: Date.now() + 1,
        author: latestPost.author,
        text: normalizeText(data.reply) || buildLocalCommentReply(latestPost.author, commentText),
        time: "剛剛"
      });
      latestPost.replies = Number(latestPost.replies || 0) + 1;
      persistPosts();
      refreshCurrentView();
    }
  } catch (error) {
    console.warn("comment reply fallback:", error);
    const latestPost = posts.find(item => Number(item.id) === Number(postId));
    const latestComment = latestPost?.comments.find(item => Number(item.id) === Number(commentId));

    if (latestComment) {
      latestComment.replies.push({
        id: Date.now() + 1,
        author: latestPost.author,
        text: buildLocalCommentReply(latestPost.author, commentText),
        time: "剛剛"
      });
      latestPost.replies = Number(latestPost.replies || 0) + 1;
      persistPosts();
      refreshCurrentView();
    }
  }
}

function buildLocalCommentReply(authorId, commentText) {
  const topic = extractTopic(commentText);
  const replies = {
    kaede: [`你這樣說我會害羞啦。`, `我才沒有那麼好懂……但你說得也不是完全錯。`],
    zhihao: [`這不是你需要操心的事。`, `她的事，我會處理。`],
    xiayan: [`我就說吧，這件事真的很明顯。`, `你很懂，我喜歡。`],
    shuxian: [`我知道，可是想到${topic}還是會在意。`, `你這樣講，我好像有比較冷靜一點。`],
    youchen: [`不是不回，是不知道怎麼說。`, `我有看到，也有在想。`],
    minjun: [`如果是我，我不會讓你等這麼久。`, `這句話我收下了。`],
    staff: [`匿名帳號只敢說：懂的都懂。`, `這留言我截圖了，但我會保命。`]
  };
  return pick(replies[authorId] || replies.kaede);
}

function addPost() {
  const input = document.getElementById("postInput");
  const text = normalizeText(input.value);
  if (!text) {
    showToast("先寫一點內容");
    return;
  }

  const now = Date.now();
  posts.unshift({
    id: now,
    createdAt: now,
    author: "kaede",
    time: "剛剛",
    text,
    image: "",
    likes: 0,
    replies: 0,
    comments: []
  });
  input.value = "";
  persistPosts();
  renderHomeFeed();
  showToast("已發布動態");
}

function focusComposer() {
  showHome();
  setTimeout(() => document.getElementById("postInput")?.focus(), 120);
}

function renderSearch() {
  const keyword = normalizeText(document.getElementById("searchInput")?.value).toLowerCase();
  const list = Object.values(users).filter(user => user.id !== "me").filter(user => {
    const content = `${user.name} ${user.handle} ${user.bio} ${(user.tags || []).join(" ")}`.toLowerCase();
    return content.includes(keyword);
  });
  const accountList = document.getElementById("accountList");
  accountList.innerHTML = list.map(user => `
    <button class="account-card" onclick="showProfile('${user.id}')">
      <img class="avatar" src="${user.avatar}" alt="${escapeAttribute(user.name)}">
      <div class="account-info">
        <strong>${escapeHTML(user.name)}</strong>
        <span>${escapeHTML(user.handle)}</span>
        <p>${escapeHTML(user.bio)}</p>
      </div>
    </button>
  `).join("") || `<div class="empty">找不到角色。</div>`;
}

function renderMessages() {
  const contacts = Object.values(users).filter(user => user.id !== "me" && user.id !== "kaede");
  const currentUser = getUser(currentChatUser);
  const conversation = getConversation(currentChatUser);

  document.getElementById("conversationList").innerHTML = contacts.map(user => `
    <button class="conversation-card ${user.id === currentChatUser ? "active" : ""}" onclick="openConversation('${user.id}')">
      <img src="${user.avatar}" alt="${escapeAttribute(user.name)}">
      <span>${escapeHTML(user.name)}</span>
    </button>
  `).join("");

  document.getElementById("chatHeader").innerHTML = `
    <img src="${currentUser.avatar}" alt="${escapeAttribute(currentUser.name)}">
    <div class="chat-title">
      <strong>${escapeHTML(currentUser.name)}</strong>
      <span>${escapeHTML(currentUser.handle)} · API 角色聊天</span>
    </div>
  `;

  document.getElementById("chatLog").innerHTML = conversation.map(item => `
    <div class="message ${item.role === "me" ? "me" : "them"}">${formatMessageHTML(item.text)}</div>
  `).join("");

  const log = document.getElementById("chatLog");
  log.scrollTop = log.scrollHeight;
}

function getConversation(userId) {
  if (!messages[userId]) {
    messages[userId] = [{ role: "them", text: getOpeningLine(userId) }];
    saveJSON(STORAGE_MESSAGES, messages);
  }
  return messages[userId];
}

function openConversation(userId) {
  currentChatUser = userId;
  renderMessages();
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
  if (!text) {
    showToast("先輸入訊息");
    return;
  }

  const conversation = getConversation(currentChatUser);
  conversation.push({ role: "me", text });
  input.value = "";
  saveJSON(STORAGE_MESSAGES, messages);
  renderMessages();
  setChatStatus(`${getUser(currentChatUser).name} 正在輸入...`);

  const reply = await createCharacterReply(currentChatUser, text, {
    mode: "dm",
    history: conversation.slice(-10)
  });

  conversation.push({ role: "them", text: reply });
  saveJSON(STORAGE_MESSAGES, messages);
  setChatStatus("");
  renderMessages();
}

async function createCharacterReply(userId, text, context) {
  const user = getUser(userId);
  const prompt = buildDMNovelPrompt(user);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        characterId: userId,
        characterName: user.name,
        prompt,
        openMode,
        message: text,
        context
      })
    });

    if (!response.ok) throw new Error(`API ${response.status}`);
    const data = await response.json();
    return normalizeText(data.reply) || buildLocalCommentReply(userId, text);
  } catch (error) {
    console.warn("chat fallback:", error);
    return buildLocalCommentReply(userId, text);
  }
}

function getOpeningLine(userId) {
  return {
    zhihao: "有事就說，我在。",
    xiayan: "說，誰惹你。",
    shuxian: "你也睡不著嗎？",
    youchen: "嗯，我在。",
    minjun: "這麼晚找我？",
    staff: "匿名帳號上線，先說我只是路過。"
  }[userId] || "我在。";
}

function extractTopic(text) {
  return normalizeText(text).split(/[，。！？\s]+/).filter(Boolean).sort((a, b) => b.length - a.length)[0] || "這件事";
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function setChatStatus(text) {
  document.getElementById("chatStatus").textContent = text;
}

function renderPromptSelect() {
  const select = document.getElementById("promptUserSelect");
  select.innerHTML = Object.values(users)
    .filter(user => user.id !== "me")
    .map(user => `<option value="${user.id}">${escapeHTML(user.name)} ${escapeHTML(user.handle)}</option>`)
    .join("");
  select.value = currentChatUser || "zhihao";
  loadPromptEditor();
}

function loadPromptEditor() {
  const userId = document.getElementById("promptUserSelect").value;
  document.getElementById("promptText").value = characterPrompts[userId] || buildCommentPrompt(getUser(userId));
  document.getElementById("openModeToggle").checked = openMode;
}

function savePromptEditor() {
  const userId = document.getElementById("promptUserSelect").value;
  characterPrompts[userId] = normalizeText(document.getElementById("promptText").value);
  openMode = document.getElementById("openModeToggle").checked;
  saveJSON(STORAGE_PROMPTS, characterPrompts);
  localStorage.setItem(STORAGE_OPEN_MODE, String(openMode));
  showToast("已儲存 prompt");
}

async function checkApiStatus() {
  const status = document.getElementById("apiStatus");
  status.textContent = "部署到 Vercel 後，/api/chat 與 /api/comment-reply 會讀取 Vercel 環境變數 OPENAI_API_KEY。";
}

function persistPosts() {
  saveJSON(STORAGE_POSTS, posts);
}

function refreshCurrentView() {
  if (currentView === "home") renderHomeFeed();
  if (currentView === "profile") renderProfileFeed();
  if (currentView === "liked") renderLikedFeed();
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1800);
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

showHome();

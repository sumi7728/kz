const STORAGE_POSTS = "kaede_social_posts_v4_all";
const STORAGE_LIKES = "kaede_social_likes_v4";

let currentView = "profile";
let previousView = "profile";
let currentProfileUser = "kaede";
let currentProfileTab = "posts";
let selectedImageData = "";

let posts = loadPosts();
let likedPostIds = loadLikes();

function loadPosts() {
  const saved = localStorage.getItem(STORAGE_POSTS);

  if (!saved) {
    return sortPosts(defaultPosts.map(post => ({
      ...post,
      createdAt: post.createdAt || post.id
    })));
  }

  try {
    const savedPosts = JSON.parse(saved);

    return sortPosts(savedPosts.map(post => ({
      ...post,
      createdAt: post.createdAt || post.id || Date.now()
    })));
  } catch (error) {
    return sortPosts(defaultPosts.map(post => ({
      ...post,
      createdAt: post.createdAt || post.id
    })));
  }
}

function saveLocalPosts() {
  localStorage.setItem(STORAGE_POSTS, JSON.stringify(posts));
}

function loadLikes() {
  const saved = localStorage.getItem(STORAGE_LIKES);

  if (!saved) {
    return [];
  }

  try {
    return JSON.parse(saved);
  } catch (error) {
    return [];
  }
}

function saveLikes() {
  localStorage.setItem(STORAGE_LIKES, JSON.stringify(likedPostIds));
}

function sortPosts(list) {
  return [...list].sort((a, b) => {
    const aTime = Number(a.createdAt || a.id || 0);
    const bTime = Number(b.createdAt || b.id || 0);
    return bTime - aTime;
  });
}

function normalizeText(str) {
  return String(str || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getUser(id) {
  return users[id] || users.kaede;
}

function setTopbar(title, showBack = false) {
  document.getElementById("topbarTitle").textContent = title;
  document.getElementById("backBtn").style.display = showBack ? "flex" : "none";
}

function setActiveView(viewId) {
  document.querySelectorAll(".view").forEach(view => {
    view.classList.remove("active");
  });

  const targetView = document.getElementById(viewId);

  if (targetView) {
    targetView.classList.add("active");
  }
}

function setNav(active) {
  document.querySelectorAll(".nav-item").forEach(item => {
    item.classList.remove("active");
  });

  if (active === "home") document.getElementById("navHome").classList.add("active");
  if (active === "search") document.getElementById("navSearch").classList.add("active");
  if (active === "liked") document.getElementById("navLiked").classList.add("active");
  if (active === "profile") document.getElementById("navProfile").classList.add("active");
}

function showProfile(userId = "kaede") {
  previousView = currentView;
  currentView = "profile";
  currentProfileUser = userId;
  currentProfileTab = "posts";

  setActiveView("profileView");
  setNav(userId === "kaede" ? "profile" : "");
  setTopbar(getUser(userId).name, userId !== "kaede");

  renderProfile();
  renderProfileFeed();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

function showHome() {
  previousView = currentView;
  currentView = "home";

  setActiveView("homeView");
  setNav("home");
  setTopbar("動態", false);
  renderHomeFeed();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

function showSearch() {
  previousView = currentView;
  currentView = "search";

  setActiveView("searchView");
  setNav("search");
  setTopbar("搜尋", false);
  renderSearch();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

function showLiked() {
  previousView = currentView;
  currentView = "liked";

  setActiveView("likedView");
  setNav("liked");
  setTopbar("已按讚", false);
  renderLikedFeed();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

function showAdmin() {
  previousView = currentView;
  currentView = "admin";

  setActiveView("adminView");
  setNav("");
  setTopbar("管理者模式", true);

  renderAdminPostSelect();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

function goBack() {
  if (currentView === "admin") {
    showHome();
    return;
  }

  showProfile("kaede");
}

function renderProfile() {
  const user = getUser(currentProfileUser);
  const userPosts = posts.filter(post => post.author === user.id);
  const mediaCount = userPosts.filter(post => post.image).length;

  document.getElementById("profileArea").innerHTML = `
    <div class="cover" style="background-image: linear-gradient(to bottom, rgba(0,0,0,0.05), rgba(0,0,0,0.22)), url('${user.cover}')"></div>

    <div class="profile-inner">
      <div class="identity-row">
        <img class="avatar-big" src="${user.avatar}" alt="${user.name}" onerror="this.style.visibility='hidden'">

        ${
          user.id === "kaede"
            ? `<button class="profile-action" onclick="focusComposer()">新增紀錄</button>`
            : `<button class="profile-action light" onclick="showToast('已追蹤 ${user.name}')">追蹤</button>`
        }
      </div>

      <div class="name-block">
        <h1 class="display-name">${user.name}</h1>
        <div class="handle">${user.handle}</div>
      </div>

      <p class="bio">${escapeHTML(normalizeText(user.bio))}</p>

      <div class="tags">
        ${user.tags.map(tag => `<span class="tag">${tag}</span>`).join("")}
      </div>

      <div class="stats">
        <span><strong>${userPosts.length}</strong> 則貼文</span>
        <span><strong>${mediaCount}</strong> 張照片</span>
        <span><strong>${user.followers}</strong> 追蹤者</span>
      </div>
    </div>
  `;

  document.querySelectorAll("#profileView .tab").forEach(tab => {
    tab.classList.remove("active");
  });

  document.querySelectorAll("#profileView .tab")[0].classList.add("active");
}

function setProfileTab(tab, button) {
  currentProfileTab = tab;

  document.querySelectorAll("#profileView .tab").forEach(item => {
    item.classList.remove("active");
  });

  button.classList.add("active");
  renderProfileFeed();
}

function renderProfileFeed() {
  let list = posts.filter(post => post.author === currentProfileUser);

  if (currentProfileTab === "media") {
    list = list.filter(post => post.image);
  }

  if (currentProfileTab === "replies") {
    list = posts.filter(post => post.reply && post.reply.author === currentProfileUser);
  }

  renderFeed("profileFeed", sortPosts(list));
}

function renderHomeFeed() {
  posts = sortPosts(posts);
  renderFeed("homeFeed", posts);
}

function renderLikedFeed() {
  const liked = sortPosts(posts.filter(post => likedPostIds.includes(post.id)));

  if (liked.length === 0) {
    document.getElementById("likedFeed").innerHTML = `
      <div class="empty">
        還沒有按讚的貼文。<br>
        在動態或個人頁點愛心後，會出現在這裡。
      </div>
    `;

    return;
  }

  renderFeed("likedFeed", liked);
}

function renderFeed(containerId, list) {
  const container = document.getElementById(containerId);

  if (!container) return;

  if (!list.length) {
    container.innerHTML = `<div class="empty">這裡還沒有貼文。</div>`;
    return;
  }

  container.innerHTML = list.map(post => {
    const author = getUser(post.author);
    const liked = likedPostIds.includes(post.id);

    return `
      <article class="thread">
        <div class="thread-left">
          <img class="avatar" src="${author.avatar}" alt="${author.name}" onclick="showProfile('${author.id}')" onerror="this.style.visibility='hidden'">
          <div class="thread-line"></div>
        </div>

        <div class="thread-main">
          <div class="post-head">
            <div class="author" onclick="showProfile('${author.id}')">
              <span class="post-name">${author.name}</span>
              <span class="post-id">${author.handle}</span>
              <span class="post-time">· ${post.time}</span>
            </div>

            <button class="more" onclick="showPostMenu(${post.id})">⋯</button>
          </div>

          <p class="post-text">${escapeHTML(normalizeText(post.text))}</p>

          ${
            post.image
              ? `
                <div class="post-photo">
                  <img src="${post.image}" alt="日常照片" onerror="this.parentElement.style.display='none'">
                </div>
              `
              : ""
          }

          <div class="actions">
            <button class="action ${liked ? "liked" : ""}" onclick="toggleLike(${post.id}, this)">${liked ? "♥" : "♡"}</button>
            <button class="action" onclick="showToast('回覆 ${author.name}')">💬</button>
            <button class="action" onclick="showToast('已轉發')">↻</button>
            <button class="action" onclick="showToast('已分享')">↗</button>
          </div>

          <div class="meta">${Number(post.replies || 0)} 則回覆 · ${Number(post.likes || 0) + (liked ? 1 : 0)} 個喜歡</div>

          ${post.reply ? renderReply(post.reply) : ""}

          ${
            post.local
              ? `<button class="delete-btn" onclick="deletePost(${post.id})">刪除這則紀錄</button>`
              : ""
          }
        </div>
      </article>
    `;
  }).join("");
}

function renderReply(reply) {
  const replyUser = getUser(reply.author);

  return `
    <div class="reply">
      <img class="avatar" src="${replyUser.avatar}" alt="${replyUser.name}" onclick="showProfile('${replyUser.id}')" onerror="this.style.visibility='hidden'">

      <div class="reply-main">
        <div class="reply-head" onclick="showProfile('${replyUser.id}')">
          <span class="reply-name">${replyUser.name}</span>
          <span class="reply-id">${replyUser.handle}</span>
        </div>

        <p class="reply-text">${escapeHTML(normalizeText(reply.text))}</p>
      </div>
    </div>
  `;
}

function renderSearch() {
  const input = document.getElementById("searchInput");
  const keyword = (input?.value || "").trim().toLowerCase();

  const list = Object.values(users).filter(user => {
    const text = `${user.name} ${user.handle} ${user.bio} ${user.tags.join(" ")}`.toLowerCase();
    return text.includes(keyword);
  });

  const accountList = document.getElementById("accountList");

  if (!accountList) return;

  if (!list.length) {
    accountList.innerHTML = `<div class="empty">找不到帳號。</div>`;
    return;
  }

  accountList.innerHTML = list.map(user => `
    <button class="account-card" onclick="showProfile('${user.id}')">
      <img class="avatar" src="${user.avatar}" alt="${user.name}" onerror="this.style.visibility='hidden'">

      <div class="account-info">
        <strong>${user.name}</strong>
        <span>${user.handle}</span>
        <p>${escapeHTML(normalizeText(user.bio)).replace(/\n/g, " ")}</p>
      </div>
    </button>
  `).join("");
}

function focusComposer() {
  showHome();

  setTimeout(() => {
    const composer = document.getElementById("composer");
    const input = document.getElementById("postInput");

    composer.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });

    setTimeout(() => {
      input.focus();
    }, 250);
  }, 80);
}

function handleImageUpload(event) {
  const file = event.target.files[0];

  if (!file) return;

  if (!file.type.startsWith("image/")) {
    showToast("請選擇圖片檔");
    return;
  }

  if (file.size > 4 * 1024 * 1024) {
    showToast("圖片太大，建議 4MB 以下");
    event.target.value = "";
    return;
  }

  const reader = new FileReader();

  reader.onload = function(e) {
    selectedImageData = e.target.result;
    document.getElementById("previewImage").src = selectedImageData;
    document.getElementById("previewBox").classList.add("show");
  };

  reader.readAsDataURL(file);
}

function removePreview() {
  selectedImageData = "";
  document.getElementById("imageInput").value = "";
  document.getElementById("previewImage").src = "";
  document.getElementById("previewBox").classList.remove("show");
}

function addPost() {
  const input = document.getElementById("postInput");
  const text = normalizeText(input.value);

  if (!text && !selectedImageData) {
    showToast("先寫一點日常或選一張照片");
    return;
  }

  const now = Date.now();
  const category = selectedImageData ? "media" : guessCategory(text);

  const newPost = {
    id: now,
    createdAt: now,
    author: "kaede",
    time: "剛剛",
    text: text || "新增了一張日常照片。",
    image: selectedImageData,
    likes: 0,
    replies: 0,
    category,
    reply: {
      author: "zhihao",
      text: getYanReply(category)
    },
    local: true
  };

  posts = sortPosts([newPost, ...posts]);
  saveLocalPosts();

  input.value = "";
  removePreview();

  renderHomeFeed();
  showToast("已發布");
}

function guessCategory(text) {
  const t = text.toLowerCase();

  if (t.includes("吃醋") || t.includes("男人") || t.includes("別人") || t.includes("靠近")) {
    return "jealous";
  }

  if (t.includes("照片") || t.includes("拍") || t.includes("圖片")) {
    return "media";
  }

  return "daily";
}

function getYanReply(category) {
  const replies = {
    jealous: "我不喜歡別人靠近妳，這件事不需要再問。",
    media: "照片可以留，但不要發太多。",
    daily: "我看到了。"
  };

  return replies[category] || replies.daily;
}

function toggleLike(postId, button) {
  if (likedPostIds.includes(postId)) {
    likedPostIds = likedPostIds.filter(id => id !== postId);
  } else {
    likedPostIds.push(postId);
  }

  saveLikes();

  if (currentView === "home") renderHomeFeed();
  if (currentView === "profile") renderProfileFeed();
  if (currentView === "liked") renderLikedFeed();
  if (currentView === "admin") renderAdminPostSelect();
}

function deletePost(id) {
  const ok = confirm("確定要刪除這則紀錄嗎？");

  if (!ok) return;

  posts = posts.filter(post => Number(post.id) !== Number(id));
  likedPostIds = likedPostIds.filter(postId => Number(postId) !== Number(id));

  saveLocalPosts();
  saveLikes();

  refreshAllViews();

  if (currentView === "admin") {
    renderAdminPostSelect();
  }

  showToast("已刪除");
}

function showPostMenu(id) {
  const post = posts.find(item => Number(item.id) === Number(id));

  if (!post) return;

  const choice = prompt("輸入 1：編輯這則貼文\n輸入 2：刪除這則貼文\n輸入 3：取消");

  if (choice === "1") {
    showAdmin();

    setTimeout(() => {
      const select = document.getElementById("adminPostSelect");

      if (select) {
        select.value = String(id);
        loadAdminEditor();
      }
    }, 80);
  }

  if (choice === "2") {
    deletePost(id);
  }
}

function showMoreMenu() {
  const choice = prompt("輸入 1：清空本機新增紀錄\n輸入 2：查看保存說明\n輸入 9：進入管理者模式");

  if (choice === "1") {
    const ok = confirm("確定清空自己新增與管理者修改的紀錄嗎？");

    if (!ok) return;

    posts = sortPosts(defaultPosts.map(post => ({
      ...post,
      createdAt: post.createdAt || post.id
    })));

    likedPostIds = [];

    localStorage.removeItem(STORAGE_POSTS);
    localStorage.removeItem(STORAGE_LIKES);

    refreshAllViews();
    showToast("已清空並恢復預設貼文");
  }

  if (choice === "2") {
    alert("目前是本機保存，不用資料庫、不花錢。管理者修改、AI 生成貼文、自己新增的貼文與照片只會存在這台手機或這個瀏覽器。");
  }

  if (choice === "9") {
    showAdmin();
  }
}

function renderAdminPostSelect() {
  const select = document.getElementById("adminPostSelect");

  if (!select) return;

  posts = sortPosts(posts);

  select.innerHTML = posts.map(post => {
    const user = getUser(post.author);
    const label = `${user.name}｜${post.time || "剛剛"}｜${normalizeText(post.text).slice(0, 24)}`;

    return `<option value="${post.id}">${escapeHTML(label)}</option>`;
  }).join("");

  loadAdminEditor();
}

function loadAdminEditor() {
  const select = document.getElementById("adminPostSelect");
  const editor = document.getElementById("adminEditor");

  if (!select || !editor) return;

  const postId = Number(select.value);
  const post = posts.find(item => Number(item.id) === postId);

  if (!post) {
    editor.innerHTML = `<div class="empty">找不到貼文。</div>`;
    return;
  }

  const reply = post.reply || { author: "zhihao", text: "" };

  editor.innerHTML = `
    <label class="admin-label">發文角色</label>
    <select class="admin-select" id="adminAuthor">
      ${Object.values(users).map(user => `
        <option value="${user.id}" ${post.author === user.id ? "selected" : ""}>${user.name} ${user.handle}</option>
      `).join("")}
    </select>

    <label class="admin-label">發文時間文字</label>
    <input class="admin-input" id="adminTime" value="${escapeAttribute(post.time || "")}">

    <label class="admin-label">貼文內容</label>
    <textarea class="admin-textarea" id="adminText">${escapeHTML(post.text || "")}</textarea>

    <label class="admin-label">圖片路徑或圖片資料</label>
    <input class="admin-input" id="adminImage" value="${escapeAttribute(post.image || "")}" placeholder="例如 images/feed/kaede-garden.jpg">

    <div class="admin-file-row">
      <input type="file" accept="image/*" onchange="handleAdminImageUpload(event)">
    </div>

    ${
      post.image
        ? `
          <div class="admin-preview">
            <img src="${post.image}" alt="貼文圖片" onerror="this.parentElement.style.display='none'">
          </div>
        `
        : ""
    }

    <div class="admin-grid">
      <div>
        <label class="admin-label">讚數</label>
        <input class="admin-input" id="adminLikes" type="number" value="${Number(post.likes || 0)}">
      </div>

      <div>
        <label class="admin-label">回覆數</label>
        <input class="admin-input" id="adminReplies" type="number" value="${Number(post.replies || 0)}">
      </div>
    </div>

    <label class="admin-label">分類</label>
    <select class="admin-select" id="adminCategory">
      ${["daily", "media", "jealous", "gossip"].map(cat => `
        <option value="${cat}" ${post.category === cat ? "selected" : ""}>${cat}</option>
      `).join("")}
    </select>

    <label class="admin-label">回覆角色</label>
    <select class="admin-select" id="adminReplyAuthor">
      ${Object.values(users).map(user => `
        <option value="${user.id}" ${reply.author === user.id ? "selected" : ""}>${user.name} ${user.handle}</option>
      `).join("")}
    </select>

    <label class="admin-label">回覆內容</label>
    <textarea class="admin-textarea" id="adminReplyText">${escapeHTML(reply.text || "")}</textarea>

    <div class="admin-save-row">
      <button class="admin-btn dark" onclick="saveAdminPost(${post.id})">儲存修改</button>
      <button class="admin-btn danger" onclick="deletePost(${post.id})">刪除貼文</button>
    </div>
  `;
}

function saveAdminPost(postId) {
  const index = posts.findIndex(post => Number(post.id) === Number(postId));

  if (index === -1) return;

  const oldPost = posts[index];

  const updatedPost = {
    ...oldPost,
    author: document.getElementById("adminAuthor").value,
    time: normalizeText(document.getElementById("adminTime").value) || "剛剛",
    text: normalizeText(document.getElementById("adminText").value),
    image: document.getElementById("adminImage").value.trim(),
    likes: Number(document.getElementById("adminLikes").value || 0),
    replies: Number(document.getElementById("adminReplies").value || 0),
    category: document.getElementById("adminCategory").value,
    reply: {
      author: document.getElementById("adminReplyAuthor").value,
      text: normalizeText(document.getElementById("adminReplyText").value)
    },
    local: true,
    createdAt: oldPost.createdAt || oldPost.id || Date.now()
  };

  posts[index] = updatedPost;
  posts = sortPosts(posts);
  saveLocalPosts();

  renderAdminPostSelect();
  refreshAllViews();

  showToast("已儲存修改");
}

function handleAdminImageUpload(event) {
  const file = event.target.files[0];

  if (!file) return;

  if (!file.type.startsWith("image/")) {
    showToast("請選擇圖片檔");
    return;
  }

  if (file.size > 4 * 1024 * 1024) {
    showToast("圖片太大，建議 4MB 以下");
    event.target.value = "";
    return;
  }

  const reader = new FileReader();

  reader.onload = function(e) {
    const imageInput = document.getElementById("adminImage");

    if (imageInput) {
      imageInput.value = e.target.result;
    }

    showToast("圖片已放入欄位，記得按儲存修改");
  };

  reader.readAsDataURL(file);
}

function createBlankPost() {
  const now = Date.now();

  const newPost = {
    id: now,
    createdAt: now,
    author: "kaede",
    time: "剛剛",
    text: "新的日常紀錄。",
    image: "",
    likes: 0,
    replies: 0,
    category: "daily",
    reply: {
      author: "zhihao",
      text: "我看到了。"
    },
    local: true
  };

  posts = sortPosts([newPost, ...posts]);
  saveLocalPosts();

  renderAdminPostSelect();
  refreshAllViews();

  showToast("已新增空白貼文");
}

function generateAIPost() {
  const generated = buildAIPost();
  posts = sortPosts([generated, ...posts]);

  saveLocalPosts();
  renderAdminPostSelect();
  refreshAllViews();

  showToast("AI 已生成一則角色貼文");
}

function autoGenerateDays() {
  const count = Math.random() > 0.5 ? 1 : 2;

  for (let i = 0; i < count; i++) {
    const generated = buildAIPost(Date.now() + i + 1);
    generated.time = i === 0 ? "1 天前" : "2 天前";
    generated.createdAt = Date.now() - ((i + 1) * 86400000);
    posts.push(generated);
  }

  posts = sortPosts(posts);
  saveLocalPosts();

  renderAdminPostSelect();
  refreshAllViews();

  showToast(`已模擬 ${count} 則隔日角色貼文`);
}

function buildAIPost(customId = Date.now()) {
  const templates = [
    {
      author: "kaede",
      category: "daily",
      image: "images/feed/kaede-garden.jpg",
      textList: [
        "今天在花園澆花，裙角不小心沾到一點水。嚴志豪看見後沒有說話，只是把傘往我這邊偏了一點。",
        "我只是多看了一眼甜點櫃，嚴志豪就叫人全部包起來。很誇張，可是我還是有點開心。",
        "今天穿了新的日式洋裝。嚴志豪看了三秒，然後只說：外套穿上。"
      ],
      replyAuthor: "zhihao",
      replyList: [
        "下次不要站在風口。",
        "喜歡就買，不需要猶豫。",
        "不是管妳，是妳太容易讓人分心。"
      ]
    },
    {
      author: "zhihao",
      category: "daily",
      image: "images/feed/zhihao-office.jpg",
      textList: [
        "她今天來公司，整層樓都比平常吵。",
        "會議提前結束。不是因為她，是因為效率太低。",
        "甜點買了。她如果說不想吃，也只是現在不想。"
      ],
      replyAuthor: "kaede",
      replyList: [
        "你明明就是想早點陪我！",
        "你不要把想見我講得那麼像工作檢討啦。",
        "我才沒有那麼好猜……吧。"
      ]
    },
    {
      author: "xiayan",
      category: "jealous",
      image: "images/feed/xiayan-cafe.jpg",
      textList: [
        "西島楓說嚴志豪只是比較關心她。我看那不是關心，那是移動式監控系統。",
        "如果嚴志豪再用『安全』兩個字包裝控制慾，我真的會笑出來。",
        "今天陪西島楓喝咖啡，她手機亮了八次，八次都是同一個人。"
      ],
      replyAuthor: "kaede",
      replyList: [
        "妳不要講得好像他很可怕啦……",
        "可是他有時候真的只是擔心我。",
        "我沒有一直看手機！"
      ]
    },
    {
      author: "staff",
      category: "gossip",
      image: "images/feed/staff-office.jpg",
      textList: [
        "匿名觀察：理事長太太一出現，理事長今天的低氣壓下降了百分之三十。",
        "今日西江建設未解之謎：理事長明明說不提前下班，五分鐘後人已經在電梯裡。",
        "理事長太太今天笑著跟大家打招呼，理事長站在後面，表情像在審核所有人的視線。"
      ],
      replyAuthor: "zhihao",
      replyList: [
        "匿名不代表安全。",
        "工作時間少看八卦。",
        "明天資訊部門開會。"
      ]
    },
    {
      author: "shuxian",
      category: "daily",
      image: "images/feed/shuxian-night.jpg",
      textList: [
        "冷戰真的很煩。尤其是對方明明在線，卻假裝沒有看到。",
        "西島楓叫我不要先低頭。可是我覺得她自己遇到嚴志豪也做不到。",
        "有些人不說想念，只會問妳吃飯了沒。"
      ],
      replyAuthor: "youchen",
      replyList: [
        "我有看到。",
        "不是假裝。",
        "妳先吃飯。"
      ]
    },
    {
      author: "minjun",
      category: "jealous",
      image: "images/feed/minjun-dessert.jpg",
      textList: [
        "甜點店的燈很適合她。可惜有人總是把她看得太緊。",
        "偶然遇見西島楓。她選甜點的樣子，比櫥窗裡的東西更引人注意。",
        "有些花就算被養在玻璃溫室裡，也還是會讓路過的人停下來看。"
      ],
      replyAuthor: "zhihao",
      replyList: [
        "路過就繼續走。",
        "你看得太久了。",
        "離她遠一點。"
      ]
    }
  ];

  const template = templates[Math.floor(Math.random() * templates.length)];
  const text = template.textList[Math.floor(Math.random() * template.textList.length)];
  const replyText = template.replyList[Math.floor(Math.random() * template.replyList.length)];

  return {
    id: customId,
    createdAt: customId,
    author: template.author,
    time: "剛剛",
    text,
    image: template.image,
    likes: Math.floor(Math.random() * 900) + 60,
    replies: Math.floor(Math.random() * 90) + 8,
    category: template.category,
    reply: {
      author: template.replyAuthor,
      text: replyText
    },
    local: true
  };
}

function resetAllPosts() {
  const ok = confirm("確定要重置全部貼文嗎？這會清除管理者修改與 AI 生成貼文。");

  if (!ok) return;

  posts = sortPosts(defaultPosts.map(post => ({
    ...post,
    createdAt: post.createdAt || post.id
  })));

  likedPostIds = [];

  localStorage.removeItem(STORAGE_POSTS);
  localStorage.removeItem(STORAGE_LIKES);

  renderAdminPostSelect();
  refreshAllViews();

  showToast("已重置全部貼文");
}

function refreshAllViews() {
  if (currentView === "home") renderHomeFeed();

  if (currentView === "profile") {
    renderProfile();
    renderProfileFeed();
  }

  if (currentView === "liked") renderLikedFeed();

  if (currentView === "admin") {
    renderHomeFeed();
    renderProfile();
    renderProfileFeed();
    renderLikedFeed();
  }
}

function showToast(message) {
  const toast = document.getElementById("toast");

  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 1600);
}

function escapeHTML(str) {
  return String(str || "").replace(/[&<>"']/g, function(match) {
    const escapeMap = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };

    return escapeMap[match];
  });
}

function escapeAttribute(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

renderProfile();
renderProfileFeed();
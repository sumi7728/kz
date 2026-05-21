const users = {
  kaede: {
    id: "kaede",
    name: "西島楓",
    handle: "@kaede",
    avatar: "images/kaede.jpg",
    cover: "images/cover.jpg",
    bio: "花園、甜點、漢江、嚴志豪。\n被管著但還是很愛亂跑的嚴太太。",
    tags: ["#嚴太太", "#日式洋裝", "#甜點", "#花園"],
    following: 18,
    followers: 921
  },

  zhihao: {
    id: "zhihao",
    name: "嚴志豪",
    handle: "@zhihao",
    avatar: "images/zhihao.jpg",
    cover: "images/cover.jpg",
    bio: "西江建設理事長。\n不常發文，但每則都像命令。",
    tags: ["#理事長", "#西江建設", "#深色西裝", "#低氣壓"],
    following: 3,
    followers: 1092
  },

  shuxian: {
    id: "shuxian",
    name: "尹書賢",
    handle: "@shuxian",
    avatar: "images/shuxian.jpg",
    cover: "images/cover.jpg",
    bio: "西島楓的朋友。\n感情煩惱有點多，常常跟韓祐成冷戰，也會和西島楓互相留言取暖。",
    tags: ["#西島楓朋友", "#戀愛煩惱", "#冷戰中"],
    following: 35,
    followers: 477
  },

  youchen: {
    id: "youchen",
    name: "韓祐成",
    handle: "@youchen",
    avatar: "images/youchen.jpg",
    cover: "images/cover.jpg",
    bio: "尹書賢的感情線角色。\n偏冷淡，不太會表達，但其實不是沒有在意。",
    tags: ["#不擅表達", "#冷淡系", "#書賢相關"],
    following: 12,
    followers: 403
  },

  minjun: {
    id: "minjun",
    name: "姜珉俊",
    handle: "@minjun",
    avatar: "images/minjun.jpg",
    cover: "images/cover.jpg",
    bio: "嚴志豪的刺激點。\n只要靠近西島楓，就會讓嚴志豪進入低氣壓狀態。",
    tags: ["#危險人物", "#吃醋觸發器", "#低氣壓製造者"],
    following: 87,
    followers: 988
  },

  staff: {
    id: "staff",
    name: "西江建設員工匿名",
    handle: "@xijiang_staff",
    avatar: "images/staff.jpg",
    cover: "images/cover.jpg",
    bio: "西江建設匿名觀察帳號。\n專門記錄理事長、理事長太太，還有公司裡大家不敢問的八卦。",
    tags: ["#匿名八卦", "#西江建設", "#理事長觀察日記"],
    following: 1,
    followers: 1504
  },

  xiayan: {
    id: "xiayan",
    name: "夏妍",
    handle: "@xiayan",
    avatar: "images/xiayan.jpg",
    cover: "images/cover.jpg",
    bio: "西島楓的絕命好閨密。\n嘴很快、眼很尖，只要西島楓受委屈，她第一個衝出來罵人。",
    tags: ["#西島楓閨密", "#護楓第一名", "#嘴快心軟"],
    following: 42,
    followers: 812
  }
};

const defaultPosts = [
  {
    id: 1,
    author: "kaede",
    time: "剛剛",
    text: "今天只是想穿日式洋裝去花園澆花，結果嚴志豪從客廳看了我一眼，下一秒就把外套披到我肩上。\n我說又沒有人會看，他只淡淡回我一句：外面有監視器，也有鄰居。",
    image: "images/feed/kaede-garden.jpg",
    likes: 256,
    replies: 38,
    category: "jealous",
    reply: {
      author: "zhihao",
      text: "不是不讓妳穿，是妳沒必要讓別人看見。"
    },
    local: false
  },

  {
    id: 2,
    author: "zhihao",
    time: "1 小時",
    text: "她說只是出門買甜點，結果在櫥窗前看了二十分鐘。最後買回來第一口還要先餵我，理由是這樣比較像約會。",
    image: "images/feed/zhihao-office.jpg",
    likes: 412,
    replies: 59,
    category: "media",
    reply: {
      author: "kaede",
      text: "你明明就有吃掉，還裝得好像被我逼的一樣。"
    },
    local: false
  },

  {
    id: 3,
    author: "staff",
    time: "昨天",
    text: "匿名速報：理事長太太今天來西江建設，理事長原本排到晚上八點的會議，突然全部提早結束。原因不明，但大家都懂。",
    image: "images/feed/staff-office.jpg",
    likes: 1204,
    replies: 166,
    category: "gossip",
    reply: {
      author: "zhihao",
      text: "資訊部門明天來我辦公室。"
    },
    local: false
  },

  {
    id: 4,
    author: "xiayan",
    time: "昨天",
    text: "西島楓說她只是跟嚴志豪鬧脾氣。我看了一眼她手機裡的訊息紀錄，嚴志豪根本五分鐘問一次在哪。\n這不叫鬧脾氣，這叫被盯上。",
    image: "images/feed/xiayan-cafe.jpg",
    likes: 740,
    replies: 93,
    category: "jealous",
    reply: {
      author: "kaede",
      text: "妳不要講得好像我是被獵捕的小動物啦！"
    },
    local: false
  },

  {
    id: 5,
    author: "minjun",
    time: "1 小時",
    text: "今天在甜點店看到西島楓。她笑起來的時候，確實很難讓人裝作沒看見。",
    image: "images/feed/minjun-dessert.jpg",
    likes: 199,
    replies: 84,
    category: "jealous",
    reply: {
      author: "zhihao",
      text: "你可以選擇沒看見。"
    },
    local: false
  },

  {
    id: 6,
    author: "shuxian",
    time: "20 分鐘",
    text: "冷戰第三天。有人明明在線，卻一句話都不回。西島楓說這種人要晾著，但我覺得我快先被自己氣死。",
    image: "images/feed/shuxian-night.jpg",
    likes: 288,
    replies: 45,
    category: "daily",
    reply: {
      author: "youchen",
      text: "我不是故意不回。"
    },
    local: false
  },

  {
    id: 7,
    author: "youchen",
    time: "18 分鐘",
    text: "有些話不是不想說，是說出口就會變得很奇怪。",
    image: "images/feed/youchen-message.jpg",
    likes: 301,
    replies: 52,
    category: "daily",
    reply: {
      author: "shuxian",
      text: "你現在講這句就不奇怪嗎？"
    },
    local: false
  },

  {
    id: 8,
    author: "xiayan",
    time: "剛剛",
    text: "我只是一天沒看手機，西島楓又被嚴志豪管了三次。嚴志豪，你真的很會把照顧講得像命令。",
    image: "images/feed/kaede-date.jpg",
    likes: 520,
    replies: 66,
    category: "daily",
    reply: {
      author: "kaede",
      text: "可是他有時候真的只是怕我冷啦……"
    },
    local: false
  },
  {
    id: 9,
    author: "xiayan",
    time: "剛剛",
    text: "今天的我#OOTD",
    image: "images/feed/xiayan_ootd.png",
    likes: 520,
    replies: 66,
    category: "daily",
    reply: {
      author: "kaede",
      text: "超漂亮！❤️❤️"
    },
    local: false
  }
];
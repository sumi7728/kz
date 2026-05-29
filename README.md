# 角色動態 App

## 啟動

```powershell
node server.js
```

打開：

```text
http://localhost:3000
```

## 連接 OpenAI API

建立 `.env`，內容可以參考 `.env.example`：

```text
OPENAI_API_KEY=你的 OpenAI API key
OPENAI_MODEL=gpt-4o
PORT=3001
```

前端不會直接保存 API key；私訊會呼叫 `server.js` 的 `/api/chat`，貼文留言會呼叫 `http://localhost:3001/api/comment-reply`，由後端代理到 OpenAI Responses API。

如果 API key 沒設定或失效，前端會自動使用本機角色回覆，方便繼續測 UI。

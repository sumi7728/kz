# 角色動態 App

## Vercel 部署

這是純靜態前端搭配 Vercel API Routes 的專案。

Vercel 設定：

```text
Build Command: npm run build
Output Directory: dist
```

API routes：

```text
/api/chat
/api/comment-reply
```

## 環境變數

請在 Vercel Project Settings 裡設定：

```text
OPENAI_API_KEY=你的 OpenAI API key
OPENAI_MODEL=gpt-4o
```

不要把 `.env` 上傳 GitHub；本專案已用 `.gitignore` 排除 `.env`。

## 本機建置

```powershell
npm run build
```

輸出會在 `dist/`。

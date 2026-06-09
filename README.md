# 夢糖庭院

粉白軟萌風格的 OC 互動社群平台。玩家可以建立自己的 OC、發文留言、和 AI 角色私訊，也可以申請專屬 AI 角色。

## Render 設定

```text
Build Command: npm install
Start Command: npm start
```

## Environment Variables

請在 Render 的 Environment Variables 設定：

```text
OPENAI_API_KEY=你的 OpenAI API Key
OPENAI_MODEL=gpt-5.2
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=你的 Supabase service role key
SUPABASE_AVATAR_BUCKET=avatars
```

`.env` 不要上傳 GitHub，範例請看 `.env.example`。

## Supabase

第一次部署前，請到 Supabase SQL Editor 執行 `supabase-schema.sql`。

注意：目前的 schema 會先 drop 舊表再重建，會清空既有資料。

## 最高權限帳號

註冊帳號時使用：

```text
kaede_728
```

這個帳號會成為唯一最高權限管理者。其他帳號都會是普通玩家。

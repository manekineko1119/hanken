# 半券（LIVE TICKET STUB）

アプリの名前は「半券」。リポジトリ・フォルダ・DB の名前は `liveapp` のまま。

ライブに行く人のための PWA。ライブの予定を登録し、出演者の予習プレイリストを作る。
静的な ES modules（GitHub Pages で配信）と Supabase でできている。

## テスト

```powershell
npm test
```

## ローカルで開く

```powershell
python scripts/serve.py
```

ブラウザで http://localhost:8080/ を開く（Google ログインの戻り先が localhost のため）。

`python -m http.server` は使わない。Windows の Python は `.mjs` を `text/plain` で返すので、ブラウザがプログラムを動かさず、画面が空になる。`scripts/serve.py` は `.js`・`.mjs` を JavaScript として返す。

## 補足

- `vendor/supabase-js.mjs` は supabase-js をそのまま置いたもの（ライセンスは `vendor/LICENSE-supabase-js.txt`）。
- `src/config.js` の publishable key だけを書く。secret key は入れない。

## Google ログインの設定（オーナーの作業）

ローカルの Supabase で Google ログインを使うには、`npx supabase start` の前に、Google Cloud の OAuth クライアントの値を `supabase/.env`（`.env*` は git に入れない）に書く。

```
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=（クライアント ID）
SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=（クライアント シークレット）
```

- この2つが無いと、`supabase start` は Google プロバイダの設定で失敗する。
- 開くのは http://localhost:8080/ （`supabase/config.toml` の `site_url` と合わせてある）。

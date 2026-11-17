# 半券（LIVE TICKET STUB）

ライブに行く人のための PWA。ライブの予定を登録し、出演者の予習プレイリストを作って YouTube に保存する。
静的な ES modules（GitHub Pages で配信）と Supabase でできている。

- アプリ：https://manekineko1119.github.io/hanken/
- プライバシーポリシー：https://manekineko1119.github.io/hanken/privacy.html
- 招待制。招待された Google アカウントだけがログインできる。

アプリの名前は「半券」。GitHub のリポジトリは `hanken`。手元のフォルダと DB の中の名前は `liveapp` のまま。

## テスト

```powershell
npm test
```

## ローカルで開く

```powershell
python scripts/serve.py
```

ローカルで試すときは、ブラウザで http://localhost:8080/ を開く（ローカルの Google ログインの戻り先が localhost のため）。`localhost`・`127.0.0.1` で開くとローカルの Supabase を、それ以外のホストでは本番の Supabase を使う（`src/config.js`）。

`python -m http.server` は使わない。Windows の Python は `.mjs` を `text/plain` で返すので、ブラウザがプログラムを動かさず、画面が空になる。`scripts/serve.py` は `.js`・`.mjs` を JavaScript として返す。

## 補足

- `vendor/supabase-js.mjs` は supabase-js をそのまま置いたもの（ライセンスは `vendor/LICENSE-supabase-js.txt`）。
- `src/config.js` の publishable key だけを書く。secret key は入れない。
- Jekyll を通さないため、いちばん上に `.nojekyll` を置いている（`_shared/` を公開から外さないため）。

## Google ログインの設定（オーナーの作業）

ローカルの Supabase で Google ログインを使うには、`npx supabase start` の前に、Google Cloud の OAuth クライアントの値を `supabase/.env`（`.env*` は git に入れない）に書く。

```
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=（クライアント ID）
SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=（クライアント シークレット）
```

- この2つが無いと、`supabase start` は Google プロバイダの設定で失敗する。
- 開くのは http://localhost:8080/ （`supabase/config.toml` の `site_url` と合わせてある）。

## 本番に入れる（オーナーの作業）

Supabase CLI の `db push`・`secrets set`・`functions deploy` は、`--remote=<project ref>` を付けないとローカルが相手になる。本番に入れるときは、必ず `--remote=<project ref>` を付け、出力の `Target:` を見てから進める。

1. DB：`npx supabase db push --remote=<project ref> --dry-run` で入れる migration を見てから、`--dry-run` を外して入れる。2回目からは、入れる前にバックアップを取る。
2. Secrets：本番の値を `supabase/functions/.env.production`（git に入れない）にまとめ、`npx supabase secrets set --env-file supabase/functions/.env.production --remote=<project ref>` で入れる。
3. Edge Functions：`npx supabase functions deploy --remote=<project ref> --use-api`。JWT を確かめるかどうかは `supabase/config.toml` の関数ごとの設定で決まる。
4. アプリ：`main` を push すると GitHub Pages に出る。ファイルを足したり消したりしたときは、`sw.js` の `PRECACHE_URLS` と `VERSION` も直す。

- `npx supabase config push` は使わない。`config.toml` はローカル用（`site_url` が localhost など）なので、本番の設定を上書きしてしまう。本番の Auth の設定（Google・URL・招待制の Hook）はダッシュボードで変える。
- 招待する人のメールアドレスは、ダッシュボードの SQL エディタで `allowed_emails` に入れる。リポジトリには書かない。

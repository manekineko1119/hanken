# Liveapp

ライブに行く人のための PWA。ライブの予定を登録し、出演者の予習プレイリストを作る。
静的な ES modules（GitHub Pages で配信）と Supabase でできている。

## テスト

```powershell
npm test
```

## ローカルで開く

```powershell
python -m http.server 8080 --bind 127.0.0.1
```

ブラウザで http://127.0.0.1:8080/ を開く。

## 補足

- `vendor/supabase-js.mjs` は supabase-js をそのまま置いたもの（ライセンスは `vendor/LICENSE-supabase-js.txt`）。
- `src/config.js` の publishable key だけを書く。secret key は入れない。

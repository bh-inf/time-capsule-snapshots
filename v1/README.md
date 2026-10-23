# v1 公開歸檔

`schema_version` 維持 1。`v1/schema/snapshot-v1.<minor>.json` 只新增、不修改。日期檔 `v1/<地區>/<年>/<YYYY-MM-DD>.json` 在當天（台北時間）每小時更新一次，內容是當天最後一次抓到的快照；日期一過就不再修改。新欄位只能當選用欄位，並提高 `schema_minor`。

檔案由 GitHub Actions 每小時簽章後提交（內容沒變就不提交）。每次更新都重新簽章，`generated_at` 較新的才會取代舊的。新聞標題只收繁體中文：VOA 的簡體標題會轉成繁體（OpenCC，台灣用詞），行政院標題與熱搜詞若含簡體字則不收。GitHub Pages 從 `main` 的根目錄提供這些靜態檔，例如：

`https://bh-inf.github.io/time-capsule-snapshots/v1/TW/2026/2026-10-18.json`

驗章時拿掉 `signature`，對剩下的 JSON 做 RFC 8785 正規化，再用 `v1/keys/<key_id>.hex` 的公鑰驗證。不要先正規化成讀取端補過預設值的物件再驗。

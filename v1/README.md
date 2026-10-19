# v1 公開歸檔

`schema_version` 維持 1。已發布的日期檔 `v1/<地區>/<年>/<YYYY-MM-DD>.json` 與 `v1/schema/snapshot-v1.<minor>.json` 只新增、不修改。新欄位只能當選用欄位，並提高 `schema_minor`。

每天的檔案由 GitHub Actions 簽章後提交。GitHub Pages 從 `main` 的根目錄提供這些靜態檔，例如：

`https://bh-inf.github.io/time-capsule-snapshots/v1/TW/2026/2026-10-18.json`

驗章時拿掉 `signature`，對剩下的 JSON 做 RFC 8785 正規化，再用 `v1/keys/<key_id>.hex` 的公鑰驗證。不要先正規化成讀取端補過預設值的物件再驗。

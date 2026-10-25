# time-capsule-snapshots

公開的每日世界快照歸檔。Collector 與排程把 `v1/` 以不可變的日期檔寫進 `main`，再由 GitHub Pages 提供靜態檔。

`schema_version` 維持 1。新欄位只以選用欄位加入，並提高 `schema_minor`。已發布的 `v1/<地區>/<年>/<YYYY-MM-DD>.json` 與 `v1/schema/snapshot-v1.<minor>.json` 只新增、不修改。

## 目錄

| 路徑 | 用途 |
| --- | --- |
| `packages/schema` | 寫入端 schema（`snapshot-v1.1.json`）與凍結的 minor 0 讀取端 schema |
| `packages/snapshot` | 蒐集、SSRF 防護、RSS、簽章、歸檔寫入 |
| `pipeline/snapshot` | `canary` / `collect` / `gaps` 進入點 |
| `fixtures/snapshot`、`fixtures/registry` | 舊資料、新資料與價格品項 fixture |
| `v1/` | 公開歸檔。日期檔由排程寫入；schema 與 registry 的凍結複本隨 PR 進庫 |
| `privacy/` | App 的隱私政策頁，商店上架填的政策網址 |
| `.github/workflows/snapshot.yml` | 每日 21:30（台北）蒐集並發布 |
| `.github/workflows/ci.yml` | `typecheck`、`test`、`audit`、`license` |

流行歌曲來自 KKBOX Open API 的「華語單曲日榜」前 3 名，只存歌名、歌手、名次、KKBOX 歌曲頁連結、ISRC 與 KKBOX 歌曲 ID，不存封面、試聽或串流網址。沒有設定 `KKBOX_CLIENT_ID`／`KKBOX_CLIENT_SECRET` 時不會發出請求，`songs.status` 為 `unavailable`。設定金鑰前，請先確認 KKBOX 開發者條款允許把這些欄位永久公開保存。價格欄位沒有數值，只保留品項定義。Threads 網域一律拒絕，不會發出請求。

## 出處

| 來源 | 用法 | 出處 |
| --- | --- | --- |
| 行政院開放資料 | 只存標題，不存內文。資料集 `https://www.ey.gov.tw/NewOpenData/JSON/154` | 行政院。政府資料開放授權條款第 1 版。使用時應註明出處。https://data.gov.tw/license |
| Google Trends | RSS `https://trends.google.com/trending/rss?geo=<地區>`。不抓 explore 頁，也不存新聞標題或圖片 | Google Trends。再使用時請註明 Google。https://support.google.com/trends/answer/4365538?hl=en |
| 美國之音 | RSS `https://www.voachinese.com/api/zm_yql-vomx-tpeybti`。排除 AP、Reuters、AFP 素材 | VOA 自製內容屬於公有領域，引用請註明 VOA。https://www.voanews.com/p/5338.html |
| 中央氣象署 | `F-C0032-001`（預報）與 `O-A0003-001`（現在天氣觀測，縣市內海拔 500 公尺以下測站取中位數；讀不到時退回預報），`Authorization` header，金鑰不進 URL | 中央氣象署開放資料（氣象資料開放平台） |
| KKBOX | Open API `client_credentials` 取 token，`/v1.1/charts?territory=TW` 依標題找「華語單曲日榜」，再取 `/charts/<id>/tracks` 前 3 名。金鑰與 token 不進 URL | KKBOX，`songs.source` 為 `KKBOX 華語單曲日榜` |

## 每日 workflow 的 secret 與變數

全部放在 GitHub Environment **`snapshot-publish`**。這個 environment 只允許 `main`，而且**不要**設定 required reviewers，否則 cron 會一直等核准。

| 名稱 | 類型 | 哪個 job | 用途 |
| --- | --- | --- | --- |
| `SNAPSHOT_DEPLOY_KEY` | secret | `publish` | 只寫這個 repo 的 deploy key 私鑰。OpenSSH 或 PEM 原文，不要 base64。公開的 GitHub Actions token 沒有寫入權限 |
| `CWA_API_KEY` | secret | `collect` | 中央氣象署 API 的 `Authorization` header |
| `KKBOX_CLIENT_ID`、`KKBOX_CLIENT_SECRET` | secret（選用） | `collect` | KKBOX Open API 應用程式憑證。沒設就不抓流行歌 |
| `SNAPSHOT_SIGNING_KEY_HEX` | secret | `collect` | Ed25519 簽章私鑰。32-byte seed 的 64 個 hex，或 PKCS#8 hex。排程缺這把鑰匙會失敗，不會發布 `signature: null` |
| `SNAPSHOT_SIGNING_KEY_ID` | environment **變數**（不是 secret） | `collect` | 形如 `2026-10`，沒有預設值。必須和已提交的 `v1/keys/<key_id>.hex` 檔名一致 |

`SNAPSHOT_REQUIRE_SIGNATURE` 寫在 workflow 裡，值是 `"1"`，不是 secret。

`collect` 看得到氣象與簽章 secret，看不到 deploy key。`publish` 只看得到 deploy key，而且不再執行 `pnpm`。兩個 job 的 `contents` 都是 `read`，checkout 設 `persist-credentials: false`。

## 你要手動完成的事

1. 建立 Environment `snapshot-publish`，deployment branch 限 `main`，不要加 required reviewers。
2. 在這個 environment 放入上表的三個 secret 與 `SNAPSHOT_SIGNING_KEY_ID`。
3. 在這個 repo 的 Settings → Deploy keys 新增一把**只有這個 repo** 的 write key，私鑰原文放進 `SNAPSHOT_DEPLOY_KEY`。不要把私鑰 commit 進來。
4. 在你自己的機器從同一把私鑰導出 32-byte raw public key，寫成一行 64 個 hex，commit 成 `v1/keys/<key_id>.hex`。這個 PR 不含任何金鑰。
5. Settings → Pages：Source 選 **Deploy from a branch**，branch 選 `main`，folder 選 **`/`（root）**。網站路徑會是 `https://bh-inf.github.io/time-capsule-snapshots/v1/...`。根目錄的 `.nojekyll` 讓 Pages 不要用 Jekyll 處理 JSON。

本地試跑把 `.env.example` 複製成 `.env`（`.env` 已被 gitignore）。本地可把 `SNAPSHOT_REQUIRE_SIGNATURE` 設成 `0` 跳過簽章；排程不會這樣做。

## 驗章

拿掉 `signature` 之後，對剩下的 JSON 做 RFC 8785（`canonicalize` 2.1.0）正規化，再用公鑰驗證。不要先套讀取端的預設值再驗。

# 安全說明

這個 repo 的排程會主動抓取外部 URL，再把結果 commit 到 `main`。下面是 collector 與 workflow 的邊界。

## 出站請求

- 只允許 `https`。拒絕 userinfo、IP 字面值（含 `0x7f`、十進位整數這類會被 WHATWG 正規化的寫法）、`localhost`、`.local`、`.internal`。
- Threads（`threads.com`、`threads.net` 與子網域）在連線前就拒絕。
- DNS 在連線當下解析。`undici` 的 `connect.lookup` 只使用通過檢查的位址。私網、loopback、link-local、CGNAT、ULA、IPv4-mapped、multicast、文件用網段都拒絕。同一筆答案裡只要混有非公開位址就整筆拒絕，所以 `127.0.0.1.nip.io` 這類名稱過不了。
- Redirect 最多兩次，每一跳都重跑同一套檢查，而且 host 與 port 必須和最初的 URL 相同。預設 443 與明確的 `:443` 視為同一個 port。
- 回應有大小上限。行政院 JSON 很大，只讀前段標題就中斷，不把內文存進快照。
- 紀錄與錯誤訊息會清掉 `Authorization` 與長度 32 以上的 hex。

## 簽章

排程把 `SNAPSHOT_REQUIRE_SIGNATURE` 設成 `1`。沒有 `SNAPSHOT_SIGNING_KEY_HEX` 或 `SNAPSHOT_SIGNING_KEY_ID` 就失敗，不會寫出 `signature: null`。私鑰必須是 Ed25519。簽完立刻用 `v1/keys/<key_id>.hex` 驗一次，驗的是拿掉 `signature` 的原始 JSON，不是補過預設值之後的物件。

公鑰可以進 git。私鑰、氣象 API key、deploy key 只放在 Environment `snapshot-publish`，不要 commit。

## 發布

`collect` 沒有寫入用的 token，也沒有 deploy key。`publish` 只用 `SNAPSHOT_DEPLOY_KEY` 經 SSH 推 `main`，GitHub 的 host key 寫死在腳本裡。checkout 都是 `persist-credentials: false`。Rebase 不用 autostash；衝突或衝突標記會在 push 前失敗。Canary 在蒐集與上傳 artifact 之前跑。

## 讀取端

快照裡的標題與摘要是外部文字。顯示時要當純文字，不要當 HTML。RSS 解析用線性掃描，不使用會隨輸入長度變成二次方時間的正規表示式。

## 依賴與 CI

`canonicalize` 鎖定 `2.1.0`，Dependabot 忽略它的 major 與 minor。`pnpm audit --audit-level=moderate` 與授權掃描會擋下已知漏洞與允許清單以外的授權。

`harden-runner` 目前是 `egress-policy: audit`。這個模式下無法關閉 telemetry。改成 `block` 並維持蒐集所需的網域，留作後續工作。

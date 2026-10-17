# 簽章公鑰

每日快照用 Ed25519 簽章。這裡只放**公鑰**，一行 64 個十六進位字元（32 bytes 的 raw public key）。

檔名必須是 `v1/keys/<key_id>.hex`。`key_id` 形如 `2026-10`，而且要和 GitHub Environment `snapshot-publish` 的變數 `SNAPSHOT_SIGNING_KEY_ID` 相同。

私鑰不要放進這個目錄，也不要寫進 commit。排程若找不到對應的公鑰檔，會直接失敗，不會發布 `signature: null`。

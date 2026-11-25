# V2 階段歷史紀錄歸檔 (F10 ～ F11)

歸檔時間: 2026-11-24
前序 F0～F9 歸檔見 [V2_F0_F9_COMPLETED.md](V2_F0_F9_COMPLETED.md)。

## 階段 F10：算力調用、狀態持久化、教學範本落地與 Code Review
- [x] `F10-PRE` F0～F9 歷史無損歸檔與 F10 原子微批次清單掛載
- [x] `F10-1A` 於 `pipeline/h3_state.py` 實作七態狀態機、錯誤細分碼與跨 Session 持久化查詢
- [x] `F10-1B` 實作產物深度驗證器 `pipeline/h3_verifier.py`（ffprobe + SHA-256）
- [x] `F10-2A` 實作 Schema v2 角色感知轉接器 `pipeline/h3_manifest_adapter.py`
- [x] `F10-2B` 擴充 `pipeline/h3_colab_watchdog.py` 四階段感知與進程清理
- [x] `F10-3A` 實作兩階段授權門禁調度器 `pipeline/h3_dispatcher.py`
- [x] `F10-3B` 重構 `pipeline/h3_cli.py` 表驅動路由並接入算力調度子命令
- [x] `F10-4` 路線正名（saas_api）與前端雙向向下相容
- [x] `F10-5` Skill Discovery 雙平台實證與專案 Skill 統一導向
- [x] `F10-6A` H3 實測教學成片與完整分鏡範本全鏈路落地
- [x] `F10-6B` 規範落地與執行 `/code-review` 總驗收

## 階段 F11：UX 改善、動線收斂與資料交接可靠性
- [x] `F11-0` UX 現況盤點、User Journey 拆解與 P0~P3 問題分級
- [x] `F11-1` Web 操作動線與已知 Bug 修復（移除步驟一錯置藍框、唯一 ID、秒數檔名、步驟三下載入口）
- [x] `F11-1-FIX` 修復 Edu 幀數桶秒數累積偏差 (105s)、補齊 jobs 參考圖與消除 Adapter 短路
- [x] `F11-2` Web / Agent / CLI 資料交接可靠性
- [x] `F11-3` Prompt 生成邏輯與 `h3_cli` 整合
- [x] `F11-4` Agent-First 快速體驗入口
- [x] `F11-5` 統一 Skill 與授權引導
- [x] `F11-FIX` 跨工作流整合驗收缺陷收斂（DOM 遞迴、Inline Payload 碰撞、`build-manifest` 缺圖、Hybrid 無損匯回、Worker 鎖與 OAuth 門禁）

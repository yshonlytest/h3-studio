/**
 * H3 Storyboard Studio - cloudDiagnostics.js
 * 純邏輯：網路請求異常、跨域 (CORS) 阻擋與 API 認證錯誤診斷
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.H3CloudDiagnostics = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * 診斷網路請求錯誤並回傳使用者友善的解法引導
   * @param {Error|Object} err - 捕捉到的例外物件
   * @param {{ url?: string, service?: string, status?: number }} [context] - 上下文
   * @returns {{ title: string, reason: string, action: string, isCors: boolean, isComfy: boolean, isAuth: boolean }}
   */
  function diagnoseNetworkError(err, context = {}) {
    const message = (err && err.message) ? String(err.message) : String(err);
    const url = context.url || "";
    const status = Number(context.status) || 0;
    const isComfyTarget = url.includes("8188") || context.service === "comfyui";

    // 1. HTTP 400 Bad Request / 參數與節點校驗錯誤
    if (status === 400 || /node validation error|bad request|invalid prompt/i.test(message)) {
      if (isComfyTarget) {
        return {
          title: "ComfyUI 工作流參數或節點錯誤 (HTTP 400)",
          reason: "ComfyUI 伺服器已連線，但拒絕了此工作流請求。可能為自訂節點缺少必要輸入、端點參數格式不符或自訂節點未安裝。",
          action: "請檢查終端機中的 ComfyUI 錯誤日誌 (Node Validation Error)，確認 H3 自訂節點是否已正確放置於 custom_nodes 資料夾。",
          isCors: false,
          isComfy: true,
          isAuth: false
        };
      }
      return {
        title: "請求格式錯誤 (HTTP 400 Bad Request)",
        reason: `伺服器無法解析請求參數或缺少必要欄位: ${message}`,
        action: "請檢查傳送的資料格式或 Prompt 是否符合該 API 規範。",
        isCors: false,
        isComfy: false,
        isAuth: false
      };
    }

    // 2. API 金鑰無效或權限不足 (401 / 403)
    if (status === 401 || status === 403 || /401|403|unauthorized|forbidden|invalid_api_key/i.test(message)) {
      return {
        title: "API 金鑰 (API Key) 無效或未授權",
        reason: "遠端伺服器拒絕存取，金鑰可能輸入錯誤、額度已用罄或未啟用對應模型權限。",
        action: "請點擊頂部「🔒 安全與隱私保護」卡片中的「⚙️ 點此重新設定」，檢查並重新儲存有效的 API Key。",
        isCors: false,
        isComfy: false,
        isAuth: true
      };
    }

    // 3. 速率限制或配額超出 (429)
    if (status === 429 || /429|quota|rate limit|too many requests/i.test(message)) {
      return {
        title: "請求次數超出限制 (Rate Limit / Quota Exceeded)",
        reason: "您的 API 金鑰已達到每分鐘請求次數 (RPM) 上限，或免費額度已耗盡。",
        action: "請稍候 30-60 秒後重試，或切換至其他模型 / 金鑰。",
        isCors: false,
        isComfy: false,
        isAuth: false
      };
    }

    // 4. 伺服器內部錯誤或閘道當機 (500 / 502 / 503 / 504)
    if ((status >= 500 && status <= 504) || /500|502|503|504|internal server error|bad gateway|service unavailable/i.test(message)) {
      if (isComfyTarget) {
        return {
          title: "本地 ComfyUI 執行崩潰 (HTTP 500)",
          reason: "ComfyUI 在執行自訂節點處理時發生內部 Python 例外或顯存不足 (OOM)。",
          action: "請查看終端機中 ComfyUI 的 Python 堆疊日誌 (Traceback)，確認顯存是否足夠或調低取樣步數。",
          isCors: false,
          isComfy: true,
          isAuth: false
        };
      }
      return {
        title: "雲端伺服器臨時故障 (HTTP 5xx)",
        reason: "第三方 AI 雲端服務目前負載過高、正在重啟或發生暫時性內部錯誤。",
        action: "建議稍候 1-2 分鐘再試，或切換回路線 A 使用地端 ComfyUI 工作流進行生成。",
        isCors: false,
        isComfy: false,
        isAuth: false
      };
    }

    // 5. 本地 ComfyUI 服務未啟動或連線失敗
    const isConnRefused = status === 0 || /failed to fetch|networkerror|econnrefused|connection refused|fetch failed/i.test(message);
    if ((isComfyTarget || url.includes("127.0.0.1")) && isConnRefused) {
      return {
        title: "本地 ComfyUI 無法連線",
        reason: "瀏覽器無法連接到 http://127.0.0.1:8188。通常為服務尚未啟動，或是啟動時未加上跨域 (CORS) 標頭。",
        action: "請雙擊資料夾中的「一鍵啟動_H3分鏡工作坊.command」，或手動在終端機加上 `--listen 127.0.0.1 --port 8188 --enable-cors-header \"*\"` 啟動 ComfyUI。",
        isCors: true,
        isComfy: true,
        isAuth: false
      };
    }

    // 6. 雲端第三方 API CORS 跨域阻擋 (瀏覽器直接呼叫未允許 CORS 的 API)
    if (/failed to fetch/i.test(message) || /networkerror/i.test(message)) {
      return {
        title: "瀏覽器跨域 (CORS) 或網路阻擋",
        reason: "瀏覽器安全政策阻擋了對遠端伺服器的直接請求 (未附帶 Access-Control-Allow-Origin)，或網路斷線。",
        action: "若使用雲端影片 API，請確認該提供商是否支援前端直連；建議使用支援 CORS 的代理，或改用頂部「路線 A 地端工作流」。",
        isCors: true,
        isComfy: false,
        isAuth: false
      };
    }

    // 一般性未知錯誤
    return {
      title: isComfyTarget ? "ComfyUI 執行或回應異常" : "操作失敗",
      reason: message,
      action: isComfyTarget
        ? "請檢查 ComfyUI 終端機日誌以確認具體錯誤，並檢查輸入參數是否完整。"
        : "請檢查終端機日誌或瀏覽器 Console，確認參數是否填寫完整。",
      isCors: false,
      isComfy: isComfyTarget,
      isAuth: false
    };
  }

  return {
    diagnoseNetworkError
  };
});

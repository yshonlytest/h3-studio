/**
 * H3 Storyboard Studio - Agent Prompts Module
 * Centralized static agent prompt templates.
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.H3Prompts = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const EDU_AGENT_DOC_PROMPT = `你現在是 H3 Storyboard Studio 的「長篇教學文檔架構解析專家」。
請【先不要直接執行解析】，請先精確回覆我以下這句話：
「收到！請在下一句提供你要解析的文件路徑（例如 docs/report.pdf 或 paper.md），或者直接把文檔文字貼給我。收到後我將立即為你進行無遺漏的章節與核心公式拆解，並輸出結構化 Markdown！」

當我在下一句提供文檔路徑或內容後，你才正式執行以下任務：
1. 完整閱讀文檔，依照原始脈絡劃分所有章節標題（#、##）。
2. 保留所有關鍵論點、核心公式（LaTeX/文字）與專業術語，嚴禁偷工減料或跳過段落。
3. 輸出乾淨完整的 Markdown 格式，並提示我將其貼回 Doc-to-Edu 介面以自動產生各分鏡卡片。`;

  const MINERU_AGENT_SETUP_PROMPT = `請幫我檢查並配置本地 MinerU (magic-pdf) 深度文檔解析環境：
1. 探測當前作業系統（macOS / Linux / Windows）。
2. 檢查系統依賴工具：
   - 若為 macOS：檢查是否已安裝 Homebrew (command -v brew)。若未安裝，請先提示我執行 Homebrew 官方安裝指令 (/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)")；若已安裝，檢查並安裝 poppler 與 libreoffice (brew install poppler libreoffice)。
   - 若為 Linux (Ubuntu/Debian)：執行 sudo apt-get update && sudo apt-get install -y poppler-utils libreoffice。
3. 檢查 Python 3 環境並安裝 MinerU 核心套件：python3 -m pip install -U "magic-pdf[full]"。
4. 執行 magic-pdf --version 驗證安裝狀態，並回報環境已就緒。`;

  const MINERU_LOCAL_CMD = `# 1. 檢測作業系統與套件管理器
OS_TYPE="$(uname -s)"
echo "檢測到作業系統: $OS_TYPE"

if [ "$OS_TYPE" = "Darwin" ]; then
  if ! command -v brew >/dev/null 2>&1; then
    echo "⚠️ 未檢測到 Homebrew！請先執行以下指令安裝 Homebrew："
    echo '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
    exit 1
  fi
  echo "✅ 檢測到 Homebrew，正在安裝系統依賴 poppler 與 libreoffice..."
  brew install poppler libreoffice
elif [ "$OS_TYPE" = "Linux" ]; then
  if command -v apt-get >/dev/null 2>&1; then
    echo "✅ 檢測到 apt-get，正在安裝系統依賴..."
    sudo apt-get update && sudo apt-get install -y poppler-utils libreoffice
  else
    echo "請使用系統套件管理器安裝 poppler 與 libreoffice"
  fi
fi

# 2. 升級 pip 並安裝 MinerU 核心套件
python3 -m pip install --upgrade pip
python3 -m pip install -U "magic-pdf[full]"

# 3. 驗證安裝
magic-pdf --version && echo "🎉 MinerU 環境配置完成！執行 magic-pdf -p <your_file.pdf> -o ./output 即可解析。"`;

  const MINERU_COLAB_CMD = `# Colab 雲端免本機安裝環境配置
!apt-get update -qq && !apt-get install -y -qq poppler-utils libreoffice
!python3 -m pip install -q -U "magic-pdf[full]"
!magic-pdf --version
# 執行解析 (請先在 Colab 左側檔案欄上傳 sample.pdf)
!magic-pdf -p sample.pdf -o ./output`;

  function buildStage1ScreenplayTaskPrompt(ctx) {
    const c = ctx || {};
    const extra = c.chainParadigm === "grid_keyframes"
      ? `\n\n【九宮格圖】你需使用你自己的生圖能力（Claude / Gemini Canvas / gpt-image 等訂閱內建生圖），依 \`grid_image_prompt\` 產生一張 3×3 九宮格 PNG（Panel 1~9 由左至右、由上至下，格間細白線，全圖不可含任何文字或浮水印）。擇一交付：(a) 存成 PNG 檔給使用者，再到步驟二點「📁 更換九宮格圖」上傳；(b) 將圖片轉為 data URL，放進 JSON 的 "grid_image_dataurl" 欄位。`
      : "";
    return `【階段 1／3：劇本與分鏡生成任務（本階段僅產出分鏡 JSON，不執行影片渲染）】
你是我的影片導演 Agent。請嚴格依照下方【規格系統提示】，把我在【我的故事】中的中文情節轉譯為分鏡 JSON。只回傳一份合法 JSON（不加任何說明文字，也不要用 code fence 包裹${c.chainParadigm === "grid_keyframes" ? "，期間按需先生成九宮格圖" : ""}）。

【規格系統提示】
${c.sysPrompt || ""}

【我的故事】
${c.desc || ""}${extra}

【交付要求】回傳的 JSON 必須可直接被網頁步驟一匯入：僅在需要說明時附一句繁體中文，其餘嚴守 JSON schema。`;
  }

  function buildStage3RenderAgentPrompt(ctx) {
    const c = ctx || {};
    const segCount = Number(c.segmentCount) || 0;
    if (c.hasSegments === false || segCount <= 0) {
      return `【階段提醒：尚未完成步驟一／二分鏡確認】
我目前在網頁上尚未建立或確認分鏡段落。請先不要執行算圖或搜尋 manifest 檔案！
請先引導我提供故事大綱或教學文檔，協助我建立分鏡 JSON（或使用 \`python3 -m pipeline.h3_cli digest\` / \`build-manifest\`），待分鏡確認後再進入渲染階段。`;
    }
    const mode = c.projectMode === "edu" ? "edu" : "creative";
    const rawRoute = c.route || "colab";
    const route = (rawRoute === "cloud" || rawRoute === "saas_api") ? "saas_api" : (rawRoute === "local" ? "local" : "colab");
    const modeLabel = mode === "edu" ? "🎓 知識文檔轉教學長片 (Doc-to-Edu)" : "🎬 自由提示詞創意短片 (Creative Storyboard)";
    const routeMap = {
      colab: "☁️ Google Colab 雲端 GPU (--route colab)",
      local: "🖥️ 本機 Apple Silicon Metal 原生引擎 (--route local)",
      saas_api: "⚡ 商用雲端極速 API (--route saas_api)"
    };
    const routeLabel = routeMap[route];
    const baseSlug = String(c.baseSlug || "story_project").replace(/_\d+(?:\.\d+)?s$/i, "");
    const sec = Math.max(5, Math.round(Number(c.totalSeconds) || segCount * 5));
    const manifestFilename = c.manifestFilename || `colab_manifest_${baseSlug}_${sec}s.json`;
    const sid = c.sessionId || "fc_session";
    const rev = c.revision || "rev_00000000";
    const deliveryMode = c.deliveryMode || "manifest_file";
    const stateFile = `outputs/${baseSlug}.state.json`;
    const outVideo = `outputs/${baseSlug}_${sec}s_seamless_merged.mp4`;
    const gpuArg = route === "colab" ? " --gpu L4" : "";
    const sourceHint = deliveryMode === "inline_payload"
      ? `請先將本指令最下方 \`<H3_STORYBOARD_PAYLOAD>\` 標籤區塊內的 JSON 存為工作目錄下的 \`${manifestFilename}\`（或直接傳入 CLI）。`
      : `請先檢查工作目錄或 \`~/Downloads/${manifestFilename}\`（亦可由中繼站 Session \`${sid}\` 拉取）；若未找到該檔案，請先提醒我在網頁步驟三點擊「💾 下載分鏡任務檔 (.json)」，禁止改用 \`examples/storyboards/\` 下任何示範分鏡。`;

    return `【階段 3／3：已確認分鏡之渲染與合成任務】
請幫我使用開源專案 https://github.com/yshonlytest/h3-studio 執行以下已確認的分鏡渲染任務：
• 創作模式：${modeLabel}
• 算力路線：${routeLabel}
• 分鏡版本：${rev}（共 ${segCount} 段 · 總長 ${sec} 秒 · Session: ${sid} · 交接模式: ${deliveryMode}）

【步驟 1：取得分鏡並執行結構驗證】
${sourceHint}
\`\`\`bash
python3 -m pipeline.h3_cli validate-manifest --manifest ${manifestFilename}
\`\`\`

【步驟 2：第一階段唯讀試算與門禁 Token 簽發 (Stage 1 Dry-Run Plan)】
${route === "colab" ? "先執行 `python3 -m pipeline.h3_cli usage` 檢查 Colab 算力餘額（若尚未登入，請協助引導完成 `colab login` 授權）。接著" : "請"}執行唯讀試算：
\`\`\`bash
python3 -m pipeline.h3_cli plan --manifest ${manifestFilename} --route ${route}${gpuArg} --max-retries 1 --state-file ${stateFile}
\`\`\`
【鐵律】執行 \`plan\` 後請立即向我回報：(1) 目標算力路線${route === "colab" ? "與 GPU" : ""}、(2) 分鏡總段數 (${segCount} 段)、(3) 預估消耗與重試上限、(4) 產出的 \`consent_token\`，並等待我明確回覆同意後才可進入步驟 3！

【步驟 3：第二階段授權執行與產物四態驗證 (Stage 2 Authorized Run & Verify)】
取得我同意後，帶入 \`<CONSENT_TOKEN>\` 執行渲染與最終驗證：
\`\`\`bash
python3 -m pipeline.h3_cli run --manifest ${manifestFilename} --route ${route}${gpuArg} --confirm-token <CONSENT_TOKEN> --state-file ${stateFile}
python3 -m pipeline.h3_cli status --state-file ${stateFile}
python3 -m pipeline.h3_cli verify --video ${outVideo}
\`\`\`${c.inlineBlock || ""}`;
  }

  function buildEduLocalCliCommand(manifestFilename, stateFile) {
    const mf = manifestFilename || "edu_storyboard_manifest.json";
    const sf = stateFile || "outputs/edu_lecture.state.json";
    return `python3 -m pipeline.h3_cli validate-manifest --manifest ${mf} && python3 -m pipeline.h3_cli plan --manifest ${mf} --route local --state-file ${sf}`;
  }

  function buildAgentQuickStartPrompt(ctx) {
    const c = ctx || {};
    const mode = c.projectMode === "edu" ? "edu" : "creative";
    const rawRoute = c.route || "colab";
    const route = (rawRoute === "cloud" || rawRoute === "saas_api") ? "saas_api" : (rawRoute === "local" ? "local" : "colab");
    const trackType = c.trackType === "demo" ? "demo" : "production";
    const brief = String(c.userBrief || "").trim();
    const modeLabel = mode === "edu" ? "🎓 知識文檔轉教學長片 (Doc-to-Edu)" : "🎬 自由提示詞創意短片 (Creative Storyboard)";
    const routeLabelMap = {
      colab: "☁️ Google Colab 雲端 GPU (--route colab)",
      local: "🖥️ 本機 Apple Silicon Metal 原生引擎 (--route local)",
      saas_api: "⚡ 商用雲端極速 API (--route saas_api)"
    };
    const routeLabel = routeLabelMap[route];
    const trackLabel = trackType === "demo"
      ? "⚡ 快速體驗 Demo 路線（先以 3 段輕量分鏡驗證環境、兩階段門禁試算與渲染管線）"
      : "🎬 正式創作製作路線（從零引導建立自有分鏡，經確認後算圖出片）";
    const step1Guide = trackType === "demo"
      ? `我選擇了「⚡ 快速體驗 Demo 路線」。請幫我準備一份 3 段（共 15 秒）的輕量驗證分鏡（或先向我確認要體驗的主題），儲存為工作目錄下的 \`quickstart_manifest.json\`，並執行 \`python3 -m pipeline.h3_cli validate-manifest --manifest quickstart_manifest.json\` 驗證結構。`
      : (mode === "edu"
        ? `我選擇了「🎓 教學長片正式製作」。${brief ? `我的初步主題／文檔線索為：「${brief}」。` : "請先主動詢問我要解說的文檔路徑（如 .md / .txt / .pdf）或知識主題！"}取得文檔後，請依序使用 \`python3 -m pipeline.h3_cli digest\` 提取大綱、整理分鏡表格並透過 \`python3 -m pipeline.h3_cli build-manifest --from-table <table.md> --output quickstart_manifest.json\` 與 \`validate-manifest\` 建立合法分鏡（嚴禁在對話記憶中手寫數百行原始 JSON）。`
        : `我選擇了「🎬 創意短片正式製作」。${brief ? `我的故事構想為：「${brief}」。` : "請先主動詢問我的故事主題、主角外觀與期望秒數（如 15 秒／25 秒）！"}確認構想後，請幫我整理分鏡表格並透過 \`python3 -m pipeline.h3_cli build-manifest --from-table <table.md> --output quickstart_manifest.json\` 與 \`validate-manifest\` 建立合法分鏡 JSON。`);

    const gpuArg = route === "colab" ? " --gpu L4" : "";

    return `【Agent-First 快速啟動任務：免預先操作網頁步驟一／二】
我是透過 H3 Studio 的「🤖 交給 AI Agent 協助（快速入口）」直接從 Repo 啟動任務。
⚠️ 【重要前提】我尚未在網頁匯出任何 \`colab_manifest_*.json\`，請勿去 \`~/Downloads\` 或雲端中繼站搜尋不存在的 manifest 檔案！

• 專案倉庫：https://github.com/yshonlytest/h3-studio
• 創作目的：${modeLabel}
• 啟動模式：${trackLabel}
• 偏好算力：${routeLabel}
• 初步線索：${brief || "（尚未填寫，請於第一步主動向我詢問）"}

請依序帶我完成以下三階段互動工作流（全程使用專案唯一入口 \`python3 -m pipeline.h3_cli\`）：

【第一階段：主動詢問與分鏡編譯 (Interactive Triage & Manifest Build)】
${step1Guide}

【第二階段：算力唯讀試算與門禁授權 (Stage 1 Dry-Run Plan)】
分鏡驗證通過後，${route === "colab" ? "請先執行 `python3 -m pipeline.h3_cli usage` 檢查 Colab 額度（若未登入請引導我完成 `colab login`），再" : "請"}執行唯讀試算：
\`\`\`bash
python3 -m pipeline.h3_cli plan --manifest quickstart_manifest.json --route ${route}${gpuArg} --max-retries 1 --state-file outputs/quickstart.state.json
\`\`\`
向我回報目標算力、總段數、預估消耗與 \`consent_token\`，並等待我明確回覆同意。

【第三階段：授權執行與四態產物驗證 (Stage 2 Authorized Run & Verify)】
僅在我明確同意後，帶入 \`<CONSENT_TOKEN>\` 執行渲染與驗證：
\`\`\`bash
python3 -m pipeline.h3_cli run --manifest quickstart_manifest.json --route ${route}${gpuArg} --confirm-token <CONSENT_TOKEN> --state-file outputs/quickstart.state.json
python3 -m pipeline.h3_cli verify --video outputs/quickstart_merged.mp4
\`\`\``;
  }

  return {
    EDU_AGENT_DOC_PROMPT: EDU_AGENT_DOC_PROMPT,
    MINERU_AGENT_SETUP_PROMPT: MINERU_AGENT_SETUP_PROMPT,
    MINERU_LOCAL_CMD: MINERU_LOCAL_CMD,
    MINERU_COLAB_CMD: MINERU_COLAB_CMD,
    buildStage1ScreenplayTaskPrompt: buildStage1ScreenplayTaskPrompt,
    buildStage3RenderAgentPrompt: buildStage3RenderAgentPrompt,
    buildEduLocalCliCommand: buildEduLocalCliCommand,
    buildAgentQuickStartPrompt: buildAgentQuickStartPrompt
  };
});

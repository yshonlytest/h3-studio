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

  return {
    EDU_AGENT_DOC_PROMPT: EDU_AGENT_DOC_PROMPT,
    MINERU_AGENT_SETUP_PROMPT: MINERU_AGENT_SETUP_PROMPT,
    MINERU_LOCAL_CMD: MINERU_LOCAL_CMD,
    MINERU_COLAB_CMD: MINERU_COLAB_CMD
  };
});

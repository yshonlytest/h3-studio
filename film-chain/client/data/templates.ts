import type { DemoProjectConfig, SpeedConfig, SpeedKey } from "../types/studio.ts";

export const DEMO_PROJECT_CONFIG: DemoProjectConfig = {
  width: 1376,
  height: 768,
  frames: 124,
  steps: 20,
  layers: "45",
  reuse: 2,
  seed: 20261101,
  trim_first_frames: 1,
  ref_image_path: "assets/demo/detective_noir_ref.jpg",
  grid_image_path: "assets/demo/detective_noir_9grid.png",
  grid_image_name: "detective_noir_9grid.png",
  merged_video_path: "assets/demo/detective_25s_merged.mp4",
  part_videos: [
    { title: "Part 1 (0-5s): 雨夜巷弄與沉思獨白", url: "assets/demo/detective_part1.mp4" },
    { title: "Part 2 (5-10s): 腳步逼近與巷口回眸", url: "assets/demo/detective_part2.mp4" },
    { title: "Part 3 (10-15s): 全息解碼與荒坂機密", url: "assets/demo/detective_part3.mp4" },
    { title: "Part 4 (15-20s): 紅外鎖定與生死閃避", url: "assets/demo/detective_part4.mp4" },
    { title: "Part 5 (20-25s): 奔入雨幕與終章高潮", url: "assets/demo/detective_part5.mp4" },
  ],
  chinese_desc:
    "雨夜霓虹的新東京暗巷，身穿風衣、左眼發出藍色機械光的私家偵探在雨中避雨。點燃全息香菸沉思道：「今晚的雨，洗不掉這座城市的髒東西。」隨後察覺身後動靜回眸：「你果然還是來了，影子。」他掏出機密晶片展開旋轉全息球：「這枚晶片裡的秘密，夠拆掉整座荒坂塔。」突然紅色雷射瞄準胸口，偵探側滑貼牆拔槍：「動作挺快，但你們選錯了對手！」最後甩出干擾彈轉身狂奔入霓虹大道：「遊戲，現在才算真正開始。」",
  plan: {
    project_slug: "cyberpunk_detective_25s",
    anchor_ref_image: "examples/assets/detective_anchor_ref.jpg",
    grid_image_name: "detective_noir_9grid.png",
    recommended_total_seconds: 25,
    reasoning_zh:
      "【賽博朋克偵探 25 秒全片鏈式示範】採用 5D Context-IR 結構化提示詞與 PR #76 潛空間無損接力（--motion-context）。Part 1 首幀錨定確立雨夜氛圍、Part 2~5 全程無損潛空間延續，根除跳針並內嵌 <d>[Chinese] 台詞</d> 中文口型同步！",
    expanded_story_zh:
      "第一幕（0-5s）：雨夜暗巷，偵探背靠濕紅磚牆吸全息香菸：「今晚的雨，洗不掉這座城市的髒東西。」第二幕（5-10s）：腳步聲靠近，偵探警覺回頭，機械藍眼變焦：「你果然還是來了，影子。」第三幕（10-15s）：展開三角全息晶片投射光球：「這枚晶片裡的秘密，夠拆掉整座荒坂塔。」第四幕（15-20s）：紅外雷射鎖定胸口，偵探側身貼牆拔出電磁手槍：「動作挺快，但你們選錯了對手！」第五幕（20-25s）：投擲干擾彈後大步衝向霓虹大道：「遊戲，現在才算真正開始。」",
    segments: [
      {
        title: "Part 1 (0-5s): 雨夜巷弄與沉思獨白",
        end_panel: 2,
        chain_mode: "first_frame",
        prompt:
          "[Scene] Rain-slicked Neo-Tokyo brick alleyway at midnight with rising steam vents. [Camera] Slow cinematic dolly-in tracking shot toward the detective leaning against the damp wall. Timeline: 0-2.5s: Detective in charcoal trench coat and wet fedora raises a glowing holographic cigarette and exhales a plume of mist. 2.5-5.0s: Gazes into the neon rain and speaks: <d>[Chinese] 今晚的雨，洗不掉這座城市的髒東西。</d> [Look] High-contrast cyberpunk noir lighting, cyan and magenta reflections on wet asphalt. Audio: Heavy rain drumming on metal fire escapes, spoken dialogue: <d>[Chinese] 今晚的雨，洗不掉這座城市的髒東西。</d>",
      },
      {
        title: "Part 2 (5-10s): 腳步逼近與巷口回眸",
        end_panel: 4,
        chain_mode: "motion_context",
        prompt:
          "Create a 5-second live-action cinematic film continuing seamlessly from the exact last frame, pose, camera angle, and lighting of the previous segment. [Scene] Same rain-drenched cyberpunk alleyway with flickering neon signs. [Camera] Smooth counter-clockwise orbital arc into a profile medium close-up. Timeline: 0-2.5s: Detective lowers the cigarette and sharply snaps head toward the dark alley mouth as blue cybernetic eye lens focuses. 2.5-5.0s: Narrows eyes and speaks coldly: <d>[Chinese] 你果然還是來了，影子。</d> [Look] Sharp blue cyber-optic rim light on wet fedora brim. Audio: Mechanical optic focus click, splashing footsteps, spoken dialogue: <d>[Chinese] 你果然還是來了，影子。</d>",
      },
      {
        title: "Part 3 (10-15s): 全息解碼與荒坂機密",
        end_panel: 6,
        chain_mode: "motion_context",
        prompt:
          "Create a 5-second live-action cinematic film continuing seamlessly from the exact last frame, pose, camera angle, and lighting of the previous segment. [Scene] Deep cyberpunk alleyway shadowed by megastructure walls. [Camera] Tight push-in medium shot framing the detective's hand and face. Timeline: 0-2.5s: Detective in charcoal trench coat reveals a glowing crystal chip from inside coat; a 3D wireframe orb unfolds above the palm. 2.5-5.0s: Hologram illuminates his face as he says: <d>[Chinese] 這枚晶片裡的秘密，夠拆掉整座荒坂塔。</d> [Look] Volumetric cyan and magenta holographic rays on wet trench coat. Audio: Digital hologram hum, steady rain, spoken dialogue: <d>[Chinese] 這枚晶片裡的秘密，夠拆掉整座荒坂塔。</d>",
      },
      {
        title: "Part 4 (15-20s): 紅外鎖定與生死閃避",
        end_panel: 8,
        chain_mode: "motion_context",
        prompt:
          "Create a 5-second live-action cinematic film continuing seamlessly from the exact last frame, pose, camera angle, and lighting of the previous segment. [Scene] Rain-drenched cyberpunk alley corner under neon crossfire. [Camera] Rapid whip-pan into low-angle lateral tracking shot. Timeline: 0-2.5s: A crimson laser beam pierces the rain toward the detective's chest; detective in charcoal trench coat and fedora retracts the chip and slides behind the brick corner. 2.5-5.0s: Unholsters sleek plasma revolver and shouts: <d>[Chinese] 動作挺快，但你們選錯了對手！</d> [Look] Crimson laser glare cutting through rain mist, golden muzzle charge glow. Audio: Laser target lock whine, wet coat fabric snap, spoken dialogue: <d>[Chinese] 動作挺快，但你們選錯了對手！</d>",
      },
      {
        title: "Part 5 (20-25s): 奔入雨幕與終章高潮",
        end_panel: 9,
        chain_mode: "motion_context",
        prompt:
          "Create a 5-second live-action cinematic film continuing seamlessly from the exact last frame, pose, camera angle, and lighting of the previous segment. [Scene] Sprawling neon cyberpunk boulevard with deep rain puddles. [Camera] High-speed dynamic low-angle tracking lead shot moving backward ahead of the detective. Timeline: 0-2.5s: Detective in charcoal trench coat breaks into a full sprint, boots shattering neon puddles into flying droplets. 2.5-5.0s: Charges into the neon avenue declaring: <d>[Chinese] 遊戲，現在才算真正開始。</d> [Look] Anamorphic neon motion streaks, sharp protagonist focus. Audio: Splashing sprint footsteps, thunderclap, spoken dialogue: <d>[Chinese] 遊戲，現在才算真正開始。</d>",
      },
    ],
  },
};

export const SHISA_DEFAULT_CONFIG: DemoProjectConfig = DEMO_PROJECT_CONFIG;

export const SPEED_CONFIGS: Record<SpeedKey, SpeedConfig> = {
  quality: { mode: "turbo", width: 864, height: 480, steps: 6, layers: "50", reuse: 0, core_reuse: 0, token_reduction: false, render_width: 0, render_height: 0 },
  balanced: { mode: "base", width: 864, height: 480, steps: 20, layers: "50", reuse: 0, core_reuse: 0, token_reduction: false, render_width: 0, render_height: 0 },
  fast: { mode: "turbo", width: 512, height: 384, steps: 6, layers: "40", reuse: 2, core_reuse: 0, token_reduction: false, render_width: 256, render_height: 192 },
};

export const GOLDEN_TEMPLATES_FALLBACK: Record<string, any> = {
  ink_sorcerer: {
    title: "The Ink Sorcerer & The Goblin Defense (25s Chained Storyboard) / 墨繪靈境・苔精退散防衛戰 (25秒連貫分鏡)",
    project_slug: "ink_sorcerer_goblin_defense_25s",
    anchor_ref_image: "examples/assets/ink_sorcerer_anchor_ref.jpg",
    demo_ref_image: "assets/demo/ink_sorcerer_anchor_ref.jpg",
    merged_video_path: "assets/demo/ink_sorcerer_25s_merged.mp4",
    part_videos: [
      { title: "Part 1 (0-5s): 密林遭遇與偷襲預警", url: "assets/demo/ink_sorcerer_part1.mp4" },
      { title: "Part 2 (5-10s): 墨痕化形與墨影石犬", url: "assets/demo/ink_sorcerer_part2.mp4" },
      { title: "Part 3 (10-15s): 靈巧防禦與哥布林包抄", url: "assets/demo/ink_sorcerer_part3.mp4" },
      { title: "Part 4 (15-20s): 墨浪狂潮與百鳥退敵", url: "assets/demo/ink_sorcerer_part4.mp4" },
      { title: "Part 5 (20-25s): 墨歸平靜與森林守護", url: "assets/demo/ink_sorcerer_part5.mp4" },
    ],
    reasoning_zh: "原創手繪奇幻水彩 25 秒潛空間專屬實測範本：Part 1 首幀錨定，Part 2~5 全程 PR #76 潛空間無損接力（motion_context），內嵌時間軸台詞與自動燒錄高清字幕。",
    expanded_story_zh: "陽光斑駁的古代森林中，墨繪學者伊萊運用魔法畫筆與墨水召喚墨影石犬、金蓮墨盾與虹彩墨燕，防禦淘氣苔蘚哥布林的圍攻，最終墨化繁花回歸自然。",
    segments: [
      {
        segment: 1,
        title: "Part 1 (0-5s): Whispering Woods Ambush / 密林遭遇與偷襲預警",
        end_panel: 1,
        chain_mode: "first_frame",
        first_frame: "examples/assets/ink_sorcerer_anchor_ref.jpg",
        prompt:
          "[Scene] Whimsical ancient forest bathed in warm dappled sunlight filtering through lush emerald canopies and mossy boulders. Eli, a young ink scholar with ruffled dark hair in an adventure mantle with brass vial bandoliers, unclasps his glowing ebonwood brush as two mischievous moss goblins with acorn caps emerge from the ferns. [Camera] Smooth low-angle tracking push-in, following Eli stepping back into defensive footing. Timeline: 0-2s Twigs snap as goblins brandish wooden clubs; 2-5s Eli unscrews an indigo ink vial, brandishing his brush as shimmering droplets levitate. [Look] Whimsical hand-painted 2D animated scene, soft watercolor textures, lush natural landscapes, warm ambient lighting. Audio: Rustling foliage, playful chittering goblin snarls, gentle hum of levitating ink; Eli speaks: \"Easy, little troublemakers... don't make me paint your defeat.\"",
      },
      {
        segment: 2,
        title: "Part 2 (5-10s): Inkbound Conjuration: The Stone Hound / 墨痕化形與墨影石犬",
        end_panel: 3,
        chain_mode: "motion_context",
        prompt:
          "Create a 5-second hand-drawn animated film continuing seamlessly from the exact last frame and pose. [Scene] Same sun-dappled mossy forest clearing. Eli sweeps his ebonwood brush in a sweeping flourish through mid-air, drawing ribbons of shimmering indigo ink that coalesce into a magnificent three-dimensional ink stone hound, snarling protectively before the goblins. [Camera] Semi-orbital panning shot, circling from Eli's fluid calligraphy stroke to the ink beast landing with a heavy watercolor splash. Timeline: 0-2s Eli curves his brush with swift calligraphic momentum; 2-5s the ink hound materializes and stomps forward, scattering droplets. [Look] Whimsical hand-painted watercolor animation, lush natural backgrounds, soft rim highlights. Audio: Whoosh of heavy brush strokes, splash of magical ink, deep resonant growl of the ink hound; Eli commands: \"Flow and awaken, Kuro! Shield the grove!\"",
      },
      {
        segment: 3,
        title: "Part 3 (10-15s): Flanking Attack & The Lotus Shield / 靈巧防禦與哥布林包抄",
        end_panel: 5,
        chain_mode: "motion_context",
        prompt:
          "Create a 5-second hand-drawn animated film continuing seamlessly from the exact last frame and pose. [Scene] Ancient woodland clearing under golden canopy light. The ink hound lunges to block the frontline club attack, while two flanking goblins swing down from canopy vines hurling pinecone projectiles toward Eli. Eli spins counter-clockwise, sketching an elliptical golden lotus shield in the air. [Camera] Dynamic over-the-shoulder medium shot, capturing the deflected projectile sparks and the layered depth of combat. Timeline: 0-2s Goblins swing from mossy ropes; 2-5s Eli sketches a radiant curved ink barrier that deflects the stones with ringing chimes. [Look] Expressive watercolor fantasy aesthetics, gentle character momentum, translucent brush stroke textures. Audio: Clashing wood against ink armor, ringing crystal chimes of the lotus shield; Eli calls out: \"Nice try from above! Brush of dawn, circle of shelter!\"",
      },
      {
        segment: 4,
        title: "Part 4 (15-20s): Avian Ink Surge & Playful Dispersal / 墨浪狂潮與百鳥退敵",
        end_panel: 7,
        chain_mode: "motion_context",
        prompt:
          "Create a 5-second hand-drawn animated film continuing seamlessly from the exact last frame and pose. [Scene] Same sunlit mossy glade. Eli dips his brush into a rainbow prism ink vial and drives a grand sweeping arc toward the panicked goblins, releasing a surging swarm of luminescent watercolor ink swallows that flap playfully, disarming the attackers. [Camera] Low-angle dynamic whip-push, rushing along the flight path of the glowing ink birds. Timeline: 0-2s Eli unleashes the colorful ink wave with both hands; 2-5s dozens of miniature ink birds swoop down, pecking away clubs and chasing the bewildered goblins into retreat. [Look] High-energy whimsical hand-painted animation, vibrant watercolor splashes, warm golden particle streaks. Audio: Flapping wings of liquid ink, comedic startled goblin squeaks, rushing wind vortex; Eli laughs: \"Scatter like morning dew, bright wings of ink! Shoo them away!\"",
      },
      {
        segment: 5,
        title: "Part 5 (20-25s): Dissolution & Peaceful Bloom / 墨歸平靜與森林守護",
        end_panel: 9,
        chain_mode: "motion_context",
        prompt:
          "Create a 5-second hand-drawn animated film continuing seamlessly from the exact last frame and pose. [Scene] Serene woodland clearing as the goblins scramble away into the deep underbrush. The ink hound and fluttering swallows dissolve into a gentle shower of sparkling watercolor droplets, seeping into the mossy earth to sprout glowing blooming wildflowers. Eli serenely sheathes his brush. [Camera] Gentle boom-up and wide crane pull-out, revealing the sunlit clearing transformed with fresh vibrant blossoms. Timeline: 0-2s The ink creatures dissolve into golden mist; 2-5s Eli kneels gently to touch a newly blossomed ink flower, smiling under the tranquil canopy. [Look] Whimsical hand-painted 2D animated scene, soft watercolor textures, lush natural landscapes, nostalgic fantasy atmosphere. Audio: Peaceful forest birdsong, gentle chime of dissolving magic, soft breeze rustling canopy leaves; Eli whispers: \"Back to nature, gentle spirits. The forest is safe once more.\"",
      },
    ],
  },
  detective: {
    title: "Cyberpunk Neo-Noir Detective (25s Chained Storyboard) / 賽博霓虹・雨夜風衣偵探 (25秒連貫分鏡)",
    project_slug: "cyberpunk_detective_25s",
    anchor_ref_image: "examples/assets/detective_anchor_ref.jpg",
    demo_ref_image: "assets/demo/detective_noir_ref.jpg",
    merged_video_path: "assets/demo/detective_25s_merged.mp4",
    part_videos: DEMO_PROJECT_CONFIG.part_videos,
    reasoning_zh: "賽博龐克雨夜偵探 25 秒實測範本：Part 1 首幀錨定，Part 2~5 全程 PR #76 潛空間無損接力（motion_context），根除第 14 秒跳針問題。",
    expanded_story_zh: "偵探於新東京午夜暴雨巷弄登場、啟動手腕全息投影、察覺暗巷異動開口低語、轉身拔出電漿左輪戒備，最終在霓虹大道全力衝刺追擊。",
    segments: [
      {
        segment: 1,
        title: "Part 1 (0-5s): Establishing Shot & Rainstorm Entrance / 登場與雨夜開局",
        end_panel: 1,
        chain_mode: "first_frame",
        first_frame: "examples/assets/detective_anchor_ref.jpg",
        prompt:
          "[Scene] Futuristic rain-slicked Neo-Tokyo alleyway at midnight, vibrant magenta and cyan neon signs reflecting on wet asphalt. [Camera] Low-angle cinematic tracking push-in, starting wide and smoothly gliding closer to the protagonist. Timeline: 0-2.5s: Detective in high-collar charcoal trench coat steps forward into the rain, folding transparent cybernetic umbrella. 2.5-5.0s: Adjusts fedora, trench coat swaying in the wind, gaze fixed forward. [Look] High-contrast Blade Runner noir aesthetic, anamorphic lens flares, atmospheric steam rising from street vents. Audio: Heavy rain drumming on pavement, distant hovercar sirens echoing in the background.",
      },
      {
        segment: 2,
        title: "Part 2 (5-10s): Holographic Interface Activation / 全息信標啟動",
        end_panel: 3,
        chain_mode: "motion_context",
        prompt:
          "Create a 5-second live-action cinematic film continuing seamlessly from the exact last frame and pose. [Scene] Same rain-drenched cyberpunk alleyway with flashing neon advertisements. [Camera] Dynamic counter-clockwise orbital tracking move, rotating 60 degrees around the detective. Timeline: 0-2.5s: Detective swiftly raises cybernetic right wrist and taps gauntlet. 2.5-5.0s: Glowing cyan holographic interface explodes into air, projecting complex orbital data coordinates and wireframe suspect profiles. [Look] Brilliant cyan holographic light illuminating detective's focused face and wet trench coat collar. Audio: High-frequency electronic activation chime, digital scanning pulse, steady ambient rain.",
      },
      {
        segment: 3,
        title: "Part 3 (10-15s): Shadow Alert & Voice Dialogue / 暗巷警覺與台詞對白",
        end_panel: 5,
        chain_mode: "motion_context",
        prompt:
          "Create a 5-second live-action cinematic film continuing seamlessly from the exact last frame and pose. [Scene] Deep cyberpunk alleyway shadowed by towering megastructure walls. [Camera] Slow cinematic dolly-in pushing into a dramatic medium close-up shot. Timeline: 0-2.0s: Detective halts suddenly, pivots toward the shadows with narrowing eyes. 2.0-5.0s: Draws a deep breath, delivering grim dialogue: <d>[Chinese] 看來今晚不會平靜了</d>, breath condensing into white vapor. [Look] Rim lighting on wet brim of fedora, sharp reflections in glowing ocular cyber-implant. Audio: Distant metallic clatter in darkness, sync dialogue in Chinese, quiet rainfall.",
      },
      {
        segment: 4,
        title: "Part 4 (15-20s): Combat Alert & Weapon Draw / 拔槍警備",
        end_panel: 7,
        chain_mode: "motion_context",
        prompt:
          "Create a 5-second live-action cinematic film continuing seamlessly from the exact last frame, pose, camera angle, and noir atmosphere of previous segment. [Scene] Rain-drenched cyberpunk crossroad intersection surrounded by towering skyscraper neon signs. [Camera] Rapid high-speed whip pan transitioning into low-angle dynamic truck left shot. Timeline: 0-2.5s: Detective in high-collar charcoal trench coat and wet fedora violently pivots body, coat billowing wildly in gusts, reaching under coat. 2.5-5.0s: Draws sleek matte-black plasma revolver, aiming down the foggy street with glowing blue cybernetic eye and illuminated neon crosshairs. [Look] Golden muzzle glow charging, wet fabric reflections, water splashing furiously beneath combat boots. Audio: Fabric snapping violently in gust, mechanical slide racking click, plasma capacitor whine.",
      },
      {
        segment: 5,
        title: "Part 5 (20-25s): High-Speed Sprint & Pursuit / 狂飆突進與終局追擊",
        end_panel: 9,
        chain_mode: "motion_context",
        prompt:
          "Create a 5-second live-action cinematic film continuing seamlessly from the exact last frame and pose. [Scene] Grand cyberpunk boulevard flanked by massive holographic billboards and glowing rain puddles. [Camera] High-speed dynamic tracking lead shot moving backwards as detective charges forward. Timeline: 0-3.0s: Detective sprints forward in full pursuit, combat boots violently shattering neon-lit water puddles into flying droplets. 3.0-5.0s: Leaps across steaming drainage grate, firing weapon off-screen, laser pulse illuminating entire boulevard. [Look] Intense motion blur on background neon streaks, sharp focused protagonist, cinematic lens flare. Audio: Rapid splashing footsteps, roaring plasma discharge echoing between skyscrapers, pounding thunderclap.",
      },
    ],
  },
  tutorial_140s: {
    title: "H3 Storyboard Studio 完整工作流全解析 (105秒實測指南) / H3 Storyboard Studio Complete Workflow Guide (105s)",
    project_slug: "h3_studio_tutorial_105s",
    project_mode: "edu_explainer",
    auto_duration: true,
    execution_track: "colab_quality",
    anchor_ref_image: "assets/demo/tutorial_student_ref.png",
    demo_ref_image: "assets/demo/tutorial_student_ref.png",
    merged_video_path: "assets/demo/tutorial_140s_merged.mp4",
    part_videos: [
      { title: "Part 1 (0-6.4s): 深夜期末死線與靈感啟發 / Midnight Deadline & Inspiration", url: "assets/demo/tutorial_part1.mp4" },
      { title: "Part 2 (6.4-12.8s): 步驟一：簡短構想五維擴寫 / Step 1: Prompt Expansion", url: "assets/demo/tutorial_part2.mp4" },
      { title: "Part 3 (12.8-20.5s): 步驟二：九宮格多機位調度 / Step 2: 3x3 Grid Multi-Camera", url: "assets/demo/tutorial_part3.mp4" },
      { title: "Part 4 (20.5-28.2s): 潛空間慣性無損延續 / Step 2B: Latent Space Continuity", url: "assets/demo/tutorial_part4.mp4" },
      { title: "Part 5 (28.2-35.9s): 物理慣性鎖定特徵防走樣 / Momentum Locking & Anti-Drift", url: "assets/demo/tutorial_part5.mp4" },
      { title: "Part 6 (35.9-43.6s): 情感真聲拒絕生硬念稿 / Expressive Emotional Voice", url: "assets/demo/tutorial_part6.mp4" },
      { title: "Part 7 (43.6-51.3s): 一成微量算力抽屜重抽 / 10% Compute Audio Reroll", url: "assets/demo/tutorial_part7.mp4" },
      { title: "Part 8 (51.3-59.0s): 步驟三：三大算力路線總覽 / Step 3: Compute Dispatch Overview", url: "assets/demo/tutorial_part8.mp4" },
      { title: "Part 9 (59.0-66.7s): 路線一：Apple Silicon 原生加速 / Route 1: Apple Silicon Native", url: "assets/demo/tutorial_part9.mp4" },
      { title: "Part 10 (66.7-74.4s): 路線二：商用雲端極速直連 / Route 2: SaaS Commercial API", url: "assets/demo/tutorial_part10.mp4" },
      { title: "Part 11 (74.4-82.1s): 路線三：善用贈送算力低成本排程 / Route 3: Low-Cost Cloud Scheduling", url: "assets/demo/tutorial_part11.mp4" },
      { title: "Part 12 (82.1-89.8s): 步驟四：自動音樂避讓與精確字幕 / Step 4: Audio Ducking & Subtitles", url: "assets/demo/tutorial_part12.mp4" },
      { title: "Part 13 (89.8-97.5s): 一鍵匯出與開源模型價值 / One-Click Export & Open Source", url: "assets/demo/tutorial_part13.mp4" },
      { title: "Part 14 (97.5-105.2s): 終章天亮順利交卷 / Daybreak & Successful Submission", url: "assets/demo/tutorial_part14.mp4" },
    ],
    reasoning_zh: "大學生小明期末報告實戰教學：簡短構想五維擴寫、3x3九宮格電影機位調度、潛空間無損接力慣性延續、呼吸感真聲音軌、Mac原生/商用API/低成本Colab三大算力路線調度、自動音樂避讓與精確字幕直出。",
    expanded_story_zh: "大學生小明面對期末報告死線，運用 H3 Storyboard Studio 的五維提示詞擴寫、九宮格多機位調度、潛空間接力與三大算力路線，從發想到成片一氣呵成，順利交卷。",
    segments: [
      {
        segment: 1,
        title: "Part 1 (0-6.4s): 深夜期末死線與靈感啟發 / Midnight Deadline & Inspiration",
        shot_type: "presenter_focus",
        chain_mode: "first_frame",
        first_frame: "film-chain/public/assets/demo/tutorial_student_ref.png",
        frames: 155,
        display_dialogue: "期末報告截止只剩幾小時，腦中空有畫面卻擠不出分鏡？別慌，交給 H3 幫你把想法快速具象化。",
        spoken_dialogue: "期末報告截止只剩幾小時，腦中空有畫面卻擠不出分鏡？別慌，交給 H3 幫你把想法快速具象化。",
        prompt:
          "[Scene] Cozy college dormitory room late at night, glowing laptop screen illuminates tired college student Xiao Ming wearing a heather-gray hoodie and white over-ear headphones around neck. [Camera] Slow cinematic dolly-in pushing toward Xiao Ming in medium shot. Timeline: 0-3.0s: Xiao Ming leans over his desk looking at his laptop, rubbing weary eyes. 3.0-6.4s: He sits up with a sudden idea and smiles, tapping his keyboard decisively. [Look] Warm Studio Ghibli cel-animation hand-drawn style, soft golden desk lamp ambient glow, delicate textures. Audio: <d>[Chinese] 期末報告截止只剩幾小時，腦中空有畫面卻擠不出分鏡？別慌，交給 H3 幫你把想法快速具象化。</d>.",
      },
      {
        segment: 2,
        title: "Part 2 (6.4-12.8s): 步驟一：簡短構想五維擴寫 / Step 1: Prompt Expansion",
        shot_type: "presenter_chart",
        chain_mode: "motion_context",
        frames: 155,
        display_dialogue: "步驟一輸入一句日常構想，系統會自動擴寫成五維提示詞，幫你把鏡頭運動與畫面元素整理清楚。",
        spoken_dialogue: "步驟一輸入一句日常構想，系統會自動擴寫成五維提示詞，幫你把鏡頭運動與畫面元素整理清楚。",
        prompt:
          "Create a cinematic instructional anime film continuing seamlessly from the previous segment. [Scene] Cozy dormitory desk with glowing laptop screen, neat translucent floating UI cards displaying Scene, Camera, Action, Look, Audio. [Camera] Slow steady tracking shot framing Xiao Ming at work. Timeline: 0-3.0s: Xiao Ming finishes typing a brief sentence into the input box. 3.0-6.4s: Clean holographic UI cards unfold smoothly while clear voiceover speaks. [Look] Studio Ghibli cel-animation style, warm ambient light, crisp line art. Audio: <d>[Chinese] 步驟一輸入一句日常構想，系統會自動擴寫成五維提示詞，幫你把鏡頭運動與畫面元素整理清楚。</d>.",
      },
      {
        segment: 3,
        title: "Part 3 (12.8-20.5s): 步驟二：九宮格多機位調度 / Step 2: 3x3 Grid Multi-Camera",
        shot_type: "presenter_chart",
        chain_mode: "motion_context",
        frames: 186,
        display_dialogue: "步驟二打破單調的一鏡到底，切換九宮格機位，遠景、中景與特寫自由調度，豐富影片層次。",
        spoken_dialogue: "步驟二打破單調的一鏡到底，切換九宮格機位，遠景、中景與特寫自由吊度，豐富影片層次。",
        prompt:
          "Create a cinematic instructional anime film continuing seamlessly from the previous segment. [Scene] The laptop display expands into an interactive 3x3 grid storyboard panel, displaying nine distinct cinematic camera angles of the same scene. [Camera] Dynamic horizontal pan across the nine panels. Timeline: 0-3.5s: Xiao Ming gestures towards the multi-camera grid, showing establishing shots and medium close-ups. 3.5-7.7s: Different angles illuminate in rhythm, highlighting seamless spatial continuity. [Look] Cel-shaded anime aesthetic, vibrant interface colors, warm lighting. Audio: <d>[Chinese] 步驟二打破單調的一鏡到底，切換九宮格機位，遠景、中景與特寫自由吊度，豐富影片層次。</d>.",
      },
      {
        segment: 4,
        title: "Part 4 (20.5-28.2s): 潛空間慣性無損延續 / Step 2B: Latent Space Continuity",
        shot_type: "presenter_chart",
        chain_mode: "motion_context",
        frames: 186,
        display_dialogue: "很多工具常忽略鏡頭銜接的跳針問題。我們花時間把潛空間接力做進去，讓上一鏡的動能自然延續。",
        spoken_dialogue: "很多工具常忽略鏡頭銜接的跳針問題。我們花時間把潛空間接力做進去，讓上一鏡的動能自然延續。",
        prompt:
          "Create a cinematic instructional anime film continuing seamlessly from the previous segment. [Scene] Visualization of video latent space handoff, glowing energetic streamlines connecting the end of clip A to the start of clip B. [Camera] Smooth dolly-forward traveling along the illuminated latent trajectory. Timeline: 0-3.5s: Xiao Ming explains as two video clips dock together smoothly without any visible seams or flickering. 3.5-7.7s: Velocity vectors and lighting gradients flow across the boundary continuously. [Look] Sleek anime sci-fi motion graphics seamlessly blended with warm Ghibli dorm backdrop. Audio: <d>[Chinese] 很多工具常忽略鏡頭銜接的跳針問題。我們花時間把潛空間接力做進去，讓上一鏡的動能自然延續。</d>.",
      },
      {
        segment: 5,
        title: "Part 5 (28.2-35.9s): 物理慣性鎖定特徵防走樣 / Momentum Locking & Anti-Drift",
        shot_type: "presenter_focus",
        chain_mode: "motion_context",
        frames: 186,
        display_dialogue: "不管是人物奔跑的物理慣性還是光影明暗，接力運算能鎖定特徵，讓角色和畫面不輕易變形。",
        spoken_dialogue: "不管是人物奔跑的物理慣性還是光影明暗，接力運算能鎖定特徵，讓角色和畫面不輕易變形。",
        prompt:
          "Create a cinematic instructional anime film continuing seamlessly from the previous segment. [Scene] A dynamic storyboard sequence plays inside Xiao Ming's screen, showing an animated runner in a rainstorm maintaining stride and coat flutter across cuts. [Camera] Tracking shot following the animated runner's inertia, then pulling back to Xiao Ming nodding approvingly. Timeline: 0-4.0s: The runner's motion momentum carries perfectly across scene cuts without anatomical distortion. 4.0-7.7s: Xiao Ming watches the playback with confidence. [Look] High-frame-rate action animation physics, rich atmospheric rain streaks, cohesive palette. Audio: <d>[Chinese] 不管是人物奔跑的物理慣性還是光影明暗，接力運算能鎖定特徵，讓角色和畫面不輕易變形。</d>.",
      },
      {
        segment: 6,
        title: "Part 6 (35.9-43.6s): 情感真聲拒絕生硬念稿 / Expressive Emotional Voice",
        shot_type: "presenter_chart",
        chain_mode: "motion_context",
        frames: 186,
        display_dialogue: "一般的語音合成往往死板得像念稿。H3 著重生成帶有呼吸節奏的情感聲音，讓對白更自然。",
        spoken_dialogue: "一般的語音合成往往死板得像念稿。H3 著重生成帶有呼吸節奏的情感聲音，讓對白更自然。",
        prompt:
          "Create a cinematic instructional anime film continuing seamlessly from the previous segment. [Scene] Audio waveform visualization floating beside Xiao Ming's desk, demonstrating subtle breathing dynamics and vocal cadence curves. [Camera] Gentle arc shot circling Xiao Ming listening intently through his white headphones. Timeline: 0-3.5s: Vocal audio waves glow with warm golden harmonic bands. 3.5-7.7s: Xiao Ming smiles and taps his headphones to appreciate the organic delivery. [Look] Expressive studio acoustics representation, warm anime character animation. Audio: <d>[Chinese] 一般的語音合成往往死板得像念稿。H3 著重生成帶有呼吸節奏的情感聲音，讓對白更自然。</d>.",
      },
      {
        segment: 7,
        title: "Part 7 (43.6-51.3s): 一成微量算力抽屜重抽 / 10% Compute Audio Reroll",
        shot_type: "presenter_chart",
        chain_mode: "motion_context",
        frames: 186,
        display_dialogue: "要是對某句話語氣不滿意，拉開抽屜單獨重抽音訊只要消耗一成算力，不用整部影片重跑。",
        spoken_dialogue: "要是對某句話語氣不滿意，拉開抽屜單獨重抽音訊只要消耗一成算力，不用整部影片重跑。",
        prompt:
          "Create a cinematic instructional anime film continuing seamlessly from the previous segment. [Scene] Xiao Ming slides open the audio drawer on the interface, revealing individual shot audio reroll controls and pitch inspection meters. [Camera] Medium close-up on Xiao Ming's hands operating the lightweight proxy audio canvas. Timeline: 0-3.5s: He clicks the single-shot reroll button, triggering a rapid 10% micro-compute waveform pass. 3.5-7.7s: A refreshed audio track instantly replaces the shot audio without touching video frames. [Look] Tactile UI interaction, crisp typography, responsive animations. Audio: <d>[Chinese] 要是對某句話語氣不滿意，拉開抽屜單獨重抽音訊只要消耗一成算力，不用整部影片重跑。</d>.",
      },
      {
        segment: 8,
        title: "Part 8 (51.3-59.0s): 步驟三：三大算力路線總覽 / Step 3: Compute Dispatch Overview",
        shot_type: "presenter_chart",
        chain_mode: "motion_context",
        frames: 186,
        display_dialogue: "來到步驟三算力調度，系統設計了三條不同路線，依照手邊設備與預算自由搭配。",
        spoken_dialogue: "來到步驟三算力吊度，系統設計了三條不同路線，依照手邊設備與預算自由搭配。",
        prompt:
          "Create a cinematic instructional anime film continuing seamlessly from the previous segment. [Scene] Step 3 dispatch deck lights up on screen, presenting three distinct glowing route cards: Local Mac Native, SaaS Cloud API, and Low-Cost Cloud Compute. [Camera] Slow wide tracking shot displaying the three pathways. Timeline: 0-3.5s: Xiao Ming gestures across the three options, showing flexible compute tiers. 3.5-7.7s: Each route card glows with distinct cyan, emerald, and purple highlights. [Look] Clean technical diagrams, futuristic yet approachable UI aesthetic. Audio: <d>[Chinese] 來到步驟三算力吊度，系統設計了三條不同路線，依照手邊設備與預算自由搭配。</d>.",
      },
      {
        segment: 9,
        title: "Part 9 (59.0-66.7s): 路線一：Apple Silicon 原生加速 / Route 1: Apple Silicon Native",
        shot_type: "presenter_focus",
        chain_mode: "motion_context",
        frames: 186,
        display_dialogue: "第一條是 Mac 專屬路線。多數開源專案對蘋果電腦支援有限，這裡特別原生優化，沒網路也能順暢跑。",
        spoken_dialogue: "第一條是 Mac 專屬路線。多數開源專案對蘋果電腦支援有限，這裡特別原生優化，沒網路也能順暢跑。",
        prompt:
          "Create a cinematic instructional anime film continuing seamlessly from the previous segment. [Scene] An elegant Apple Silicon chip icon shines on the screen with an offline local progress bar processing smoothly. [Camera] Push-in medium shot on Xiao Ming beside his MacBook, gesturing proudly to the fully disconnected offline badge. Timeline: 0-3.5s: The local Metal GPU engine ticks steadily, using unified memory efficiently. 3.5-7.7s: Xiao Ming shows complete privacy and zero external dependency. [Look] Crisp metallic accents, warm room lighting, sleek Apple hardware integration. Audio: <d>[Chinese] 第一條是 Mac 專屬路線。多數開源專案對蘋果電腦支援有限，這裡特別原生優化，沒網路也能順暢跑。</d>.",
      },
      {
        segment: 10,
        title: "Part 10 (66.7-74.4s): 路線二：商用雲端極速直連 / Route 2: SaaS Commercial API",
        shot_type: "presenter_chart",
        chain_mode: "motion_context",
        frames: 186,
        display_dialogue: "第二條是商用雲端直連。填入密鑰就能呼叫高效能雲端主機，多個分鏡同時並行，幾分鐘內搞定。",
        spoken_dialogue: "第二條是商用雲端直連。填入密鑰就能呼叫高效能雲端主機，多個分鏡同時並行，幾分鐘內搞定。",
        prompt:
          "Create a cinematic instructional anime film continuing seamlessly from the previous segment. [Scene] High-speed commercial cloud API dashboard, twelve video render tiles processing simultaneously in parallel streams. [Camera] Horizontal tracking shot sweeping past rapidly advancing progress indicators. Timeline: 0-3.5s: API keys connect securely as cloud cluster nodes fire up in parallel. 3.5-7.7s: All segment clips complete within minutes, flashing bright checkmarks. [Look] High-speed modern web dashboard, emerald green completion status badges. Audio: <d>[Chinese] 第二條是商用雲端直連。填入密鑰就能呼叫高效能雲端主機，多個分鏡同時並行，幾分鐘內搞定。</d>.",
      },
      {
        segment: 11,
        title: "Part 11 (74.4-82.1s): 路線三：善用贈送算力低成本排程 / Route 3: Low-Cost Cloud Scheduling",
        shot_type: "presenter_chart",
        chain_mode: "motion_context",
        frames: 186,
        display_dialogue: "第三條是善用訂閱贈送的雲端算力，用很低成本就能調用頂級顯示卡，遇到忙碌還會自動降級保底。",
        spoken_dialogue: "第三條是善用訂閱贈送的雲端算力，用很低成本就能吊用頂級顯示卡，遇到忙碌還會自動降級保底。",
        prompt:
          "Create a cinematic instructional anime film continuing seamlessly from the previous segment. [Scene] Cloud GPU scheduling terminal showing GPU quota metrics and automatic fallback mechanism from A100 to L4. [Camera] Speed-ramp shot zooming into the robust watchdog and session resilience deck. Timeline: 0-3.5s: Xiao Ming dispatches jobs utilizing bundled subscription compute units. 3.5-7.7s: The pipeline automatically recovers and continues render seamlessly if a node restarts. [Look] Deep indigo terminal theme, glowing telemetry telemetry counters. Audio: <d>[Chinese] 第三條是善用訂閱贈送的雲端算力，用很低成本就能吊用頂級顯示卡，遇到忙碌還會自動降級保底。</d>.",
      },
      {
        segment: 12,
        title: "Part 12 (82.1-89.8s): 步驟四：自動音樂避讓與精確字幕 / Step 4: Audio Ducking & Subtitles",
        shot_type: "presenter_chart",
        chain_mode: "motion_context",
        frames: 186,
        display_dialogue: "最後步驟四不用再開剪輯軟體，系統會自動在人聲處壓低背景音樂，並生成精確對齊的字幕。",
        spoken_dialogue: "最後步驟四不用再開剪輯軟體，系統會自動在人聲處壓低背景音樂，並生成精確對齊的字幕。",
        prompt:
          "Create a cinematic instructional anime film continuing seamlessly from the previous segment. [Scene] Post-production timeline deck in Step 4, audio ducking volume envelope dipping automatically under vocal spikes. [Camera] Horizontal slider shot tracking along the master timeline where synchronized yellow subtitles appear in perfect lockstep. Timeline: 0-3.5s: BGM waveform gracefully dips by 18dB whenever narration begins. 3.5-7.7s: Sharp yellow subtitles render cleanly frame-by-frame on screen. [Look] Professional digital audio workstation look, vibrant waveforms, crisp typography. Audio: <d>[Chinese] 最後步驟四不用再開剪輯軟體，系統會自動在人聲處壓低背景音樂，並生成精確對齊的字幕。</d>.",
      },
      {
        segment: 13,
        title: "Part 13 (89.8-97.5s): 一鍵匯出與開源模型價值 / One-Click Export & Open Source",
        shot_type: "presenter_focus",
        chain_mode: "motion_context",
        frames: 186,
        display_dialogue: "MiniMax 雖然是開源模型，但在多鏡頭連貫上已經相當扎實好用。點擊一鍵匯出，快速打包成片。",
        spoken_dialogue: "MiniMax 雖然是開源模型，但在多鏡頭連貫上已經相當扎實好用。點擊一鍵匯出，快速打包成片。",
        prompt:
          "Create a cinematic instructional anime film continuing seamlessly from the previous segment. [Scene] Xiao Ming at his desk clicks the glowing Export button as the final master cut assembles smoothly. [Camera] Medium close-up on Xiao Ming smiling with satisfaction, the finished multi-shot video previewing flawlessly in the player. Timeline: 0-3.5s: Xiao Ming triggers the export command with a confident click. 3.5-7.7s: The completed video file packages cleanly onto his desktop folder. [Look] Heartwarming anime atmosphere, soft golden screen reflection, clean desktop workspace. Audio: <d>[Chinese] MiniMax 雖然是開源模型，但在多鏡頭連貫上已經相當扎實好用。點擊一鍵匯出，快速打包成片。</d>.",
      },
      {
        segment: 14,
        title: "Part 14 (97.5-105.2s): 終章天亮順利交卷 / Daybreak & Successful Submission",
        shot_type: "presenter_focus",
        chain_mode: "motion_context",
        frames: 186,
        display_dialogue: "不知不覺天已經亮了，通宵趕完的期末報告順利搞定交卷！現在就打開 H3 試試看吧。",
        spoken_dialogue: "不知不覺天已經亮了，通宵趕完的期末報告順利搞定交卷！現在就打開 H3 試試看吧。",
        prompt:
          "Create a cinematic instructional anime film continuing seamlessly from the previous segment. [Scene] Dawn breaks outside the dormitory window, fresh morning sunlight pours across Xiao Ming's desk as the course assignment submission shows complete. [Camera] Glorious slow pull-back revealing Xiao Ming stretching comfortably with a drink, smiling and waving to the audience. Timeline: 0-3.5s: Morning light floods the room, digital submission portal shows Success upload badge. 3.5-7.7s: Xiao Ming smiles warmly and gives a cheerful sign-off gesture. [Look] Uplifting sunrise warmth, classic Ghibli emotional release, golden rim lighting. Audio: <d>[Chinese] 不知不覺天已經亮了，通宵趕完的期末報告順利搞定交卷！現在就打開 H3 試試看吧。</d>.",
      },
    ],
  },
};

export function createGoldenProjectObject(templateKey: string): Record<string, any> {
  if (templateKey === "tutorial_140s") {
    const tpl = GOLDEN_TEMPLATES_FALLBACK.tutorial_140s;
    return {
      id: "fc_tutorial_140s_demo",
      name: "🎓 H3 工作流教學 105s 實測指南",
      updatedAt: Date.now(),
      isDemo: true,
      activeProjectMode: "edu",
      chineseDesc: tpl.expanded_story_zh || tpl.title,
      speedMode: "quality",
      activeRoute: "colab",
      refImageDataUrl: tpl.demo_ref_image || "",
      refImageMime: "image/png",
      gridImageDataUrl: "",
      slicedPanelsDataUrls: {},
      plan: JSON.parse(JSON.stringify(tpl)),
      playlist: JSON.parse(JSON.stringify(tpl.part_videos || [])),
      mergedVideoUrl: tpl.merged_video_path || "",
      segmentHistory: {},
      activeVersionIndex: {},
      dialogueItems: [
        { partIndex: 0, partTitle: "Part 1 (0-7.3s): 深夜期末死線與靈感啟發", role: "小明", text: "期末報告截止只剩幾小時，腦中空有畫面卻擠不出分鏡？別慌，交給 H3 幫你把想法快速具象化。", baseSec: 0.0, segDurationSec: 7.26, startOffsetSec: 0.1, durationSec: 7.05 },
        { partIndex: 1, partTitle: "Part 2 (7.3-14.5s): 步驟一：簡短構想五維擴寫", role: "小明", text: "步驟一輸入一句日常構想，系統會自動擴寫成五維提示詞，幫你把鏡頭運動與畫面元素整理清楚。", baseSec: 7.26, segDurationSec: 7.26, startOffsetSec: 0.1, durationSec: 7.05 },
        { partIndex: 2, partTitle: "Part 3 (14.5-21.7s): 步驟二：九宮格多機位調度", role: "小明", text: "步驟二打破單調的一鏡到底，切換九宮格機位，遠景、中景與特寫自由調度，豐富影片層次。", baseSec: 14.53, segDurationSec: 7.26, startOffsetSec: 0.1, durationSec: 7.05 },
        { partIndex: 3, partTitle: "Part 4 (21.7-29.0s): 潛空間慣性無損延續", role: "小明", text: "很多工具常忽略鏡頭銜接的跳針問題。我們花時間把潛空間接力做進去，讓上一鏡的動能自然延續。", baseSec: 21.79, segDurationSec: 7.26, startOffsetSec: 0.2, durationSec: 6.95 },
        { partIndex: 4, partTitle: "Part 5 (29.0-36.3s): 角色錨點重置防漂移", role: "小明", text: "要是主角長相中途飄移了怎麼辦？系統提供首幀錨點隨時重置，鎖定髮型服裝，維持同一人。", baseSec: 29.06, segDurationSec: 7.26, startOffsetSec: 0.2, durationSec: 7.05 },
        { partIndex: 5, partTitle: "Part 6 (36.3-43.6s): 局部微調精修分鏡", role: "小明", text: "遇到手部變形或表情不對，不必整部重算。單擊九宮格對應畫格局部重抽，省下九成算力。", baseSec: 36.32, segDurationSec: 7.26, startOffsetSec: 0.1, durationSec: 6.95 },
        { partIndex: 6, partTitle: "Part 7 (43.6-50.8s): 原片聲紋呼吸感真聲音軌", role: "小明", text: "你聽，連呼吸聲和環境音都自然融入。每鏡段都保留原片三十二千赫茲真聲音軌，徹底擺脫機器味。", baseSec: 43.58, segDurationSec: 7.26, startOffsetSec: 0.2, durationSec: 6.95 },
        { partIndex: 7, partTitle: "Part 8 (50.8-58.1s): 步驟三：三大算力路線總覽", role: "小明", text: "來到步驟三算力調度，系統設計了三條不同路線，依照手邊設備與預算自由搭配。", baseSec: 50.85, segDurationSec: 7.26, startOffsetSec: 0.1, durationSec: 6.85 },
        { partIndex: 8, partTitle: "Part 9 (58.1-65.4s): 路線一：Apple Silicon 原生加速", role: "小明", text: "第一條是 Mac 專屬路線。多數開源專案對蘋果電腦支援有限，這裡特別原生優化，沒網路也能順暢跑。", baseSec: 58.11, segDurationSec: 7.26, startOffsetSec: 0.1, durationSec: 7.05 },
        { partIndex: 9, partTitle: "Part 10 (65.4-72.6s): 路線二：商用雲端極速直連", role: "小明", text: "第二條是商用雲端直連。填入密鑰就能呼叫高效能雲端主機，多個分鏡同時並行，幾分鐘內搞定。", baseSec: 65.38, segDurationSec: 7.26, startOffsetSec: 0.1, durationSec: 7.05 },
        { partIndex: 10, partTitle: "Part 11 (72.6-79.9s): 路線三：善用贈送算力低成本排程", role: "小明", text: "第三條是善用訂閱贈送的雲端算力，用很低成本就能調用頂級顯示卡，遇到忙碌還會自動降級保底。", baseSec: 72.64, segDurationSec: 7.26, startOffsetSec: 0.1, durationSec: 7.05 },
        { partIndex: 11, partTitle: "Part 12 (79.9-87.2s): 步驟四：自動音樂避讓與精確字幕", role: "小明", text: "最後步驟四不用再開剪輯軟體，系統會自動在人聲處壓低背景音樂，並生成精確對齊的字幕。", baseSec: 79.9, segDurationSec: 7.26, startOffsetSec: 0.1, durationSec: 7.05 },
        { partIndex: 12, partTitle: "Part 13 (87.2-94.4s): 一鍵導出完整長片", role: "小明", text: "MiniMax 雖然是開源模型，但在多鏡頭連貫上已經相當扎實好用。點擊一鍵匯出，快速打包成片。", baseSec: 87.17, segDurationSec: 7.26, startOffsetSec: 0.1, durationSec: 7.05 },
        { partIndex: 13, partTitle: "Part 14 (94.4-101.8s): 終章天亮順利交卷", role: "小明", text: "不知不覺天已經亮了，通宵趕完的期末報告順利搞定交卷！現在就打開 H3 試試看吧。", baseSec: 94.43, segDurationSec: 7.26, startOffsetSec: 0.1, durationSec: 7.05 },
      ],
      bgmStyle: "chill",
      bgmVolume: 30,
      audioDucking: true,
      softSubtitle: true,
      burnInSubtitle: false,
    };
  }
  if (templateKey === "ink_sorcerer") {
    const tpl = GOLDEN_TEMPLATES_FALLBACK.ink_sorcerer;
    return {
      id: "fc_ink_sorcerer_25s_demo",
      name: "🖌️ 墨繪靈境 25s 潛空間連貫示範專案",
      updatedAt: Date.now(),
      isDemo: true,
      activeProjectMode: "creative",
      chineseDesc: tpl.expanded_story_zh || tpl.title,
      speedMode: "quality",
      activeRoute: "colab",
      refImageDataUrl: tpl.demo_ref_image || "",
      refImageMime: "image/jpeg",
      gridImageDataUrl: "",
      slicedPanelsDataUrls: {},
      plan: JSON.parse(JSON.stringify(tpl)),
      playlist: JSON.parse(JSON.stringify(tpl.part_videos || [])),
      mergedVideoUrl: tpl.merged_video_path || "",
      segmentHistory: {},
      activeVersionIndex: {},
      dialogueItems: [],
      bgmStyle: "fantasy",
      bgmVolume: 35,
      audioDucking: true,
      softSubtitle: true,
      burnInSubtitle: false,
    };
  }
  const detectiveTpl = GOLDEN_TEMPLATES_FALLBACK.detective || DEMO_PROJECT_CONFIG.plan;
  return {
    id: "fc_detective_25s_demo",
    name: "🎬 賽博偵探 25s 電影級示範專案",
    updatedAt: Date.now(),
    isDemo: true,
    activeProjectMode: "creative",
    chineseDesc: DEMO_PROJECT_CONFIG.chinese_desc,
    speedMode: "quality",
    activeRoute: "colab",
    refImageDataUrl: DEMO_PROJECT_CONFIG.ref_image_path,
    refImageMime: "image/jpeg",
    gridImageDataUrl: DEMO_PROJECT_CONFIG.grid_image_path,
    slicedPanelsDataUrls: {},
    plan: JSON.parse(JSON.stringify(detectiveTpl)),
    playlist: JSON.parse(JSON.stringify(DEMO_PROJECT_CONFIG.part_videos)),
    mergedVideoUrl: DEMO_PROJECT_CONFIG.merged_video_path,
    segmentHistory: {},
    activeVersionIndex: {},
    dialogueItems: [],
    bgmStyle: "fantasy",
    bgmVolume: 35,
    audioDucking: true,
    softSubtitle: true,
    burnInSubtitle: false,
  };
}

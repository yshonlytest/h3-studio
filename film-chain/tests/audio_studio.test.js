const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const audioStudio = require('../public/src/core/audioStudio.js');

describe('H3 Storyboard Studio - Audio & Subtitle Studio Tests', () => {

  // ==================== 1. extractDialogueInfo ====================
  describe('extractDialogueInfo', () => {
    it('should extract dialogue from <d>[Chinese] tags and detect timeline offset', () => {
      const prompt = `Create a 5-second film.
Timeline:
0-1.5s (Panel 1): Dusk settles.
1.5-3.0s (Panel 2): Face close-up.
3.0-5.0s (Panel 3): Medium shot, Shisa stretches and speaks: <d>[Chinese] 坐太久活動一下</d>
Audio: city ambience, deep voice: <d>[Chinese] 坐太久活動一下</d>.`;

      const info = audioStudio.extractDialogueInfo(prompt, 0);
      assert.equal(info.text, "坐太久活動一下");
      assert.equal(info.startOffsetSec, 3.0);
      assert.equal(info.durationSec, 2.0);
    });

    it('should extract dialogue from quotes when <d> tag is missing', () => {
      const prompt = `傍晚廣場無人，風獅爺雙眼亮起金光甦醒，抬起雙爪伸展肩膀說「坐太久活動一下」。`;
      const info = audioStudio.extractDialogueInfo(prompt, 0);
      assert.equal(info.text, "坐太久活動一下");
      assert.equal(info.startOffsetSec, 1.5);
    });

    it('should return empty text when no dialogue exists', () => {
      const prompt = `Coherent magical motion, smooth juggling physics, realistic ceramic texture. No dialogue.`;
      const info = audioStudio.extractDialogueInfo(prompt, 1);
      assert.equal(info.text, "");
    });
  });

  // ==================== 2. formatTimecodeSrt & formatTimecodeVtt ====================
  describe('formatTimecode', () => {
    it('should format seconds into SRT timecodes with comma millisecond delimiter', () => {
      assert.equal(audioStudio.formatTimecodeSrt(0), '00:00:00,000');
      assert.equal(audioStudio.formatTimecodeSrt(2.5), '00:00:02,500');
      assert.equal(audioStudio.formatTimecodeSrt(65.123), '00:01:05,123');
      assert.equal(audioStudio.formatTimecodeSrt(3661.05), '01:01:01,050');
    });

    it('should format seconds into WebVTT timecodes with dot delimiter', () => {
      assert.equal(audioStudio.formatTimecodeVtt(2.5), '00:00:02.500');
      assert.equal(audioStudio.formatTimecodeVtt(70.8), '00:01:10.800');
    });
  });

  // ==================== 3. generateSrt ====================
  describe('generateSrt', () => {
    it('should generate standard multi-entry SRT format across multiple segments', () => {
      const items = [
        { partIndex: 0, text: "坐太久活動一下", startOffsetSec: 3.0, durationSec: 2.0 },
        { partIndex: 1, text: "", startOffsetSec: 1.5, durationSec: 2.5 }, // Empty part skipped
        { partIndex: 2, text: "回歸石像沉睡", startOffsetSec: 2.0, durationSec: 2.5 },
      ];

      const srt = audioStudio.generateSrt(items);
      const expected = 
`1
00:00:03,000 --> 00:00:05,000
坐太久活動一下

2
00:00:12,000 --> 00:00:14,500
回歸石像沉睡
`;
      assert.equal(srt.trim(), expected.trim());
    });
  });

  // ==================== 4. generateVtt ====================
  describe('generateVtt', () => {
    it('should output WEBVTT header and entries', () => {
      const items = [
        { partIndex: 0, text: "沖繩風獅爺甦醒", startOffsetSec: 1.0, durationSec: 2.5 }
      ];
      const vtt = audioStudio.generateVtt(items);
      assert.match(vtt, /^WEBVTT/);
      assert.match(vtt, /00:00:01\.000 --> 00:00:03\.500/);
      assert.match(vtt, /沖繩風獅爺甦醒/);
    });
  });

  // ==================== 5. calculateDuckingRanges ====================
  describe('calculateDuckingRanges', () => {
    it('should correctly calculate audio ducking time ranges with safety margins', () => {
      const dialogues = [
        { partIndex: 0, text: "哈囉", startOffsetSec: 2.0, durationSec: 2.0 }
      ];
      const ranges = audioStudio.calculateDuckingRanges(dialogues);
      assert.equal(ranges.length, 1);
      assert.equal(ranges[0].start, 1.8); // 2.0 - 0.2
      assert.equal(ranges[0].end, 4.3);   // 2.0 + 2.0 + 0.3
    });
  });

});

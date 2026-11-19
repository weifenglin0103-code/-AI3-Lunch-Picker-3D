// 執行：node --test meihua/tests/
const test = require("node:test");
const assert = require("node:assert");
const C = require("../js/core.js");
const D = require("../js/data-meihua.js");
const Z = require("../js/data-zhouyi.js");

test("取數：卦以八除、爻以六除，除盡取坤／上爻（p.13）", () => {
  assert.equal(C.mod8(8), 8); assert.equal(C.mod8(16), 8); assert.equal(C.mod8(9), 1);
  assert.equal(C.mod6(6), 6); assert.equal(C.mod6(12), 6); assert.equal(C.mod6(7), 1);
});

test("《梅花易數》〈觀梅占〉（p.32）：辰年十二月十七日申時 → 澤火革，初爻動，互乾巽，變咸", () => {
  const r = C.fromYMDH(5, 12, 17, 9);        // 辰=5、十二月、十七日、申=9
  assert.equal(r.upper, 2);                  // 34 ÷ 8 餘 2 → 兌
  assert.equal(r.lower, 3);                  // 43 ÷ 8 餘 3 → 離
  assert.equal(r.dong, 1);                   // 43 ÷ 6 餘 1 → 初爻
  const h = C.buildHexagram(r.upper, r.lower, r.dong);
  assert.equal(h.name.ben, "澤火革");
  assert.equal(h.hu.upper, 1);               // 互見乾
  assert.equal(h.hu.lower, 5);               // 互見巽
  assert.equal(h.name.bian, "澤山咸");       // 初爻變咸
  assert.equal(h.tiId, 2);                   // 動爻在下卦（離）→ 離為用，兌為體
  assert.equal(h.yongId, 3);
  const rel = C.relation(D.TRIGRAMS[h.tiId].elem, D.TRIGRAMS[h.yongId].elem);
  assert.equal(rel.key, "yongKe");           // 書：「兌金為體，離火克之」
});

test("64 卦編號唯一，且名稱與經文資料一致", () => {
  const seen = new Set();
  for (let u = 1; u <= 8; u++) for (let l = 1; l <= 8; l++) {
    const n = Z.HEX_NUM[u - 1][l - 1];
    assert.ok(n >= 1 && n <= 64); seen.add(n);
    assert.ok(Z.HEXAGRAMS[n - 1].full);
  }
  assert.equal(seen.size, 64);
});

test("每卦六爻的爻位名稱與陰陽（九／六）都與卦結構相符", () => {
  const POS = ["初", "二", "三", "四", "五", "上"];
  for (let u = 1; u <= 8; u++) for (let l = 1; l <= 8; l++) {
    const h = C.buildHexagram(u, l, 1);
    const info = Z.HEXAGRAMS[h.num.ben - 1];
    const six = info.yao.filter(y => y.pos !== "用九" && y.pos !== "用六");
    assert.equal(six.length, 6, info.full);
    six.forEach((y, k) => {
      const p = y.pos;
      const isYang = (k === 0 || k === 5) ? p[1] === "九" : p[0] === "九";
      const posOk = (k === 0 || k === 5) ? p[0] === POS[k] : p[1] === POS[k];
      assert.ok(posOk, info.full + " " + p);
      assert.equal(isYang, h.lines[k] === 1, info.full + " " + p);
      assert.ok(y.text && y.xiang, info.full + " " + p);
    });
  }
  assert.equal(Z.HEXAGRAMS.reduce((a, h) => a + h.yao.length, 0), 386); // 384 + 用九 + 用六
});

test("乾為天動上爻 → 澤天夬；乾坤純卦有旗標", () => {
  const h = C.buildHexagram(1, 1, 6);
  assert.equal(h.name.ben, "乾為天"); assert.equal(h.name.bian, "澤天夬"); assert.ok(h.pureQianKun);
  assert.ok(!C.buildHexagram(1, 2, 1).pureQianKun);
});

test("時辰地支：23–1 時子，11–13 時午", () => {
  assert.equal(C.branchOfHour(23), 1); assert.equal(C.branchOfHour(0), 1);
  assert.equal(C.branchOfHour(1), 2); assert.equal(C.branchOfHour(11), 7); assert.equal(C.branchOfHour(12), 7);
  assert.equal(C.branchOfHour(21), 12); assert.equal(C.branchOfHour(22), 12);
});

test("太陽黃經：2024 立春(315°)、春分(0°)、夏至(90°) 誤差 < 0.05°", () => {
  const d = (iso) => new Date(iso);
  const diff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  assert.ok(diff(C.sunLongitude(d("2024-02-04T16:27:00+08:00")), 315) < 0.05);
  assert.ok(diff(C.sunLongitude(d("2024-03-20T11:06:00+08:00")), 0) < 0.05);
  assert.ok(diff(C.sunLongitude(d("2024-06-21T04:51:00+08:00")), 90) < 0.05);
});

test("節氣月令：立春前為丑月、立春後為寅月；2026-11-19 為亥月（冬）", () => {
  assert.equal(C.monthContext(new Date("2024-02-04T16:00:00+08:00"), "solar").branch, "丑");
  assert.equal(C.monthContext(new Date("2024-02-04T17:00:00+08:00"), "solar").branch, "寅");
  const m = C.monthContext(new Date("2026-11-19T10:00:00+08:00"), "solar");
  assert.equal(m.branch, "亥"); assert.equal(m.season, "winter"); assert.equal(m.termName, "立冬");
});

test("農曆換算：2026-11-19 為丙午年十月十一；閏月可辨識", () => {
  const l = C.lunarInfo(new Date("2026-11-19T10:00:00+08:00"));
  assert.equal(l.month, 10); assert.equal(l.day, 11); assert.equal(l.ganzhi, "丙午"); assert.equal(l.yearBranchNum, 7);
  const leap = C.lunarInfo(new Date("2023-04-10T10:00:00+08:00")); // 2023 閏二月
  assert.equal(leap.isLeap, true); assert.equal(leap.month, 2);
});

test("農曆月令模式：正月建寅", () => {
  const m = C.monthContext(new Date("2026-11-19T10:00:00+08:00"), "lunar");
  assert.equal(m.branch, "亥"); // 農曆十月 → 亥
});

test("旺相休囚死表：每季五行各占一態，且旺者為當令", () => {
  Object.keys(D.WANGXIANG).forEach(s => {
    const st = Object.values(D.WANGXIANG[s]).sort().join("");
    assert.equal(st, ["旺", "相", "休", "囚", "死"].sort().join(""));
  });
  assert.equal(C.stateOf("木", "spring"), "旺"); assert.equal(C.stateOf("土", "spring"), "死");
});

test("八卦 × 六爻 × 五季節：分析不報錯，分數有限", () => {
  const when = new Date("2026-11-19T10:00:00+08:00");
  const seasons = Object.keys(D.WANGXIANG);
  for (let u = 1; u <= 8; u++) for (let l = 1; l <= 8; l++) for (let d = 1; d <= 6; d++) {
    const h = C.buildHexagram(u, l, d);
    seasons.forEach(s => {
      const a = C.analyze(h, { season: s, seasonName: D.SEASON_NAMES[s] });
      assert.ok(Number.isFinite(a.total)); assert.ok(a.level);
    });
  }
  assert.ok(when);
});

test("起卦：三數（總和／第三數）、物數占、手動", () => {
  const a = C.fromNumbers(12, 23, 35, "sum");   // 上 12%8=4 震、下 23%8=7 艮、動 70%6=4
  assert.equal(a.upper, 4); assert.equal(a.lower, 7); assert.equal(a.dong, 4);
  const b = C.fromNumbers(12, 23, 35, "third"); // 動 35%6=5
  assert.equal(b.dong, 5);
  const o = C.fromObject(8, new Date("2026-11-19T10:00:00+08:00")); // 巳時=6；上 坤(8)、下 6=坎、動 14%6=2
  assert.equal(o.upper, 8); assert.equal(o.lower, 6); assert.equal(o.dong, 2);
  assert.equal(C.fromManual(1, 2, 3).dong, 3);
});

test("fromDate 與 cast 端到端", () => {
  const when = new Date("2026-11-19T10:00:00+08:00"); // 丙午年(7) 十月十一 巳時(6)
  const r = C.fromDate(when);
  assert.equal(r.input.y, 7); assert.equal(r.input.m, 10); assert.equal(r.input.d, 11); assert.equal(r.input.h, 6);
  assert.equal(r.upper, C.mod8(28)); assert.equal(r.lower, C.mod8(34)); assert.equal(r.dong, C.mod6(34));
  const c = C.cast(r, when, "solar");
  assert.ok(c.analysis.level); assert.equal(c.month.branch, "亥");
});

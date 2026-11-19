/* 梅花易數核心演算法（純函式，瀏覽器與 Node 通用） */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./data-meihua.js"), require("./data-zhouyi.js"));
  } else {
    root.MeihuaCore = factory(root.MeihuaData, root.ZhouyiData);
  }
})(this, function (D, Z) {
  var T = D.TRIGRAMS;
  var TZ = "Asia/Taipei"; // 時間起卦一律以臺北時間（UTC+8）計算

  // ---------- 基本取數（p.13）----------
  function mod8(n) { var r = n % 8; return r === 0 ? 8 : r; }   // 卦以八除，除盡取坤(8)
  function mod6(n) { var r = n % 6; return r === 0 ? 6 : r; }   // 爻以六除，除盡取上爻(6)

  function findTrigram(bin) {
    for (var id = 1; id <= 8; id++) {
      var b = T[id].bin;
      if (b[0] === bin[0] && b[1] === bin[1] && b[2] === bin[2]) return id;
    }
    throw new Error("找不到對應的八卦");
  }

  // ---------- 五行關係 ----------
  function relation(tiElem, otherElem) {
    var R = D.RELATIONS;
    if (tiElem === otherElem) return R.bihe;
    if (D.SHENG[otherElem] === tiElem) return R.yongSheng;
    if (D.KE[tiElem] === otherElem) return R.tiKe;
    if (D.SHENG[tiElem] === otherElem) return R.tiSheng;
    return R.yongKe; // D.KE[otherElem] === tiElem
  }

  // ---------- 建卦：由 上卦、下卦、動爻 求本卦、互卦、變卦、體用 ----------
  function buildHexagram(upper, lower, dong) {
    var lines = T[lower].bin.concat(T[upper].bin); // 由下而上
    var huLower = findTrigram([lines[1], lines[2], lines[3]]); // 下互：2、3、4 爻（p.14）
    var huUpper = findTrigram([lines[2], lines[3], lines[4]]); // 上互：3、4、5 爻
    var bianLines = lines.slice();
    bianLines[dong - 1] = bianLines[dong - 1] === 1 ? 0 : 1;   // 動爻陰陽互變（p.13）
    var bianLower = findTrigram(bianLines.slice(0, 3));
    var bianUpper = findTrigram(bianLines.slice(3, 6));
    var dongInLower = dong <= 3;                               // 動爻所在之卦為用，另一卦為體
    var num = function (u, l) { return Z.HEX_NUM[u - 1][l - 1]; };
    var hexInfo = function (n) { return Z.HEXAGRAMS[n - 1]; };
    var h = {
      upper: upper, lower: lower, dong: dong, lines: lines,
      hu: { upper: huUpper, lower: huLower, lines: T[huLower].bin.concat(T[huUpper].bin) },
      bian: { upper: bianUpper, lower: bianLower, lines: bianLines },
      dongInLower: dongInLower,
      tiId: dongInLower ? upper : lower,
      yongId: dongInLower ? lower : upper,
      // 體互：與體同一側的互卦；用互：另一側（p.145）
      huTiId: dongInLower ? huUpper : huLower,
      huYongId: dongInLower ? huLower : huUpper,
      bianYongId: dongInLower ? bianLower : bianUpper, // 動爻一側之卦，變後即「變卦之用」
      num: { ben: num(upper, lower), hu: num(huUpper, huLower), bian: num(bianUpper, bianLower) }
    };
    h.name = { ben: hexInfo(h.num.ben).full, hu: hexInfo(h.num.hu).full, bian: hexInfo(h.num.bian).full };
    h.pureQianKun = (upper === lower && (upper === 1 || upper === 8)); // 乾為天、坤為地（p.14 另有「乾坤無互」之說）
    return h;
  }

  // ---------- 時辰、農曆 ----------
  function branchOfHour(hour) { return Math.floor((hour + 1) / 2) % 12 + 1; } // 23-0 時為子(1)…21-22 時為亥(12)

  function zonedParts(date) {
    var f = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric"
    });
    var o = {};
    f.formatToParts(date).forEach(function (p) { o[p.type] = parseInt(p.value, 10); });
    return o;
  }

  function lunarInfo(date) {
    var f = new Intl.DateTimeFormat("en-u-ca-chinese", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric" });
    var raw = {};
    f.formatToParts(date).forEach(function (p) { raw[p.type] = p.value; });
    var ry = parseInt(raw.relatedYear, 10);
    return {
      year: ry, month: parseInt(raw.month, 10), day: parseInt(raw.day, 10),
      isLeap: /bis|閏|leap/i.test(raw.month),
      yearBranchNum: ((ry - 4) % 12 + 12) % 12 + 1, // 子=1…亥=12（p.14）
      ganzhi: D.STEMS[((ry - 4) % 10 + 10) % 10] + D.BRANCHES[((ry - 4) % 12 + 12) % 12]
    };
  }

  // ---------- 節氣月令（太陽視黃經，低精度公式，誤差約 0.01° ≈ 15 分鐘）----------
  function sunLongitude(date) {
    var jd = date.getTime() / 86400000 + 2440587.5;
    var n = jd - 2451545.0;
    var L = (280.460 + 0.9856474 * n) % 360;
    var g = ((357.528 + 0.9856003 * n) % 360) * Math.PI / 180;
    var lam = L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g);
    return ((lam % 360) + 360) % 360;
  }

  function solarMonth(date) {
    var lam = sunLongitude(date);
    var rel = (((lam - 315) % 360) + 360) % 360;
    var idx = Math.floor(rel / 30);
    var into = rel - 30 * idx;
    var perDay = 0.9856;
    return {
      mode: "solar", branchIdx: D.MONTH_BRANCH_IDX[idx], termName: D.TERMS[idx], longitude: lam,
      daysSince: into / perDay, daysUntil: (30 - into) / perDay,
      nearBoundary: into / perDay < 1.5 || (30 - into) / perDay < 1.5
    };
  }

  function lunarMonthBranch(lunar) { // 正月建寅：農曆 m 月 → 地支索引
    return { mode: "lunar", branchIdx: (lunar.month + 1) % 12, termName: "農曆" + lunar.month + "月", nearBoundary: false };
  }

  function seasonOfBranchIdx(i) {
    var b = D.BRANCHES[i];
    if (b === "寅" || b === "卯") return "spring";
    if (b === "巳" || b === "午") return "summer";
    if (b === "申" || b === "酉") return "autumn";
    if (b === "亥" || b === "子") return "winter";
    return "earth"; // 辰未戌丑
  }

  // 月令資訊：mode = "solar"（節氣）或 "lunar"（農曆月）
  function monthContext(date, mode) {
    var lunar = lunarInfo(date);
    var m = mode === "lunar" ? lunarMonthBranch(lunar) : solarMonth(date);
    m.branch = D.BRANCHES[m.branchIdx];
    m.season = seasonOfBranchIdx(m.branchIdx);
    m.seasonName = D.SEASON_NAMES[m.season];
    return m;
  }

  function stateOf(elem, season) { return D.WANGXIANG[season][elem]; }

  // ---------- 起卦方法：都回傳 { upper, lower, dong, steps[], method, input } ----------
  function fromNumbers(n1, n2, n3, dongMode) {
    var upper = mod8(n1), lower = mod8(n2);
    var total = dongMode === "third" ? n3 : n1 + n2 + n3;
    var dong = mod6(total);
    return {
      method: "number", upper: upper, lower: lower, dong: dong, input: { n1: n1, n2: n2, n3: n3, dongMode: dongMode },
      steps: [
        "第一數 " + n1 + " ÷ 8 餘 " + (n1 % 8) + " → 上卦 " + T[upper].name + "（" + upper + "）",
        "第二數 " + n2 + " ÷ 8 餘 " + (n2 % 8) + " → 下卦 " + T[lower].name + "（" + lower + "）",
        dongMode === "third"
          ? "第三數 " + n3 + " ÷ 6 餘 " + (n3 % 6) + " → 動爻 第 " + dong + " 爻"
          : "總數 " + n1 + "+" + n2 + "+" + n3 + " = " + total + " ÷ 6 餘 " + (total % 6) + " → 動爻 第 " + dong + " 爻（書：以重卦總數除六，p.13）"
      ]
    };
  }

  // 年月日時起例（p.14）：年月日數為上卦；加時數為下卦；年月日時總數除六取動爻
  function fromYMDH(y, m, d, h, extra) {
    var s3 = y + m + d, s4 = s3 + h;
    var upper = mod8(s3), lower = mod8(s4), dong = mod6(s4);
    return {
      method: "time", upper: upper, lower: lower, dong: dong, input: Object.assign({ y: y, m: m, d: d, h: h }, extra || {}),
      steps: [
        "年數 " + y + "（地支序）＋ 月數 " + m + " ＋ 日數 " + d + " ＝ " + s3 + " ÷ 8 餘 " + (s3 % 8) + " → 上卦 " + T[upper].name,
        "加時辰數 " + h + " ＝ " + s4 + " ÷ 8 餘 " + (s4 % 8) + " → 下卦 " + T[lower].name,
        "總數 " + s4 + " ÷ 6 餘 " + (s4 % 6) + " → 動爻 第 " + dong + " 爻"
      ]
    };
  }

  function fromDate(date) {
    var lunar = lunarInfo(date);
    var hp = zonedParts(date);
    var hb = branchOfHour(hp.hour);
    var r = fromYMDH(lunar.yearBranchNum, lunar.month, lunar.day, hb, { whenISO: date.toISOString() });
    r.lunar = lunar; r.hourBranchNum = hb; r.hourBranch = D.BRANCHES[hb - 1];
    r.steps.unshift("臺北時間 " + hp.year + "-" + pad(hp.month) + "-" + pad(hp.day) + " " + pad(hp.hour) + ":" + pad(hp.minute) +
      " ＝ 農曆" + lunar.ganzhi + "年" + (lunar.isLeap ? "閏" : "") + lunar.month + "月" + lunar.day + "日 " + r.hourBranch + "時" +
      "（年支序 " + lunar.yearBranchNum + "、時辰數 " + hb + "）");
    return r;
  }

  // 物數占／聲音占（p.15）：物數（或聲數）為上卦，時辰數為下卦；總數除六取動爻
  function fromObject(n, date) {
    var hp = zonedParts(date), hb = branchOfHour(hp.hour);
    var upper = mod8(n), lower = mod8(hb), dong = mod6(n + hb);
    return {
      method: "object", upper: upper, lower: lower, dong: dong, input: { n: n, hourBranchNum: hb, whenISO: date.toISOString() },
      hourBranchNum: hb, hourBranch: D.BRANCHES[hb - 1],
      steps: [
        "物數／聲數 " + n + " ÷ 8 餘 " + (n % 8) + " → 上卦 " + T[upper].name,
        "時辰 " + D.BRANCHES[hb - 1] + "（數 " + hb + "）÷ 8 餘 " + (hb % 8) + " → 下卦 " + T[lower].name,
        "總數 " + n + "+" + hb + " ＝ " + (n + hb) + " ÷ 6 餘 " + ((n + hb) % 6) + " → 動爻 第 " + dong + " 爻"
      ]
    };
  }

  function fromManual(upper, lower, dong) {
    return {
      method: "manual", upper: upper, lower: lower, dong: dong, input: { upper: upper, lower: lower, dong: dong },
      steps: ["手動指定：上卦 " + T[upper].name + "、下卦 " + T[lower].name + "、動爻第 " + dong + " 爻"]
    };
  }

  function randomInt(maxInclusive) {
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      var a = new Uint32Array(1); crypto.getRandomValues(a); return (a[0] % maxInclusive) + 1;
    }
    return Math.floor(Math.random() * maxInclusive) + 1;
  }

  // ---------- 體用斷語（本程式的簡化評分；規則依據 p.74-78, 127, 145, 148）----------
  var LEVELS = [
    [4, "大吉"], [2, "吉"], [0.5, "小吉"], [-0.5, "平"], [-2, "小凶"], [-4, "凶"], [-Infinity, "大凶"]
  ];
  function levelOf(score) {
    for (var i = 0; i < LEVELS.length; i++) if (score >= LEVELS[i][0]) return LEVELS[i][1];
    return "大凶";
  }

  function analyze(h, month) {
    var ti = T[h.tiId], yong = T[h.yongId];
    var season = month.season;
    var items = [];
    function add(role, tid, weight) {
      var t = T[tid], rel = relation(ti.elem, t.elem), st = stateOf(t.elem, season);
      items.push({ role: role, trigram: t, rel: rel, weight: weight, score: rel.score * weight, state: st });
    }
    add("用卦", h.yongId, 1);
    add("體互", h.huTiId, 1);       // 體互最緊（p.145）
    add("用互", h.huYongId, 0.5);   // 用互次之
    add("變卦", h.bianYongId, 1);   // 變為事之終（p.145）

    var tiState = stateOf(ti.elem, season);
    var parts = [{ label: "體卦 " + ti.name + "（" + ti.elem + "）在" + month.seasonName + "月令為「" + tiState + "」（體宜乘旺，p.148）",
                   score: D.STATE_SCORE[tiState] }];
    items.forEach(function (it) {
      parts.push({ label: it.role + " " + it.trigram.name + "（" + it.trigram.elem + "）：" + it.rel.label + (it.weight !== 1 ? "（權重 " + it.weight + "）" : ""),
                   score: it.score });
      if (it.rel.key === "yongKe" && it.state === "旺")
        parts.push({ label: it.role + " 剋體且氣旺（克體之卦宜衰，p.148）", score: -1 });
      if (it.rel.key === "yongSheng" && it.state === "旺")
        parts.push({ label: it.role + " 生體且氣旺", score: 0.5 });
    });
    var total = parts.reduce(function (a, p) { return a + p.score; }, 0);

    // 先後之應（p.75）：用吉變凶先吉後凶；用凶變吉先凶後吉
    var yongGood = items[0].rel.score > 0, bianGood = items[3].rel.score > 0;
    var process = null;
    if (items[0].rel.score !== items[3].rel.score || yongGood !== bianGood) {
      if (yongGood && !bianGood) process = "用卦吉而變卦不利：先吉後凶，收尾宜謹慎。";
      else if (!yongGood && bianGood) process = "用卦不利而變卦轉吉：先凶後吉，先難後易。";
    }

    // 象意提示：列出生體／剋體之卦所主（p.75-76）
    var hints = [];
    items.forEach(function (it) {
      if (it.rel.key === "yongSheng") hints.push({ role: it.role, trigram: it.trigram, kind: "生體", text: D.SHENG_TI[it.trigram.id] });
      if (it.rel.key === "yongKe") hints.push({ role: it.role, trigram: it.trigram, kind: "剋體", text: D.KE_TI[it.trigram.id] });
    });

    // 應期參考（p.148）：生體、比和之五行當令月為吉期；剋體之五行當令月為凶期
    var helpElems = [ti.elem], hurtElems = [];
    Object.keys(D.SHENG).forEach(function (e) { if (D.SHENG[e] === ti.elem) helpElems.push(e); });
    Object.keys(D.KE).forEach(function (e) { if (D.KE[e] === ti.elem) hurtElems.push(e); });
    var months = function (els) { return els.map(function (e) { return e + "旺（" + D.ELEM_MONTHS[e].join("、") + "月）"; }); };

    return {
      ti: ti, yong: yong, tiState: tiState, items: items, parts: parts,
      total: total, level: levelOf(total), process: process, hints: hints,
      timing: { good: months(helpElems), bad: months(hurtElems) },
      note: h.pureQianKun ? "乾、坤純卦的互卦與本卦相同；原書另有「乾坤無互，互其變卦」之說（p.14），此處保留計算結果。" : null
    };
  }

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  // ---------- 一次完成：起卦結果 + 建卦 + 月令 + 分析 ----------
  function cast(divination, whenDate, monthMode) {
    var h = buildHexagram(divination.upper, divination.lower, divination.dong);
    var month = monthContext(whenDate, monthMode || "solar");
    var a = analyze(h, month);
    return { divination: divination, hexagram: h, month: month, analysis: a, when: whenDate };
  }

  return {
    mod8: mod8, mod6: mod6, findTrigram: findTrigram, relation: relation, buildHexagram: buildHexagram,
    branchOfHour: branchOfHour, zonedParts: zonedParts, lunarInfo: lunarInfo, sunLongitude: sunLongitude,
    solarMonth: solarMonth, monthContext: monthContext, seasonOfBranchIdx: seasonOfBranchIdx, stateOf: stateOf,
    fromNumbers: fromNumbers, fromYMDH: fromYMDH, fromDate: fromDate, fromObject: fromObject, fromManual: fromManual,
    randomInt: randomInt, analyze: analyze, levelOf: levelOf, cast: cast, TZ: TZ
  };
});

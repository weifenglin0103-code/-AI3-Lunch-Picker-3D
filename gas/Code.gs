/**
 * 煎記 JIAN — 線上訂單 → Google Sheet 後端（Google Apps Script）
 *
 * 使用方式（詳見 docs/GAS-SETUP.md）：
 *  1. 建立一份 Google 試算表 → 擴充功能 → Apps Script，貼上本檔與 appsscript.json
 *  2. 執行一次 setup()：自動建立「菜單」「訂單」「訂單明細」三張工作表並填入預設菜單
 *  3. 部署 → 新增部署作業 → 網頁應用程式（執行身分：我；存取權：所有人），複製 /exec 網址
 *  4. 把網址貼到 index.html 的 GAS_ENDPOINT
 *
 * 設計重點：
 *  - 金額一律由伺服器依「菜單」工作表重新計算，不信任前端傳來的價格
 *  - 訂單編號由前端產生、後端去重（冪等），斷線重送不會產生重複訂單
 *  - LockService 防止同時下單時寫入錯亂
 *  - 寫入前處理「公式注入」（以 = + - @ 開頭的文字）
 */

/* ===================== 設定 ===================== */
var CONFIG = {
  TIMEZONE: 'Asia/Taipei',
  SHIPPING_FEE: 160,        // 宅配運費（需與前端一致）
  FREE_SHIPPING: 1500,      // 滿額免運
  OWNER_EMAIL: '',          // 店家通知信箱；留空則使用「試算表擁有者」
  SEND_CUSTOMER_EMAIL: true,// 顧客有填 Email 時寄送訂單確認信
  SHOP_NAME: '煎記 JIAN・手作鍋貼專賣'
};

var SHEETS = { MENU: '菜單', ORDERS: '訂單', ITEMS: '訂單明細' };
var STATUS_LIST = ['新訂單', '製作中', '可取餐', '已完成', '已取消'];
var TYPE_LABEL = { dinein: '內用', takeout: '外帶', delivery: '宅配' };
var STORE_NAME = {
  flagship: '大安旗艦店', xinyi: '信義店', banqiao: '板橋店', taichung: '台中勤美店'
};

var ORDER_HEADERS = ['訂單編號', '建立時間', '狀態', '取餐方式', '門市', '取餐時間', '姓名', '電話', 'Email',
                     '地址', '備註', '小計', '運費', '總額', '品項摘要'];
var ITEM_HEADERS = ['訂單編號', '品項代碼', '品名', '單價', '數量', '小計'];
var MENU_HEADERS = ['代碼', '分類', '品名', '單位', '單價', '上架'];

var DEFAULT_MENU = [
  ['p01', '招牌鍋貼', '招牌高麗菜鍋貼', '10 顆', 80, true],
  ['p02', '招牌鍋貼', '韭黃鮮蝦鍋貼', '10 顆', 120, true],
  ['p03', '招牌鍋貼', '麻辣花椒鍋貼', '10 顆', 95, true],
  ['p04', '招牌鍋貼', '玉米起司鍋貼', '10 顆', 90, true],
  ['d01', '精選水餃', '經典高麗菜水餃', '10 顆', 75, true],
  ['d02', '精選水餃', '鮮蝦三鮮水餃', '10 顆', 110, true],
  ['d03', '精選水餃', '酸菜白肉水餃', '10 顆', 80, true],
  ['d04', '精選水餃', '紅油抄手', '8 顆', 85, true],
  ['c01', '湯品/飲料', '招牌酸辣湯', '碗', 45, true],
  ['c02', '湯品/飲料', '玉米蛋花湯', '碗', 40, true],
  ['c03', '湯品/飲料', '古早味豆漿', '杯', 30, true],
  ['c04', '湯品/飲料', '手熬冬瓜茶', '杯', 30, true],
  ['s01', '經典小菜', '蒜香燙青菜', '份', 40, true],
  ['s02', '經典小菜', '皮蛋豆腐', '份', 45, true],
  ['s03', '經典小菜', '滷味拼盤', '份', 60, true],
  ['s04', '經典小菜', '涼拌小黃瓜', '份', 35, true],
  ['g01', '冷凍禮盒', '招牌招財鍋貼禮盒', '50 入', 680, true],
  ['g02', '冷凍禮盒', '闔家團圓水餃組', '100 入', 899, true],
  ['g03', '冷凍禮盒', '節慶雙享伴手禮盒', '80 入', 1280, true]
];

/* ===================== 網頁應用程式入口 ===================== */

/** 接收前端送出的訂單（Content-Type: text/plain 的 JSON，避免 CORS 預檢） */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    if (!e || !e.postData || !e.postData.contents) return json_({ ok: false, code: 'BAD_REQUEST', message: '沒有收到資料' });
    var data;
    try { data = JSON.parse(e.postData.contents); }
    catch (err) { return json_({ ok: false, code: 'BAD_REQUEST', message: '資料格式錯誤' }); }

    // 蜜罐欄位：機器人才會填，假裝成功但不寫入
    if (data.website) return json_({ ok: true, orderId: 'JN000000-0000', total: 0 });

    lock.waitLock(20000);
    var result = createOrder_(data);
    lock.releaseLock();

    if (result.ok && !result.duplicate) {
      try { notify_(result.order); } catch (mailErr) { console.error('寄信失敗：' + mailErr); }
    }
    delete result.order;
    return json_(result);
  } catch (err) {
    try { lock.releaseLock(); } catch (x) {}
    console.error(err && err.stack || err);
    return json_({ ok: false, code: 'SERVER_ERROR', message: '系統忙碌中，請稍後再試' });
  }
}

/** 健康檢查與菜單查詢：?action=menu 回傳目前上架品項（可用來做「已售完」標示） */
function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === 'menu') {
    var menu = readMenu_();
    return json_({ ok: true, menu: Object.keys(menu).map(function (id) {
      return { id: id, name: menu[id].name, price: menu[id].price, enabled: menu[id].enabled };
    }) });
  }
  return json_({ ok: true, service: 'jian-orders', time: now_() });
}

/* ===================== 訂單處理 ===================== */

function createOrder_(data) {
  var type = String(data.type || '');
  if (!TYPE_LABEL[type]) return fail_('INVALID', '取餐方式不正確');

  var name = clean_(data.name, 40);
  var phone = String(data.phone || '').replace(/[\s-]/g, '');
  var email = clean_(data.email, 100);
  var address = clean_(data.address, 120);
  var note = clean_(data.note, 300);
  var store = String(data.store || '');
  var time = clean_(data.time, 10);

  if (!name) return fail_('INVALID', '請填寫姓名');
  if (!/^09\d{8}$/.test(phone)) return fail_('INVALID', '手機號碼格式不正確');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail_('INVALID', 'Email 格式不正確');
  if (type === 'delivery') {
    if (address.length < 6) return fail_('INVALID', '請填寫完整配送地址');
  } else {
    if (!STORE_NAME[store]) return fail_('INVALID', '門市不正確');
    if (time !== 'asap' && !/^\d{2}:\d{2}$/.test(time)) return fail_('INVALID', '取餐時間不正確');
  }

  // 品項：合併重複、限制數量，並以菜單工作表重新計價
  var items = Array.isArray(data.items) ? data.items : [];
  if (!items.length || items.length > 30) return fail_('INVALID', '購物車內容不正確');
  var menu = readMenu_();
  var merged = {};
  for (var i = 0; i < items.length; i++) {
    var id = String(items[i] && items[i].id || '');
    var qty = Math.floor(Number(items[i] && items[i].qty));
    if (!menu[id]) return fail_('INVALID_ITEM', '有品項已下架或不存在，請重新整理後再試');
    if (!menu[id].enabled) return fail_('SOLD_OUT', '「' + menu[id].name + '」目前暫停供應');
    if (!(qty >= 1 && qty <= 99)) return fail_('INVALID', '品項數量不正確');
    merged[id] = Math.min(99, (merged[id] || 0) + qty);
  }

  var subtotal = 0, lines = [];
  Object.keys(merged).forEach(function (id) {
    var m = menu[id], q = merged[id], line = m.price * q;
    subtotal += line;
    lines.push([null, id, m.name, m.price, q, line]);
  });
  var shipping = (type === 'delivery' && subtotal < CONFIG.FREE_SHIPPING) ? CONFIG.SHIPPING_FEE : 0;
  var total = subtotal + shipping;

  // 訂單編號：沿用前端產生的（支援斷線重送），格式不符才由伺服器產生
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var orderSheet = sheet_(ss, SHEETS.ORDERS), itemSheet = sheet_(ss, SHEETS.ITEMS);
  var orderId = String(data.orderId || '');
  if (!/^JN\d{6}-\d{4}$/.test(orderId)) orderId = newOrderId_(orderSheet);

  var found = findOrderRow_(orderSheet, orderId);
  if (found) {                                   // 重複送單 → 直接回傳既有結果
    var row = orderSheet.getRange(found, 1, 1, ORDER_HEADERS.length).getValues()[0];
    return { ok: true, duplicate: true, orderId: orderId, subtotal: row[11], shipping: row[12], total: row[13] };
  }

  var summary = lines.map(function (l) { return l[2] + '×' + l[4]; }).join('、');
  var createdAt = now_();
  var storeName = type === 'delivery' ? '' : STORE_NAME[store];
  var pickup = type === 'delivery' ? '' : (time === 'asap' ? '越快越好' : time);

  orderSheet.appendRow([
    orderId, createdAt, '新訂單', TYPE_LABEL[type], storeName, pickup, safe_(name), phone, safe_(email),
    safe_(address), safe_(note), subtotal, shipping, total, summary
  ]);
  var detail = lines.map(function (l) { l[0] = orderId; return l; });
  itemSheet.getRange(itemSheet.getLastRow() + 1, 1, detail.length, ITEM_HEADERS.length).setValues(detail);
  SpreadsheetApp.flush();

  return {
    ok: true, orderId: orderId, subtotal: subtotal, shipping: shipping, total: total,
    order: { id: orderId, createdAt: createdAt, typeLabel: TYPE_LABEL[type], store: storeName, pickup: pickup,
             name: name, phone: phone, email: email, address: address, note: note,
             lines: lines, subtotal: subtotal, shipping: shipping, total: total }
  };
}

/* ===================== 通知信 ===================== */

function notify_(o) {
  var owner = CONFIG.OWNER_EMAIL || SpreadsheetApp.getActiveSpreadsheet().getOwner().getEmail();
  var body = orderText_(o);
  MailApp.sendEmail({
    to: owner,
    subject: '【新訂單】' + o.id + '｜' + o.typeLabel + '｜NT$' + o.total,
    body: body + '\n\n試算表：' + SpreadsheetApp.getActiveSpreadsheet().getUrl()
  });
  if (CONFIG.SEND_CUSTOMER_EMAIL && o.email) {
    MailApp.sendEmail({
      to: o.email,
      name: CONFIG.SHOP_NAME,
      subject: '【' + CONFIG.SHOP_NAME + '】訂單確認 ' + o.id,
      body: o.name + ' 您好，\n感謝您的訂購！以下是您的訂單明細：\n\n' + body + '\n\n如有任何問題，歡迎來電洽詢門市。'
    });
  }
}

function orderText_(o) {
  var rows = o.lines.map(function (l) { return '  ' + l[2] + ' × ' + l[4] + '　NT$' + l[5]; }).join('\n');
  return [
    '訂單編號：' + o.id,
    '下單時間：' + o.createdAt,
    '取餐方式：' + o.typeLabel + (o.store ? '（' + o.store + '・' + o.pickup + '）' : ''),
    o.address ? '配送地址：' + o.address : '',
    '姓名／電話：' + o.name + ' / ' + o.phone,
    o.note ? '備註：' + o.note : '',
    '', '品項：', rows, '',
    '小計：NT$' + o.subtotal + (o.shipping ? '　運費：NT$' + o.shipping : ''),
    '總額：NT$' + o.total
  ].filter(function (s, i, a) { return s !== '' || (a[i - 1] !== ''); }).join('\n');
}

/* ===================== 初始化與自動化 ===================== */

/** 第一次使用請手動執行：建立工作表、標題列、狀態下拉選單、預設菜單 */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var menu = sheet_(ss, SHEETS.MENU, true);
  if (menu.getLastRow() < 1) {
    menu.getRange(1, 1, 1, MENU_HEADERS.length).setValues([MENU_HEADERS]);
    menu.getRange(2, 1, DEFAULT_MENU.length, MENU_HEADERS.length).setValues(DEFAULT_MENU);
    menu.getRange(2, 6, DEFAULT_MENU.length, 1).insertCheckboxes();
  }
  style_(menu, MENU_HEADERS.length);

  var orders = sheet_(ss, SHEETS.ORDERS, true);
  if (orders.getLastRow() < 1) orders.getRange(1, 1, 1, ORDER_HEADERS.length).setValues([ORDER_HEADERS]);
  style_(orders, ORDER_HEADERS.length);
  orders.getRange(2, 3, 1000, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(STATUS_LIST, true).setAllowInvalid(false).build());
  orders.getRange('H:H').setNumberFormat('@');
  orders.setConditionalFormatRules([
    rule_('新訂單', '#fde7d3'), rule_('製作中', '#fff4c2'), rule_('可取餐', '#d5f0dc'),
    rule_('已完成', '#e6e6e6'), rule_('已取消', '#f6d3d3')
  ]);

  var items = sheet_(ss, SHEETS.ITEMS, true);
  if (items.getLastRow() < 1) items.getRange(1, 1, 1, ITEM_HEADERS.length).setValues([ITEM_HEADERS]);
  style_(items, ITEM_HEADERS.length);

  var def = ss.getSheetByName('工作表1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);
  SpreadsheetApp.getUi().alert('初始化完成！請接著「部署 → 新增部署作業 → 網頁應用程式」。');
}

/** 試算表開啟時加入自訂選單 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('煎記工具')
    .addItem('初始化工作表', 'setup')
    .addItem('安裝每日營收彙整（21:30）', 'installTriggers')
    .addItem('立即寄出今日彙整', 'dailySummary')
    .addToUi();
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailySummary') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailySummary').timeBased().everyDays(1).atHour(21).nearMinute(30).inTimezone(CONFIG.TIMEZONE).create();
  SpreadsheetApp.getUi().alert('已安裝：每天 21:30 寄出當日訂單彙整。');
}

/** 每日彙整：當日有效訂單數、營收、各取餐方式與熱銷品項 */
function dailySummary() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
  var orders = sheet_(ss, SHEETS.ORDERS).getDataRange().getValues().slice(1).filter(function (r) {
    return String(r[1]).slice(0, 10) === today && r[2] !== '已取消';
  });
  var ids = {}; orders.forEach(function (r) { ids[r[0]] = true; });
  var sold = {};
  sheet_(ss, SHEETS.ITEMS).getDataRange().getValues().slice(1).forEach(function (r) {
    if (ids[r[0]]) sold[r[2]] = (sold[r[2]] || 0) + Number(r[4]);
  });
  var byType = {}, revenue = 0;
  orders.forEach(function (r) { byType[r[3]] = (byType[r[3]] || 0) + 1; revenue += Number(r[13]); });
  var top = Object.keys(sold).sort(function (a, b) { return sold[b] - sold[a]; }).slice(0, 5)
    .map(function (k, i) { return (i + 1) + '. ' + k + ' × ' + sold[k]; }).join('\n');
  var owner = CONFIG.OWNER_EMAIL || ss.getOwner().getEmail();
  MailApp.sendEmail(owner, '【每日彙整】' + today + '｜' + orders.length + ' 筆・NT$' + revenue,
    '日期：' + today + '\n有效訂單：' + orders.length + ' 筆\n營收：NT$' + revenue + '\n' +
    Object.keys(byType).map(function (k) { return k + '：' + byType[k] + ' 筆'; }).join('　') +
    '\n\n熱銷品項：\n' + (top || '（今日尚無訂單）'));
}

/* ===================== 工具函式 ===================== */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function fail_(code, message) { return { ok: false, code: code, message: message }; }
function now_() { return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss'); }

function clean_(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max); }
/** 防止試算表公式注入：以 = + - @ 開頭的文字前面加單引號 */
function safe_(s) { return /^[=+\-@]/.test(s) ? "'" + s : s; }

function sheet_(ss, name, create) {
  var sh = ss.getSheetByName(name);
  if (!sh && create) sh = ss.insertSheet(name);
  if (!sh) throw new Error('找不到工作表「' + name + '」，請先執行 setup()');
  return sh;
}

function readMenu_() {
  var sh = sheet_(SpreadsheetApp.getActiveSpreadsheet(), SHEETS.MENU);
  var map = {};
  sh.getDataRange().getValues().slice(1).forEach(function (r) {
    if (!r[0]) return;
    map[String(r[0]).trim()] = { name: String(r[2]), price: Number(r[4]) || 0, enabled: r[5] === true || String(r[5]).toUpperCase() === 'TRUE' };
  });
  return map;
}

function findOrderRow_(sh, orderId) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (ids[i][0] === orderId) return i + 2;
  return 0;
}

function newOrderId_(sh) {
  var d = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyMMdd');
  for (var n = 0; n < 50; n++) {
    var id = 'JN' + d + '-' + Math.floor(1000 + Math.random() * 9000);
    if (!findOrderRow_(sh, id)) return id;
  }
  return 'JN' + d + '-' + new Date().getTime() % 10000;
}

function style_(sh, cols) {
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, cols).setFontWeight('bold').setBackground('#3a2213').setFontColor('#ffffff');
  sh.autoResizeColumns(1, cols);
}
function rule_(text, color) {
  return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(text).setBackground(color)
    .setRanges([SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.ORDERS).getRange('C2:C1001')]).build();
}

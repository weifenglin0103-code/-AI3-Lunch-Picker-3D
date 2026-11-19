# 梅花易數排盤

純前端、無需建置。直接用瀏覽器開啟 `index.html` 即可使用（雙擊或放到任何靜態空間）。

## 手機 App（PWA）
這是 PWA：用手機瀏覽器開網址後可「加到主畫面」，之後像原生 App 一樣全螢幕開啟，**沒有網路也能排盤**
（程式與《周易》資料都已快取在手機上；只有雲端同步需要網路）。
- iPhone（Safari）：分享 → 加入主畫面
- Android（Chrome）：選單 → 安裝應用程式，或按頁面上方「安裝到手機」
- 注意：必須用 **https 網址**（或 localhost）才能安裝與離線；直接雙擊 `index.html`（file://）只能當一般網頁用。
- 更新程式後，請把 `sw.js` 裡的 `VERSION` 改成新值，手機才會清掉舊快取。

## 放到網路上
任何靜態空間都行（整個 `meihua/` 資料夾就是網站）：
1. **GitHub Pages**（已附工作流程 `.github/workflows/meihua-pages.yml`）：
   Settings → Pages → Source 選「GitHub Actions」，把變更合併到 `main`，網站就會自動測試並發佈。
2. **Netlify / Cloudflare Pages / Vercel**：把 `meihua/` 資料夾拖進去，或連到這個 repo，發佈目錄設 `meihua`，不需建置指令。

## 功能
- 起卦五法：數字（三數）、時間（農曆年月日時）、物數／聲音、隨機、手動指定
- 本卦、互卦、變卦；體用生剋；月令旺衰（旺相休囚死，月令可選「節氣」或「農曆月」）
- 《周易》卦辭、大象、動爻爻辭與小象；互卦、變卦卦辭；八卦類象；原書依據頁碼
- 每個區塊都能在「顯示項目」勾選開關（記在瀏覽器）
- 十應：方應、日應（自動由日期算日干支）、刻應、外應、天時應、地理應、人事應，並做內外合斷
- 歷史紀錄：預設存在瀏覽器；設定 Supabase 後可用 Email 登入同步到雲端

## 檔案
| 檔案 | 說明 |
|---|---|
| `index.html`, `css/style.css`, `js/app.js` | 介面 |
| `js/core.js` | 起卦、建卦、節氣月令、體用評分（純函式，可在 Node 測試） |
| `js/data-meihua.js` | 八卦、五行、旺相休囚死、斷語規則（依《梅花易數》濃縮，附頁碼） |
| `js/data-zhouyi.js` | 《周易》卦辭、爻辭、大象、小象（自動產生，勿手改） |
| `js/config.js` | Supabase 設定（留空＝只用本機儲存） |
| `sql/supabase.sql` | 雲端資料表與 RLS 權限 |
| `tests/core.test.js` | 自動測試 |
| `manifest.webmanifest`, `sw.js`, `icons/` | 手機 App（PWA）：安裝清單、離線快取、圖示 |

## 測試
```bash
node --test meihua/tests/core.test.js
```

## 啟用雲端同步（可選）
1. 在 Supabase 建專案，於 SQL Editor 執行 `sql/supabase.sql`。
2. Authentication → Providers 啟用 Email；URL Configuration 填入你放網站的網址。
3. 把 Project URL 與 anon public key 填進 `js/config.js`。

## 已知限制
- 斷語分數是本程式的簡化規則（評分明細有列出），不是原書給分。
- 節氣月令用太陽黃經公式計算，誤差約 ±15 分鐘；交界前後 1.5 天內會提示。
- 時間一律以臺北時間（UTC+8）計；23 點起算子時，不換日。閏月沿用該月數字。
- 未收入字占、論事十大應、卦應（詳細類象）等篇章。
- 彖傳的標點依維基文庫；文字已抽查《周易正義》。卦辭、爻辭依傅佩榮書，三處錯字已依《周易正義》更正（見 `js/data-zhouyi.js` 檔頭）。

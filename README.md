<div align="center">

# 📰 News Spot

**A fast, self-hosted RSS news aggregator — powered by Flask, styled like a classic newsroom.**

![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/Flask-3.x-000000?logo=flask&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)
![Status](https://img.shields.io/badge/Status-Active-brightgreen)

**[English](#-english)** · **[فارسی](#-فارسی)**

</div>

---

## 🇬🇧 English

### Overview

**News Spot** is a single-backend, single-page news reader that pulls headlines from 16 RSS feeds (The New York Times sections, Middle East Eye, Hamshahri, and Tehran Times), merges them into one live, sortable, searchable feed, and serves everything through a lightweight Flask API. The frontend is a dependency-free HTML/CSS/JS page with dark/light themes, grid/list views, and an on-demand English → Persian translator for each headline.

No database, no build step, no framework lock-in — just one Python file and one HTML file.

### ✨ Features

**Backend (performance-first)**
- ⚡ **Parallel fetching** — all RSS sources are fetched concurrently with `ThreadPoolExecutor`; a single failing feed never breaks the response.
- 🗄️ **In-memory cache** — each feed is cached for 180 seconds, so repeated requests don't re-download unchanged feeds.
- 🔌 **Pooled HTTP session** — a shared `requests.Session` with connection pooling, a proper `User-Agent`, and sane timeouts instead of opening a new connection per feed.
- 🖼️ **Smart image extraction** — checks `media:content`, `media:thumbnail`, enclosures, embedded `<img>` tags, `thumbnail`/`image` fields, and `og:image` as a last resort.
- 🧹 **Clean summaries** — HTML stripped, whitespace collapsed, and long text truncated on a word boundary (never mid-word).
- 📝 **Structured logging** — a broken feed is logged and skipped, never crashes the API.
- 🧾 **Typed, documented code** — full type hints and docstrings, all magic numbers pulled into named constants.

**Frontend**
- 🔍 Live search and per-source filtering
- 🗂️ Grid and list view modes
- 🌗 Light / dark theme (respects system preference, remembered per browser)
- 🌐 One-click English → Persian translation per article
- 📱 Responsive layout, from desktop down to small phones
- ♿ Accessible by default — skip link, focus states, `aria-live` regions, reduced-motion support
- 🛡️ All feed content is HTML-escaped and links/URLs are validated before rendering, since RSS content comes from external, untrusted sources

### 🧱 Tech Stack

| Layer      | Technology                                   |
|------------|-----------------------------------------------|
| Backend    | Python 3.10+, Flask, feedparser, requests     |
| Frontend   | Vanilla HTML / CSS / JavaScript (no build step) |
| Fonts      | Playfair Display, Noto Serif Arabic, Inter, Vazirmatn (Google Fonts) |
| Translation| MyMemory / Google Translate (client-side, on demand) |

### 📁 Project Structure

```
news-spot/
├── app.py                 # Flask app: RSS fetching, caching, API
├── templates/
│   └── index.html         # Single-page frontend (served by Flask)
├── requirements.txt        # Python dependencies
└── README.md
```

### 🚀 Getting Started

```bash
# 1. Clone the project
git clone https://github.com/your-username/news-spot.git
cd news-spot

# 2. Create a virtual environment (recommended)
python3 -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate

# 3. Install dependencies
pip install flask feedparser requests
pip install flask-compress     # optional, enables gzip responses

# 4. Run the app
python app.py
```

Then open **http://localhost:5000** in your browser.

> `flask-compress` is optional — if it isn't installed, the app runs exactly the same, just without response compression.

### ⚙️ Configuration

All tunables live as named constants at the top of `app.py`:

| Constant               | Default | Meaning                                      |
|-------------------------|---------|-----------------------------------------------|
| `MAX_NEWS_PER_SOURCE`   | 6       | Articles pulled per RSS source                |
| `MAX_SUMMARY_LENGTH`    | 250     | Max characters in a summary before truncation |
| `MAX_TAGS`              | 4       | Max tags shown per article                    |
| `CACHE_TTL`             | 180s    | How long a fetched feed stays cached          |
| `REQUEST_TIMEOUT`       | (5, 10)s| Connect / read timeout per feed request       |
| `MAX_WORKERS`           | 8       | Thread pool size for parallel fetching        |

### 📡 News Sources

| Source            | Icon |
|--------------------|:---:|
| NYT — HomePage     | 📰 |
| NYT — World        | 🌍 |
| NYT — U.S.         | 🇺🇸 |
| NYT — Politics     | 🏛️ |
| NYT — Business     | 💼 |
| NYT — Technology   | 💻 |
| NYT — Science      | 🔬 |
| NYT — Health       | 🏥 |
| NYT — Sports       | ⚽ |
| NYT — Arts         | 🎨 |
| NYT — Music        | 🎵 |
| NYT — Opinion      | 💭 |
| NYT — Travel       | ✈️ |
| Middle East Eye    | 🌙 |
| Hamshahri          | 🇮🇷 |
| Tehran Times       | 📰 |

### 🔌 API Reference

#### `GET /`
Renders the frontend page.

#### `GET /api/news`
Returns all cached/fetched articles from every source, merged and sorted by publish date (newest first).

<details>
<summary>Example response</summary>

```json
{
  "total": 96,
  "timestamp": "2026-08-09T12:34:56.789012",
  "sources": [
    { "name": "World", "url": "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", "icon": "🌍", "color": "#48bb78" }
  ],
  "news": [
    {
      "id": "54507578",
      "title": "Example Headline",
      "link": "https://www.nytimes.com/example",
      "summary": "A clean, truncated summary of the article...",
      "published": "2026-08-09 10:00",
      "author": "Jane Doe",
      "tags": ["World"],
      "image": "https://example.com/image.jpg",
      "source": "World",
      "source_icon": "🌍",
      "source_color": "#48bb78"
    }
  ]
}
```
</details>

### 🗺️ Roadmap

- [ ] Deduplicate articles that are cross-posted across multiple RSS sections (e.g. a story that appears in both *HomePage* and *U.S.*)
- [ ] Optional left-hand sidebar layout for source categories on wide screens
- [ ] More resilient translation with automatic provider fallback

### 🤝 Contributing

Issues and pull requests are welcome. Please keep the project dependency-light and single-file where reasonable — that simplicity is a feature, not a limitation.

### 📄 License

Released under the **MIT License**. See [`LICENSE`](./LICENSE) for details (add one if it isn't present yet).

---

## 🇮🇷 فارسی

### معرفی

**News Spot** یک اپلیکیشن سبک و تک‌بکندی برای خواندن اخبار است که تیترها را از ۱۶ منبع RSS (بخش‌های مختلف نیویورک‌تایمز، میدل‌ایست‌آی، همشهری‌آنلاین و تهران‌تایمز) دریافت می‌کند، همه را در یک فید زنده، قابل‌جست‌وجو و قابل‌مرتب‌سازی ترکیب می‌کند و از طریق یک API سبک با Flask ارائه می‌دهد. بخش فرانت‌اند یک صفحه‌ی تک‌فایلی HTML/CSS/JS بدون هیچ وابستگی خارجی است، با تم روشن/تاریک، دو حالت نمایش شبکه‌ای/لیستی، و ترجمه‌ی آنی هر خبر از انگلیسی به فارسی.

بدون پایگاه‌داده، بدون مرحله‌ی Build، بدون وابستگی به فریم‌ورک خاص — فقط یک فایل پایتون و یک فایل HTML.

### ✨ امکانات

**بک‌اند (با اولویت کارایی)**
- ⚡ **دریافت موازی** — تمام منابع RSS به‌صورت هم‌زمان با `ThreadPoolExecutor` دریافت می‌شوند؛ خرابی یک منبع باعث از کار افتادن کل پاسخ نمی‌شود.
- 🗄️ **کش درون‌حافظه‌ای** — هر منبع به مدت ۱۸۰ ثانیه کش می‌شود تا درخواست‌های تکراری باعث دانلود دوباره‌ی فید نشوند.
- 🔌 **Session مشترک HTTP** — استفاده از یک `requests.Session` مشترک با Connection Pooling، User-Agent مناسب و Timeout معقول، به‌جای باز کردن اتصال جدید برای هر فید.
- 🖼️ **استخراج هوشمند تصویر** — بررسی به ترتیب `media:content`، `media:thumbnail`، Enclosure، تگ `<img>` داخل محتوا، فیلدهای `thumbnail`/`image` و در نهایت `og:image`.
- 🧹 **خلاصه‌ی تمیز** — حذف HTML، حذف فاصله‌های اضافه، و برش متن طولانی از آخرین فاصله (هرگز وسط یک کلمه).
- 📝 **لاگ‌گیری ساختاریافته** — خرابی یک فید فقط لاگ می‌شود و رد می‌شود، هرگز کل API را از کار نمی‌اندازد.
- 🧾 **کد تایپ‌شده و مستندسازی‌شده** — Type Hint و Docstring کامل، تمام اعداد ثابت به‌صورت Constant نام‌گذاری‌شده.

**فرانت‌اند**
- 🔍 جست‌وجوی زنده و فیلتر بر اساس منبع
- 🗂️ دو حالت نمایش شبکه‌ای و لیستی
- 🌗 تم روشن/تاریک (هماهنگ با تنظیمات سیستم، و ذخیره‌شده در مرورگر)
- 🌐 ترجمه‌ی یک‌کلیکی هر خبر از انگلیسی به فارسی
- 📱 طراحی ریسپانسیو، از دسکتاپ تا موبایل‌های کوچک
- ♿ دسترس‌پذیر به‌صورت پیش‌فرض — لینک پرش، وضوح فوکوس، نواحی `aria-live`، پشتیبانی از کاهش انیمیشن
- 🛡️ تمام محتوای دریافتی از فیدها پیش از نمایش Escape می‌شود و لینک‌ها اعتبارسنجی می‌شوند، چون محتوای RSS از منابع خارجی و غیرقابل‌اعتماد می‌آید

### 🧱 فناوری‌های استفاده‌شده

| لایه         | فناوری                                        |
|--------------|-----------------------------------------------|
| بک‌اند       | Python 3.10+, Flask, feedparser, requests     |
| فرانت‌اند    | HTML / CSS / JavaScript خالص (بدون نیاز به Build) |
| فونت‌ها       | Playfair Display، Noto Serif Arabic، Inter، Vazirmatn (از Google Fonts) |
| ترجمه         | MyMemory / Google Translate (سمت کاربر، هنگام درخواست) |

### 📁 ساختار پروژه

```
news-spot/
├── app.py                 # اپلیکیشن Flask: دریافت RSS، کش، API
├── templates/
│   └── index.html         # فرانت‌اند تک‌صفحه‌ای (سرو شده توسط Flask)
├── requirements.txt        # وابستگی‌های پایتون
└── README.md
```

### 🚀 راه‌اندازی

```bash
# ۱. دریافت پروژه
git clone https://github.com/your-username/news-spot.git
cd news-spot

# ۲. ساخت محیط مجازی (پیشنهادی)
python3 -m venv venv
source venv/bin/activate      # ویندوز: venv\Scripts\activate

# ۳. نصب وابستگی‌ها
pip install flask feedparser requests
pip install flask-compress     # اختیاری، فعال‌سازی فشرده‌سازی پاسخ‌ها

# ۴. اجرای برنامه
python app.py
```

سپس آدرس **http://localhost:5000** را در مرورگر باز کنید.

> نصب `flask-compress` اختیاری است — در صورت نبودن آن، برنامه دقیقاً همان‌طور اجرا می‌شود، فقط بدون فشرده‌سازی پاسخ‌ها.

### ⚙️ پیکربندی

تمام مقادیر قابل‌تنظیم به‌صورت Constant در ابتدای فایل `app.py` قرار دارند:

| ثابت                    | مقدار پیش‌فرض | توضیح                                          |
|--------------------------|----------------|--------------------------------------------------|
| `MAX_NEWS_PER_SOURCE`    | 6              | تعداد خبر دریافتی از هر منبع RSS                |
| `MAX_SUMMARY_LENGTH`     | 250            | حداکثر تعداد کاراکتر خلاصه پیش از برش            |
| `MAX_TAGS`               | 4              | حداکثر تعداد برچسب نمایش‌داده‌شده برای هر خبر    |
| `CACHE_TTL`              | ۱۸۰ ثانیه      | مدت زمان معتبر بودن کش هر فید                   |
| `REQUEST_TIMEOUT`        | (۵، ۱۰) ثانیه  | Timeout اتصال / خواندن برای هر درخواست فید      |
| `MAX_WORKERS`            | 8              | تعداد Threadهای موازی برای دریافت هم‌زمان فیدها |

### 📡 منابع خبری

| منبع                | آیکون |
|----------------------|:----:|
| نیویورک‌تایمز — صفحه اصلی | 📰 |
| نیویورک‌تایمز — جهان      | 🌍 |
| نیویورک‌تایمز — آمریکا    | 🇺🇸 |
| نیویورک‌تایمز — سیاست     | 🏛️ |
| نیویورک‌تایمز — اقتصاد    | 💼 |
| نیویورک‌تایمز — فناوری    | 💻 |
| نیویورک‌تایمز — علم       | 🔬 |
| نیویورک‌تایمز — سلامت     | 🏥 |
| نیویورک‌تایمز — ورزش      | ⚽ |
| نیویورک‌تایمز — هنر       | 🎨 |
| نیویورک‌تایمز — موسیقی    | 🎵 |
| نیویورک‌تایمز — دیدگاه    | 💭 |
| نیویورک‌تایمز — سفر       | ✈️ |
| میدل‌ایست‌آی          | 🌙 |
| همشهری‌آنلاین          | 🇮🇷 |
| تهران‌تایمز            | 📰 |

### 🔌 مستندات API

#### `GET /`
صفحه‌ی اصلی فرانت‌اند را رندر می‌کند.

#### `GET /api/news`
تمام اخبار دریافت‌شده یا کش‌شده از همه‌ی منابع را، ترکیب‌شده و مرتب‌شده بر اساس تاریخ انتشار (جدیدترین اول)، برمی‌گرداند.

<details>
<summary>نمونه پاسخ</summary>

```json
{
  "total": 96,
  "timestamp": "2026-08-09T12:34:56.789012",
  "sources": [
    { "name": "World", "url": "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", "icon": "🌍", "color": "#48bb78" }
  ],
  "news": [
    {
      "id": "54507578",
      "title": "نمونه تیتر خبر",
      "link": "https://www.nytimes.com/example",
      "summary": "خلاصه‌ای تمیز و برش‌خورده از خبر...",
      "published": "2026-08-09 10:00",
      "author": "Jane Doe",
      "tags": ["World"],
      "image": "https://example.com/image.jpg",
      "source": "World",
      "source_icon": "🌍",
      "source_color": "#48bb78"
    }
  ]
}
```
</details>

### 🗺️ نقشه راه

- [ ] حذف اخبار تکراری که در چند بخش RSS هم‌زمان منتشر می‌شوند (مثلاً خبری که هم در *HomePage* و هم در *U.S.* دیده می‌شود)
- [ ] چیدمان اختیاری نوار کناری سمت چپ برای دسته‌بندی منابع در صفحه‌نمایش‌های بزرگ
- [ ] پایداری بیشتر ترجمه با جایگزینی خودکار سرویس در صورت خطا

### 🤝 مشارکت

Issue و Pull Request خوش‌آمد است. لطفاً پروژه را تا حد امکان سبک و تک‌فایلی نگه دارید — این سادگی یک ویژگی است، نه یک محدودیت.

### 📄 مجوز

منتشرشده تحت **مجوز MIT**. برای جزئیات به فایل [`LICENSE`](./LICENSE) مراجعه کنید (در صورت نبودن، آن را اضافه کنید).
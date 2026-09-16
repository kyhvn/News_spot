"""
News Aggregator - Flask + RSS
با Global Cache، Background Fetcher و Broadcast
"""

import hashlib
import logging
import queue
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple, Generator

import feedparser
import requests
from flask import Flask, Response, jsonify, render_template, request, stream_with_context

try:
    from flask_compress import Compress
except ImportError:
    Compress = None

# ============================================
# Import Config
# ============================================
from config import config, get_feeds_by_category, get_categories

# ============================================
# Logging Setup
# ============================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ============================================
# Flask App
# ============================================
app = Flask(__name__)
env = 'development'
app.config.from_object(config[env])

try:
    app.json.sort_keys = False
    app.json.compact = True
except AttributeError:
    app.config['JSON_SORT_KEYS'] = False
    app.config['JSONIFY_PRETTYPRINT_REGULAR'] = False

if Compress is not None:
    Compress(app)

# ============================================
# Constants
# ============================================
MAX_NEWS_PER_SOURCE = 999999
MAX_SUMMARY_LENGTH = 500
MAX_TAGS = 6
CACHE_TTL = app.config.get('CACHE_TIMEOUT', 180.0)          # TTL برای per-URL cache
GLOBAL_CACHE_TTL = app.config.get('GLOBAL_CACHE_TTL', 300) # TTL برای global cache (۵ دقیقه)
BACKGROUND_FETCH_INTERVAL = app.config.get('BACKGROUND_FETCH_INTERVAL', 300)
REQUEST_TIMEOUT = (15.0, 30.0)
MAX_WORKERS = app.config.get('MAX_WORKERS', 15)
HASH_LENGTH = 8
DATE_FORMAT = '%Y-%m-%d %H:%M'
DEFAULT_TITLE = 'بدون عنوان'
DEFAULT_LINK = '#'
DEFAULT_TAG = 'General'
SUMMARY_ELLIPSIS = '...'
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
RSS_FEEDS = app.config.get('RSS_FEEDS', [])
MAX_TOTAL_NEWS = app.config.get('MAX_TOTAL_NEWS', 2000)

# ============================================
# Regex Patterns
# ============================================
HTML_TAG_RE = re.compile(r'<[^>]+>')
WHITESPACE_RE = re.compile(r'\s+')
IMG_SRC_RE = re.compile(r'<img[^>]+src=["\']([^"\'>]+)["\']', re.IGNORECASE)
OG_IMAGE_RE = re.compile(r'<meta[^>]+property=["\']og:image["\'][^>]*content=["\']([^"\']+)["\']', re.IGNORECASE)

# ============================================
# HTTP Session
# ============================================
_session = requests.Session()
_session.headers.update({
    'User-Agent': USER_AGENT,
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
})

_http_adapter = requests.adapters.HTTPAdapter(
    pool_connections=MAX_WORKERS * 2,
    pool_maxsize=MAX_WORKERS * 2,
    max_retries=2
)
_session.mount('http://', _http_adapter)
_session.mount('https://', _http_adapter)

# ============================================
# Per-URL Cache (برای جلوگیری از fetch تکراری)
# ============================================
_cache_lock = Lock()
_news_cache: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}

def _get_cached_news(url: str) -> Optional[List[Dict[str, Any]]]:
    with _cache_lock:
        cached = _news_cache.get(url)
    if cached is None:
        return None
    cached_at, news_items = cached
    if time.monotonic() - cached_at > CACHE_TTL:
        return None
    return news_items

def _set_cached_news(url: str, news_items: List[Dict[str, Any]]) -> None:
    with _cache_lock:
        _news_cache[url] = (time.monotonic(), news_items)

# ============================================
# Content Processing
# ============================================
def _clean_html(text: str) -> str:
    if not text:
        return ''
    without_tags = HTML_TAG_RE.sub('', text)
    return WHITESPACE_RE.sub(' ', without_tags).strip()

def _truncate_summary(text: str) -> str:
    if len(text) <= MAX_SUMMARY_LENGTH:
        return text
    truncated = text[:MAX_SUMMARY_LENGTH]
    last_space = truncated.rfind(' ')
    if last_space > 0:
        truncated = truncated[:last_space]
    return truncated.rstrip() + SUMMARY_ELLIPSIS

def _extract_tags(raw_tags: List[Dict[str, Any]], category: str) -> List[str]:
    tags = [term for tag in raw_tags if (term := tag.get('term', '')) and len(term) < 50]
    if not tags:
        tags.append(category or DEFAULT_TAG)
    return tags[:MAX_TAGS]

def extract_image(entry: 'feedparser.FeedParserDict', summary_html: str) -> Optional[str]:
    media_content = entry.get('media_content')
    if media_content:
        for media in media_content:
            if url := media.get('url'):
                return url

    media_thumbnail = entry.get('media_thumbnail')
    if media_thumbnail:
        for media in media_thumbnail:
            if url := media.get('url'):
                return url

    enclosures = entry.get('enclosures')
    if enclosures:
        for enclosure in enclosures:
            url = enclosure.get('url')
            if url and enclosure.get('type', '').startswith('image/'):
                return url

    content_list = entry.get('content')
    if content_list:
        html_value = content_list[0].get('value', '')
        match = IMG_SRC_RE.search(html_value)
        if match:
            return match.group(1)

    thumbnail = entry.get('thumbnail')
    if thumbnail:
        url = thumbnail.get('href') if isinstance(thumbnail, dict) else thumbnail
        if url:
            return url

    image = entry.get('image')
    if image:
        url = image.get('href') if isinstance(image, dict) else image
        if url:
            return url

    if summary_html:
        match = OG_IMAGE_RE.search(summary_html)
        if match:
            return match.group(1)

    return None

def _parse_published(raw_published: str) -> Optional[datetime]:
    if not raw_published:
        return None
    try:
        dt = parsedate_to_datetime(raw_published)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (TypeError, ValueError, OverflowError):
        return None

def _build_news_item(entry: 'feedparser.FeedParserDict', source: Dict[str, str]) -> Dict[str, Any]:
    raw_title = entry.get('title', '')
    raw_summary = entry.get('summary', '')
    raw_published = entry.get('published', '')
    link = entry.get('link', DEFAULT_LINK)
    author = entry.get('author', '')
    raw_tags = entry.get('tags', [])
    category = entry.get('category', '')

    published_dt = _parse_published(raw_published)
    published = published_dt.strftime(DATE_FORMAT) if published_dt else raw_published

    summary = _truncate_summary(_clean_html(raw_summary))
    tags = _extract_tags(raw_tags, category)
    image = extract_image(entry, raw_summary)
    news_id = hashlib.md5((raw_title + raw_summary).encode()).hexdigest()[:HASH_LENGTH]

    return {
        'id': news_id,
        'title': raw_title or DEFAULT_TITLE,
        'link': link,
        'summary': summary,
        'published': published,
        'author': author,
        'tags': tags,
        'image': image,
        'source': source['name'],
        'source_icon': source.get('icon', '📰'),
        'source_color': source.get('color', '#6c757d'),
        'category': source.get('category', 'general'),
        '_ts': published_dt or datetime.now(timezone.utc),
    }

def _fetch_and_process_feed(source: Dict[str, str]) -> Tuple[str, List[Dict[str, Any]], bool]:
    """دریافت و پردازش یک منبع RSS"""
    url = source['url']
    name = source['name']

    cached_news = _get_cached_news(url)
    if cached_news is not None:
        return name, cached_news, True

    try:
        headers = {
            'User-Agent': USER_AGENT,
            'Accept': 'application/rss+xml, application/xml, text/xml, */*',
            'Accept-Language': 'en-US,en;q=0.9',
        }

        response = _session.get(url, timeout=REQUEST_TIMEOUT, headers=headers)
        response.raise_for_status()

        content = response.content
        if not content or len(content) < 50:
            logger.warning(f"⚠️ {name}: Empty response")
            return name, [], False

        parsed_feed = feedparser.parse(content)

        if parsed_feed.bozo:
            logger.warning(f"⚠️ {name}: Bozo - {str(parsed_feed.bozo_exception)[:100]}")

        if not parsed_feed.entries:
            logger.warning(f"⚠️ {name}: No entries")
            return name, [], False

        news_items = [_build_news_item(entry, source) for entry in parsed_feed.entries]
        _set_cached_news(url, news_items)
        logger.info(f"✅ {name}: {len(news_items)} items")
        return name, news_items, True

    except requests.Timeout:
        logger.warning(f"⏱️ {name}: Timeout")
        return name, [], False
    except requests.ConnectionError:
        logger.warning(f"🔌 {name}: Connection Error")
        return name, [], False
    except requests.HTTPError as e:
        logger.warning(f"❌ {name}: HTTP {e.response.status_code if e.response else 'Unknown'}")
        return name, [], False
    except Exception as e:
        logger.warning(f"❌ {name}: {str(e)[:80]}")
        return name, [], False

# ============================================
# Global News Cache + Broadcast
# ============================================
class GlobalNewsCache:
    """
    کش سراسری اخبار با پشتیبانی از Broadcast به همه subscriber ها.

    - اخبار در حافظه ذخیره می‌شوند (deduplicated بر اساس id)
    - Background Fetcher هر BACKGROUND_FETCH_INTERVAL ثانیه یک بار آن را تازه می‌کند
    - کاربران جدید از این cache سرو می‌شوند (بدون fetch مجدد)
    - Subscriber های متصل، به‌روزرسانی‌های لحظه‌ای را دریافت می‌کنند
    """
    def __init__(self):
        self.lock = threading.RLock()
        self.news: List[Dict[str, Any]] = []
        self.news_ids: set = set()
        self.last_update: float = 0
        self.last_fetch_duration: float = 0
        self.is_fetching: bool = False
        self.fetch_progress: Dict[str, Any] = {
            'loaded': 0,
            'total': 0,
            'current_source': '',
            'errors': []
        }
        self.subscribers: List[queue.Queue] = []
        self.version: int = 0

    def is_fresh(self) -> bool:
        """آیا cache تازه است؟"""
        if len(self.news) == 0:
            return False
        return (time.time() - self.last_update) < GLOBAL_CACHE_TTL

    def get_snapshot(self) -> Dict[str, Any]:
        """عکس فوری از cache فعلی"""
        with self.lock:
            return {
                'news': list(self.news),
                'total': len(self.news),
                'last_update': self.last_update,
                'version': self.version,
                'is_fetching': self.is_fetching,
                'is_fresh': self.is_fresh(),
                'progress': dict(self.fetch_progress),
                'subscribers': len(self.subscribers),
            }

    def add_news_batch(self, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """افزودن batch از اخبار جدید (با dedupe بر اساس id)"""
        added = []
        with self.lock:
            for item in items:
                item_id = item.get('id')
                if not item_id:
                    # اگر id نبود، از link یا title استفاده کن
                    item_id = item.get('link') or item.get('title', '')
                if item_id in self.news_ids:
                    continue
                self.news_ids.add(item_id)
                self.news.append(item)
                added.append(item)

            # Trim به سقف کل
            if len(self.news) > MAX_TOTAL_NEWS:
                removed = self.news[:-MAX_TOTAL_NEWS]
                self.news = self.news[-MAX_TOTAL_NEWS:]
                for item in removed:
                    item_id = item.get('id') or item.get('link') or item.get('title', '')
                    self.news_ids.discard(item_id)

            # مرتب‌سازی بر اساس زمان انتشار (نزولی)
            try:
                self.news.sort(
                    key=lambda x: x.get('_ts', datetime.now(timezone.utc)),
                    reverse=True
                )
            except TypeError:
                for item in self.news:
                    if '_ts' in item and item['_ts'].tzinfo is None:
                        item['_ts'] = item['_ts'].replace(tzinfo=timezone.utc)
                self.news.sort(
                    key=lambda x: x.get('_ts', datetime.now(timezone.utc)),
                    reverse=True
                )

        if added:
            self.version += 1
        return added

    def subscribe(self) -> queue.Queue:
        """ثبت subscriber جدید"""
        q: queue.Queue = queue.Queue(maxsize=1000)
        with self.lock:
            self.subscribers.append(q)
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        """حذف subscriber"""
        with self.lock:
            if q in self.subscribers:
                self.subscribers.remove(q)

    def broadcast(self, event_type: str, data: Dict[str, Any]) -> None:
        """ارسال event به همه subscriber ها"""
        message = {'type': event_type, **data}
        with self.lock:
            dead = []
            for q in self.subscribers:
                try:
                    q.put_nowait(message)
                except queue.Full:
                    dead.append(q)
            for q in dead:
                try:
                    self.subscribers.remove(q)
                except ValueError:
                    pass

    def clear(self) -> None:
        """پاک کردن cache (برای endpoint /api/cache/clear)"""
        with self.lock:
            self.news = []
            self.news_ids = set()
            self.last_update = 0
            self.version += 1


global_cache = GlobalNewsCache()

# ============================================
# Background Fetcher
# ============================================
def fetch_all_feeds_into_cache() -> None:
    """
    همه فیدها را موازی fetch می‌کند و در global_cache می‌ریزد.
    این تابع هم توسط Background Thread و هم به‌صورت on-demand فراخوانی می‌شود.
    """
    if global_cache.is_fetching:
        logger.info("⏭️ Fetch already in progress, skipping")
        return

    feeds = RSS_FEEDS
    total_feeds = len(feeds)
    if total_feeds == 0:
        return

    logger.info(f"🔄 Background fetch starting for {total_feeds} feeds...")
    start_time = time.time()

    with global_cache.lock:
        global_cache.is_fetching = True
        global_cache.fetch_progress = {
            'loaded': 0,
            'total': total_feeds,
            'current_source': '',
            'errors': []
        }

    global_cache.broadcast('start', {'total': total_feeds})

    try:
        with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, total_feeds)) as executor:
            future_to_feed = {
                executor.submit(_fetch_and_process_feed, feed): feed
                for feed in feeds
            }

            for future in as_completed(future_to_feed):
                feed = future_to_feed[future]
                try:
                    name, items, success = future.result()

                    with global_cache.lock:
                        global_cache.fetch_progress['loaded'] += 1
                        global_cache.fetch_progress['current_source'] = name

                    if success and items:
                        added = global_cache.add_news_batch(items)
                        # Broadcast اخبار جدید
                        for item in added:
                            clean_item = {k: v for k, v in item.items() if not k.startswith('_')}
                            global_cache.broadcast('news', {'item': clean_item})

                        global_cache.broadcast('progress', {
                            'source': name,
                            'loaded': len(global_cache.news),
                            'feeds_completed': global_cache.fetch_progress['loaded'],
                            'total_feeds': total_feeds,
                        })
                    else:
                        with global_cache.lock:
                            global_cache.fetch_progress['errors'].append(name)
                        global_cache.broadcast('error', {'source': name})

                except Exception as exc:
                    logger.error(f"❌ Error processing {feed['name']}: {exc}")
                    with global_cache.lock:
                        global_cache.fetch_progress['errors'].append(feed['name'])
                    global_cache.broadcast('error', {'source': feed['name']})

        with global_cache.lock:
            global_cache.is_fetching = False
            global_cache.last_update = time.time()
            global_cache.last_fetch_duration = time.time() - start_time

        global_cache.broadcast('complete', {
            'total': len(global_cache.news),
            'duration': global_cache.last_fetch_duration,
        })

        logger.info(
            f"✅ Fetch complete in {global_cache.last_fetch_duration:.1f}s "
            f"({len(global_cache.news)} news in cache)"
        )

    except Exception as e:
        logger.error(f"❌ Fetch failed: {e}")
        with global_cache.lock:
            global_cache.is_fetching = False
        global_cache.broadcast('error', {'message': str(e)})


def background_fetcher_loop() -> None:
    """
    Thread پس‌زمینه که هر BACKGROUND_FETCH_INTERVAL ثانیه یک بار
    همه فیدها را می‌گیرد و cache را تازه می‌کند.
    """
    # اولین fetch بعد از ۱ ثانیه (بعد از راه‌افتادن سرور)
    time.sleep(1)
    try:
        fetch_all_feeds_into_cache()
    except Exception as e:
        logger.error(f"Initial fetch error: {e}")

    # سپس هر BACKGROUND_FETCH_INTERVAL ثانیه
    while True:
        time.sleep(BACKGROUND_FETCH_INTERVAL)
        try:
            fetch_all_feeds_into_cache()
        except Exception as e:
            logger.error(f"Background fetch error: {e}")

# ============================================
# API Streaming (Cache-Aware)
# ============================================

@app.route('/api/news/stream')
def api_news_stream() -> Response:
    """
    SSE Stream با پشتیبانی از Global Cache:

    - اگر cache تازه است → کاربر فوراً همه اخبار را می‌گیرد (بدون انتظار)
    - اگر cache در حال fetch است → کاربر subscribe می‌شود و اخبار را زنده می‌گیرد
    - اگر cache قدیمی است → fetch جدید trigger می‌شود و همه با هم نتیجه را می‌گیرند
    """
    def generate() -> Generator[str, None, None]:
        snapshot = global_cache.get_snapshot()
        total_feeds = snapshot['progress']['total'] or len(RSS_FEEDS)

        # حالت ۱: cache تازه است → فوراً همه اخبار را بفرست
        if snapshot['is_fresh']:
            logger.info(f"⚡ Serving {snapshot['total']} news from fresh cache")
            yield _sse({'type': 'start', 'total': total_feeds, 'from_cache': True})

            for item in snapshot['news']:
                clean_item = {k: v for k, v in item.items() if not k.startswith('_')}
                yield _sse({'type': 'news', 'item': clean_item, 'source': item.get('source', '')})

            yield _sse({
                'type': 'complete',
                'total_news': snapshot['total'],
                'from_cache': True,
                'timestamp': datetime.now(timezone.utc).isoformat(),
            })
            yield "data: [DONE]\n\n"
            return

        # حالت ۲: cache در حال fetch است → subscribe شو
        # حالت ۳: cache قدیمی → fetch جدید trigger کن
        if not snapshot['is_fetching']:
            logger.info("🔄 Triggering new fetch (cache stale/empty)")
            threading.Thread(target=fetch_all_feeds_into_cache, daemon=True).start()
        else:
            logger.info("⏳ Joining ongoing fetch...")

        # Subscribe و ارسال اخبار موجود + انتظار برای جدیدها
        q = global_cache.subscribe()
        try:
            yield _sse({'type': 'start', 'total': total_feeds, 'from_cache': False})

            # اگر اخبار قدیمی در cache داریم، اول آن‌ها را بفرست
            if snapshot['news']:
                for item in snapshot['news']:
                    clean_item = {k: v for k, v in item.items() if not k.startswith('_')}
                    yield _sse({'type': 'news', 'item': clean_item, 'source': item.get('source', '')})
                yield _sse({'type': 'first_batch', 'message': 'اخبار موجود از cache'})

            # حالا منتظر event های جدید از broadcast
            while True:
                try:
                    event = q.get(timeout=20)
                    yield _sse(event)

                    if event.get('type') == 'complete':
                        break
                except queue.Empty:
                    # heartbeat برای جلوگیری از timeout
                    yield f": heartbeat {int(time.time())}\n\n"

        finally:
            global_cache.unsubscribe(q)
            yield "data: [DONE]\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive',
        }
    )


def _sse(data: Dict[str, Any]) -> str:
    """Helper برای ساخت SSE message"""
    return f"data: {jsonify(data).get_data(as_text=True)}\n\n"


# ============================================
# API معمولی
# ============================================

@app.route('/api/news')
def api_news() -> Response:
    """
    API دریافت اخبار از Global Cache.
    اگر cache خالی باشد، یک fetch جدید trigger می‌شود و منتظر می‌مانیم.
    """
    snapshot = global_cache.get_snapshot()

    # اگر cache خالی است، یک بار fetch کن و منتظر بمان
    if snapshot['total'] == 0 and not snapshot['is_fetching']:
        logger.info("🔄 Cache empty, fetching synchronously...")
        fetch_all_feeds_into_cache()
        snapshot = global_cache.get_snapshot()

    news_output = [
        {k: v for k, v in item.items() if not k.startswith('_')}
        for item in snapshot['news']
    ]

    return jsonify({
        'total': len(news_output),
        'sources': RSS_FEEDS,
        'news': news_output,
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'from_cache': snapshot['is_fresh'],
        'cache_age': time.time() - snapshot['last_update'] if snapshot['last_update'] else None,
        'stats': {
            'total_feeds': len(RSS_FEEDS),
            'success_feeds': snapshot['progress']['loaded'] - len(snapshot['progress']['errors']),
            'failed_feeds': len(snapshot['progress']['errors']),
            'failed_list': snapshot['progress']['errors'],
            'total_news': len(news_output),
        }
    })


# ============================================
# Routes
# ============================================

@app.route('/')
def index() -> str:
    category = request.args.get('category', 'all')
    feed = request.args.get('feed', 'all')
    search = request.args.get('search', '')

    if category != 'all':
        feeds = get_feeds_by_category(category)
    else:
        feeds = RSS_FEEDS

    if feed != 'all':
        feeds = [f for f in feeds if f.get('name') == feed]

    return render_template(
        'index.html',
        sources=feeds,
        categories=get_categories(),
        selected_category=category,
        selected_feed=feed,
        search=search
    )


@app.route('/api/feeds')
def api_feeds() -> Response:
    """لیست فیدها + وضعیت cache"""
    category = request.args.get('category', 'all')
    if category != 'all':
        feeds = get_feeds_by_category(category)
    else:
        feeds = RSS_FEEDS

    snapshot = global_cache.get_snapshot()
    return jsonify({
        'total': len(feeds),
        'feeds': feeds,
        'categories': get_categories(),
        'cache': {
            'news_count': snapshot['total'],
            'last_update': snapshot['last_update'],
            'is_fresh': snapshot['is_fresh'],
            'is_fetching': snapshot['is_fetching'],
            'age_seconds': time.time() - snapshot['last_update'] if snapshot['last_update'] else None,
        }
    })


@app.route('/api/categories')
def api_categories() -> Response:
    return jsonify({'categories': get_categories()})


@app.route('/api/cache/clear', methods=['POST'])
def api_cache_clear() -> Response:
    """پاک کردن هر دو cache"""
    global_cache.clear()
    with _cache_lock:
        _news_cache.clear()
    return jsonify({
        'status': 'success',
        'message': 'All caches cleared successfully'
    })


@app.route('/api/refresh', methods=['POST'])
def api_refresh() -> Response:
    """
    Trigger دستی fetch جدید.
    اگر fetch در حال اجرا باشد، فقط 202 برمی‌گرداند.
    """
    if global_cache.is_fetching:
        return jsonify({'status': 'already_fetching'}), 202

    threading.Thread(target=fetch_all_feeds_into_cache, daemon=True).start()
    return jsonify({'status': 'started'})


@app.route('/api/status')
def api_status() -> Response:
    """وضعیت کامل سرور برای monitoring"""
    snapshot = global_cache.get_snapshot()
    return jsonify({
        'cache': {
            'news_count': snapshot['total'],
            'last_update': snapshot['last_update'],
            'age_seconds': time.time() - snapshot['last_update'] if snapshot['last_update'] else None,
            'is_fresh': snapshot['is_fresh'],
            'is_fetching': snapshot['is_fetching'],
            'subscribers': snapshot['subscribers'],
            'version': snapshot['version'],
        },
        'fetch_progress': snapshot['progress'],
        'feeds_total': len(RSS_FEEDS),
        'config': {
            'global_cache_ttl': GLOBAL_CACHE_TTL,
            'background_fetch_interval': BACKGROUND_FETCH_INTERVAL,
            'max_workers': MAX_WORKERS,
        }
    })


@app.route('/api/debug/feeds')
def debug_feeds() -> Response:
    """API برای دیباگ - وضعیت همه فیدها"""
    results = []
    for feed in RSS_FEEDS:
        try:
            response = _session.get(feed['url'], timeout=5.0)
            status = response.status_code
            content_type = response.headers.get('content-type', '')
            is_xml = 'xml' in content_type or 'rss' in content_type
            results.append({
                'name': feed['name'],
                'url': feed['url'],
                'status': status,
                'content_type': content_type,
                'is_xml': is_xml,
                'working': status == 200 and is_xml
            })
        except Exception as e:
            results.append({
                'name': feed['name'],
                'url': feed['url'],
                'status': 'error',
                'error': str(e)[:100],
                'working': False
            })

    return jsonify({
        'total': len(results),
        'results': results
    })


# ============================================
# Main Entry Point
# ============================================

# شروع Background Fetcher به‌محض import شدن app
# (نه فقط در __main__، چون gunicorn مستقیماً app را import می‌کند)
_fetcher_thread = threading.Thread(target=background_fetcher_loop, daemon=True)
_fetcher_thread.start()
logger.info("🎬 Background fetcher thread started")


if __name__ == '__main__':
    host = app.config.get('HOST', '0.0.0.0')
    port = app.config.get('PORT', 5000)
    debug = app.config.get('DEBUG', True)

    logger.info(f"🚀 Starting News Aggregator on http://{host}:{port}")
    logger.info(f"📰 Loaded {len(RSS_FEEDS)} RSS feeds")

    # در حالت debug، reloader رو خاموش کن تا thread دوبار ساخته نشه
    app.run(
        host=host,
        port=port,
        debug=debug,
        threaded=True,
        use_reloader=False,
    )
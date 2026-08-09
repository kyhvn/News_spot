"""
News Aggregator - Flask + RSS
با پشتیبانی از Streaming و دیباگ کامل
"""

import hashlib
import logging
import re
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
CACHE_TTL = app.config.get('CACHE_TIMEOUT', 180.0)
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
# Cache
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
# API Streaming - اضافه شده
# ============================================

@app.route('/api/news/stream')
def api_news_stream() -> Response:
    """API Streaming - اخبار را به محض دریافت می‌فرستد"""
    category = request.args.get('category', 'all')
    feed = request.args.get('feed', 'all')
    
    if category != 'all':
        feeds = get_feeds_by_category(category)
    else:
        feeds = RSS_FEEDS
    
    if feed != 'all':
        feeds = [f for f in feeds if f.get('name') == feed]
    
    total_feeds = len(feeds)
    logger.info(f"📡 Streaming {total_feeds} feeds")
    
    @stream_with_context
    def generate() -> Generator[str, None, None]:
        """Generator برای ارسال داده‌ها به صورت Streaming"""
        
        # ارسال شروع
        yield f"data: {jsonify({'type': 'start', 'total': total_feeds, 'timestamp': datetime.now(timezone.utc).isoformat()}).get_data(as_text=True)}\n\n"
        
        all_news = []
        success_count = 0
        failed_count = 0
        first_batch_sent = False
        
        # پردازش با ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(feeds) or 1)) as executor:
            future_to_feed = {
                executor.submit(_fetch_and_process_feed, feed): feed 
                for feed in feeds
            }
            
            for future in as_completed(future_to_feed):
                feed = future_to_feed[future]
                try:
                    name, items, success = future.result()
                    
                    if success and items:
                        success_count += 1
                        all_news.extend(items)
                        
                        # ارسال هر خبر
                        for item in items:
                            clean_item = {k: v for k, v in item.items() if not k.startswith('_')}
                            yield f"data: {jsonify({'type': 'news', 'source': name, 'item': clean_item}).get_data(as_text=True)}\n\n"
                        
                        # ارسال وضعیت پیشرفت
                        progress = {
                            'type': 'progress',
                            'source': name,
                            'loaded': len(all_news),
                            'feeds_completed': success_count + failed_count,
                            'total_feeds': total_feeds,
                            'success': success_count,
                            'failed': failed_count
                        }
                        yield f"data: {jsonify(progress).get_data(as_text=True)}\n\n"
                        
                        if not first_batch_sent:
                            first_batch_sent = True
                            yield f"data: {jsonify({'type': 'first_batch', 'message': 'اولین اخبار دریافت شدند!'}).get_data(as_text=True)}\n\n"
                        
                    else:
                        failed_count += 1
                        yield f"data: {jsonify({'type': 'error', 'source': name, 'message': f'خطا در دریافت {name}'}).get_data(as_text=True)}\n\n"
                        
                except Exception as exc:
                    failed_count += 1
                    logger.error(f"❌ Error processing {feed['name']}: {exc}")
                    yield f"data: {jsonify({'type': 'error', 'source': feed['name'], 'message': str(exc)}).get_data(as_text=True)}\n\n"
        
        # مرتب‌سازی
        try:
            all_news.sort(key=lambda item: item.get('_ts', datetime.now(timezone.utc)), reverse=True)
        except TypeError:
            for item in all_news:
                if '_ts' in item and item['_ts'].tzinfo is None:
                    item['_ts'] = item['_ts'].replace(tzinfo=timezone.utc)
            all_news.sort(key=lambda item: item.get('_ts', datetime.now(timezone.utc)), reverse=True)
        
        # ارسال وضعیت نهایی
        final_data = {
            'type': 'complete',
            'total_news': len(all_news),
            'success_feeds': success_count,
            'failed_feeds': failed_count,
            'total_feeds': total_feeds,
            'timestamp': datetime.now(timezone.utc).isoformat()
        }
        yield f"data: {jsonify(final_data).get_data(as_text=True)}\n\n"
        
        # ارسال سیگنال پایان
        yield "data: [DONE]\n\n"
    
    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive'
        }
    )

# ============================================
# API معمولی
# ============================================

@app.route('/api/news')
def api_news() -> Response:
    """API دریافت اخبار"""
    category = request.args.get('category', 'all')
    feed = request.args.get('feed', 'all')
    
    if category != 'all':
        feeds = get_feeds_by_category(category)
    else:
        feeds = RSS_FEEDS
    
    if feed != 'all':
        feeds = [f for f in feeds if f.get('name') == feed]
    
    all_news = []
    failed_feeds = []
    success_feeds = []
    
    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(feeds) or 1)) as executor:
        future_to_feed = {
            executor.submit(_fetch_and_process_feed, feed): feed 
            for feed in feeds
        }
        
        for future in as_completed(future_to_feed):
            feed = future_to_feed[future]
            try:
                name, items, success = future.result()
                if success and items:
                    success_feeds.append(name)
                    all_news.extend(items)
                else:
                    failed_feeds.append(name)
            except Exception as exc:
                logger.error(f"Error processing {feed['name']}: {exc}")
                failed_feeds.append(feed['name'])
    
    try:
        all_news.sort(key=lambda item: item.get('_ts', datetime.now(timezone.utc)), reverse=True)
    except TypeError:
        for item in all_news:
            if '_ts' in item and item['_ts'].tzinfo is None:
                item['_ts'] = item['_ts'].replace(tzinfo=timezone.utc)
        all_news.sort(key=lambda item: item.get('_ts', datetime.now(timezone.utc)), reverse=True)
    
    news_output = [
        {key: value for key, value in item.items() if not key.startswith('_')}
        for item in all_news
    ]
    
    return jsonify({
        'total': len(news_output),
        'sources': feeds,
        'news': news_output,
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'stats': {
            'total_feeds': len(feeds),
            'success_feeds': len(success_feeds),
            'failed_feeds': len(failed_feeds),
            'failed_list': failed_feeds,
            'total_news': len(news_output)
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
    category = request.args.get('category', 'all')
    if category != 'all':
        feeds = get_feeds_by_category(category)
    else:
        feeds = RSS_FEEDS
    return jsonify({
        'total': len(feeds),
        'feeds': feeds,
        'categories': get_categories()
    })

@app.route('/api/categories')
def api_categories() -> Response:
    return jsonify({
        'categories': get_categories()
    })

@app.route('/api/cache/clear', methods=['POST'])
def api_cache_clear() -> Response:
    with _cache_lock:
        _news_cache.clear()
    return jsonify({
        'status': 'success',
        'message': 'Cache cleared successfully'
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

if __name__ == '__main__':
    host = app.config.get('HOST', '0.0.0.0')
    port = app.config.get('PORT', 5000)
    debug = app.config.get('DEBUG', True)

    logger.info(f"🚀 Starting News Aggregator on http://{host}:{port}")
    logger.info(f"📰 Loaded {len(RSS_FEEDS)} RSS feeds")

    app.run(
        host=host,
        port=port,
        debug=debug,
        threaded=True
    )
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


class Config:
    SECRET_KEY = 'dev-secret-key-change-in-production'
    DEBUG = True
    TESTING = False
    HOST = '0.0.0.0'
    PORT = 5000
    CACHE_TIMEOUT = 300
    CACHE_MAX_SIZE = 200
    MAX_ITEMS_PER_FEED = 30
    REQUEST_TIMEOUT = (15.0, 30.0)
    MAX_WORKERS = 15
    USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    TRANSLATION_API = 'https://api.mymemory.translated.net/get'
    DEFAULT_LANGUAGE = 'fa'

    RSS_FEEDS = [
        # همشهری آنلاین (۸ فید)
        {'name': 'همشهری آنلاین', 'url': 'https://www.hamshahrionline.ir/rss', 'icon': '🇮🇷', 'color': '#e53e3e', 'category': 'iran'},
        {'name': 'همشهری - سیاسی', 'url': 'https://www.hamshahrionline.ir/rss/tp/6', 'icon': '🏛️', 'color': '#e53e3e', 'category': 'politics'},
        {'name': 'همشهری - اقتصادی', 'url': 'https://www.hamshahrionline.ir/rss/tp/10', 'icon': '💰', 'color': '#e53e3e', 'category': 'business'},
        {'name': 'همشهری - ورزشی', 'url': 'https://www.hamshahrionline.ir/rss/tp/9', 'icon': '⚽', 'color': '#e53e3e', 'category': 'sports'},
        {'name': 'همشهری - فرهنگی', 'url': 'https://www.hamshahrionline.ir/rss/tp/26', 'icon': '🎭', 'color': '#e53e3e', 'category': 'culture'},
        {'name': 'همشهری - جهان', 'url': 'https://www.hamshahrionline.ir/rss/tp/11', 'icon': '🌍', 'color': '#e53e3e', 'category': 'world'},
        {'name': 'همشهری - دانش', 'url': 'https://www.hamshahrionline.ir/rss/tp/20', 'icon': '🔬', 'color': '#e53e3e', 'category': 'science'},
        {'name': 'همشهری - اجتماعی', 'url': 'https://www.hamshahrionline.ir/rss/tp/5', 'icon': '👥', 'color': '#e53e3e', 'category': 'iran'},
        
        # ایراسین (۴ فید)
        {'name': 'ایراسین - اقتصاد', 'url': 'https://www.irasin.ir/rss/tp/74', 'icon': '💰', 'color': '#2E7D32', 'category': 'business'},
        {'name': 'ایراسین - خودرو', 'url': 'https://www.irasin.ir/rss', 'icon': '🚗', 'color': '#2E7D32', 'category': 'business'},
        {'name': 'ایراسین - انرژی', 'url': 'https://www.irasin.ir/rss/tp/70', 'icon': '⚡', 'color': '#2E7D32', 'category': 'business'},
        {'name': 'ایراسین - تکنولوژی', 'url': 'https://www.irasin.ir/rss/tp/22', 'icon': '💻', 'color': '#2E7D32', 'category': 'tech'},
        
        # ایبنا
        {'name': 'ایبنا - آخرین اخبار', 'url': 'https://www.ibna.ir/rss', 'icon': '📚', 'color': '#4A90D9', 'category': 'culture'},
        
        # بین‌المللی
        {'name': 'Al Jazeera English', 'url': 'https://www.aljazeera.com/xml/rss/all.xml', 'icon': '🟣', 'color': '#8A2BE2', 'category': 'world'},
        {'name': 'Middle East Eye', 'url': 'https://www.middleeasteye.net/rss.xml', 'icon': '🌙', 'color': '#2d3748', 'category': 'middle-east'},
        {'name': 'Guardian World', 'url': 'https://www.theguardian.com/world/rss', 'icon': '📰', 'color': '#052962', 'category': 'world'},
        {'name': 'Guardian Technology', 'url': 'https://www.theguardian.com/us/technology/rss', 'icon': '💻', 'color': '#052962', 'category': 'tech'},
        {'name': 'TechCrunch', 'url': 'https://techcrunch.com/feed/', 'icon': '🚀', 'color': '#1C9B6C', 'category': 'tech'},
        {'name': 'Hacker News', 'url': 'https://hnrss.org/frontpage', 'icon': '💡', 'color': '#FF6600', 'category': 'tech'},
        {'name': 'Wired', 'url': 'https://www.wired.com/feed/rss', 'icon': '⚡', 'color': '#000000', 'category': 'tech'},
        {'name': 'Science Daily', 'url': 'https://www.sciencedaily.com/rss/all.xml', 'icon': '🧪', 'color': '#2196F3', 'category': 'science'},
    ]


class DevelopmentConfig(Config):
    DEBUG = True
    TESTING = False
    CACHE_TIMEOUT = 60
    MAX_ITEMS_PER_FEED = 15
    MAX_WORKERS = 8


class ProductionConfig(Config):
    DEBUG = False
    TESTING = False
    CACHE_TIMEOUT = 600
    MAX_WORKERS = 20
    MAX_ITEMS_PER_FEED = 50


class TestingConfig(Config):
    TESTING = True
    DEBUG = False
    CACHE_TIMEOUT = 10
    MAX_WORKERS = 4
    MAX_ITEMS_PER_FEED = 5
    RSS_FEEDS = Config.RSS_FEEDS[:10]


config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig,
    'default': DevelopmentConfig
}


def get_config(env_name=None):
    if env_name is None:
        env_name = os.getenv('FLASK_ENV', 'default')
    return config.get(env_name, config['default'])


def get_feeds_by_category(category=None):
    feeds = Config.RSS_FEEDS
    if category and category != 'all':
        return [feed for feed in feeds if feed.get('category') == category]
    return feeds


def get_feed_by_name(name):
    for feed in Config.RSS_FEEDS:
        if feed.get('name') == name:
            return feed
    return None


def get_categories():
    categories = set()
    for feed in Config.RSS_FEEDS:
        if feed.get('category'):
            categories.add(feed['category'])
    return sorted(list(categories))


def get_category_count():
    counts = {}
    for feed in Config.RSS_FEEDS:
        category = feed.get('category', 'general')
        counts[category] = counts.get(category, 0) + 1
    return counts


def get_total_feeds():
    return len(Config.RSS_FEEDS)


if __name__ == '__main__':
    print("=" * 50)
    print("📰 News Aggregator - Configuration")
    print("=" * 50)
    print(f"📰 Total Feeds: {get_total_feeds()}")
    print(f"📂 Categories: {get_categories()}")
    print("📊 Category Counts:")
    for cat, count in get_category_count().items():
        print(f"   - {cat}: {count}")
    print("=" * 50)
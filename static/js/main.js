/**
 * News Spot - Main Application (Optimized)
 * با انیمیشن اسکرول، دکمه بازگشت به بالا، لوگوهای شناور و دکمه‌های مودال
 *
 * بهینه‌سازی‌ها:
 * - Batch rendering برای Stream (هر 250ms)
 * - Duplicate check با Set (O(1))
 * - Append-only rendering برای کارت‌های جدید
 * - Event Delegation برای Sidebar
 * - جلوگیری از rebuild مکرر Sidebar و Grid
 */

// ============================================
// Constants
// ============================================
const CONSTANTS = {
    DEFAULT_TITLE: 'بدون عنوان',
    REFRESH_INTERVAL: 300000,
    SEARCH_DEBOUNCE: 200,
    THEME_COLORS: { light: '#f5f0eb', dark: '#0d0a08' },
    SCROLL_THRESHOLD: 300,
    STREAM_BATCH_DELAY: 250,
    CATEGORY_ICONS: {
        'سیاسی': '🏛️', 'سیاست': '🏛️', 'اقتصادی': '💰', 'اقتصاد': '💰',
        'ورزشی': '⚽', 'ورزش': '⚽', 'فناوری': '💻', 'تکنولوژی': '💻',
        'فرهنگی': '🎭', 'فرهنگ و هنر': '🎭', 'بین‌الملل': '🌍', 'جهان': '🌍',
        'علمی': '🔬', 'علم': '🔬', 'سلامت': '🩺', 'پزشکی': '🩺',
        'اجتماعی': '👥', 'حوادث': '🚨', 'متفرقه': '📰'
    }
};

// ============================================
// State
// ============================================
const state = {
    allNews: [],
    filteredNews: [],
    currentCategory: 'all',
    currentView: 'grid',
    searchQuery: '',
    lastFetchTime: 0,
    modalIndex: -1,
    lastFocusedEl: null,
    translationCache: new Map(),
    categoryMap: new Map(),
    currentTheme: 'light',
    observer: null,
    refreshTimer: null,
    clockTimer: null,
    toastTimeout: null,
    totalFeeds: 0,
    isStreaming: false,
    streamNews: [],
    firstBatchReceived: false,
    // NEW: Optimizations
    pendingStreamNews: [],
    renderTimer: null,
    newsKeys: new Set(),
    lastCategorySignature: '',
    sidebarListenerAttached: false
};

// ============================================
// DOM References
// ============================================
const DOM = {
    grid: document.getElementById('newsGrid'),
    countEl: document.getElementById('newsCount'),
    timeEl: document.getElementById('updateTime'),
    searchInput: document.getElementById('searchInput'),
    sidebarCategories: document.getElementById('sidebarCategories'),
    viewToggle: document.getElementById('viewToggle'),
    themeBtn: document.getElementById('themeToggle'),
    refreshBtn: document.getElementById('refreshBtn'),
    toast: document.getElementById('toast'),
    themeColorMeta: document.getElementById('themeColorMeta'),
    clockTime: document.getElementById('clockTime'),
    clockDate: document.getElementById('clockDate'),
    backToTop: document.getElementById('backToTop'),
    loadingOverlay: document.getElementById('loadingOverlay'),
    statusIcon: document.getElementById('statusIcon'),
    statusText: document.getElementById('statusText'),
    statusSub: document.getElementById('statusSub'),
    progressBar: document.getElementById('progressBar'),
    loadedCount: document.getElementById('loadedCount'),
    totalCount: document.getElementById('totalCount'),
    detailItem: document.getElementById('detailItem'),
    statusDot: document.getElementById('statusDot'),
    connectionStatus: document.getElementById('connectionStatus'),
    progressPercent: document.getElementById('progressPercent'),
    feedsGrid: document.getElementById('loadingFeedsGrid'),
    modalOverlay: document.getElementById('modalOverlay'),
    modalContainer: document.getElementById('modalContainer'),
    modalImage: document.getElementById('modalImage'),
    modalImageWrapper: document.getElementById('modalImageWrapper'),
    modalImagePlaceholder: document.getElementById('modalImagePlaceholder'),
    modalImagePlaceholderWrapper: document.getElementById('modalImagePlaceholderWrapper'),
    modalCategory: document.getElementById('modalCategory'),
    modalTitle: document.getElementById('modalTitle'),
    modalSource: document.getElementById('modalSource'),
    modalDate: document.getElementById('modalDate'),
    modalRelDate: document.getElementById('modalRelDate'),
    modalReadTime: document.getElementById('modalReadTime'),
    modalSummary: document.getElementById('modalSummary'),
    modalTranslatedText: document.getElementById('modalTranslatedText'),
    modalTranslateBtn: document.getElementById('modalTranslateBtn'),
    modalShareBtn: document.getElementById('modalShareBtn'),
    modalTags: document.getElementById('modalTags'),
    modalReadMore: document.getElementById('modalReadMore'),
    modalCloseBtn: document.getElementById('modalCloseBtn'),
    modalPrevBtn: document.getElementById('modalPrevBtn'),
    modalNextBtn: document.getElementById('modalNextBtn'),
    modalIndex: document.getElementById('modalIndex'),
    modalSourceBadge: document.getElementById('modalSourceBadge')
};

// ============================================
// Loading Manager
// ============================================
class LoadingManager {
    constructor() {
        this.totalFeeds = 0;
        this.loadedFeeds = 0;
        this.isVisible = false;
    }

    show(totalFeeds = 0) {
        this.totalFeeds = totalFeeds;
        this.loadedFeeds = 0;
        this.isVisible = true;
        DOM.feedsGrid.innerHTML = '';

        DOM.loadingOverlay.classList.add('active');
        DOM.loadingOverlay.classList.remove('fade-out');
        this.updateProgress();
        this.setStatus('connecting');
        document.body.style.overflow = 'hidden';
    }

    hide() {
        this.isVisible = false;
        DOM.loadingOverlay.classList.add('fade-out');
        setTimeout(() => {
            DOM.loadingOverlay.classList.remove('active');
            document.body.style.overflow = '';
        }, 500);
    }

    setStatus(status) {
        const statusMap = {
            'connecting': { icon: '📡', text: 'در حال اتصال به منابع خبری...', sub: 'لطفاً چند لحظه صبر کنید', dot: 'connecting' },
            'fetching': { icon: '🔄', text: 'دریافت اخبار از منابع...', sub: 'در حال پردازش اطلاعات', dot: 'fetching' },
            'processing': { icon: '⚙️', text: 'پردازش اخبار دریافتی...', sub: 'مرتب‌سازی و دسته‌بندی', dot: 'processing' },
            'complete': { icon: '🎉', text: 'بارگذاری کامل شد! ✅', sub: 'اخبار آماده نمایش هستند', dot: 'complete' },
            'first_batch': { icon: '⚡', text: 'اولین اخبار دریافت شد!', sub: 'در حال دریافت بقیه منابع...', dot: 'fetching' },
            'error': { icon: '⚠️', text: 'خطا در دریافت اخبار', sub: 'لطفاً دوباره تلاش کنید', dot: 'error' }
        };

        const msg = statusMap[status] || statusMap.connecting;
        DOM.statusIcon.textContent = msg.icon;
        DOM.statusText.textContent = msg.text;
        DOM.statusSub.textContent = msg.sub;

        DOM.statusDot.className = 'status-dot ' + msg.dot;
        DOM.connectionStatus.textContent =
            status === 'connecting' ? 'در حال اتصال...' :
            status === 'fetching' ? 'دریافت اطلاعات...' :
            status === 'processing' ? 'پردازش...' :
            status === 'complete' ? '✅ تکمیل شد' :
            status === 'first_batch' ? '⚡ دریافت شد' :
            'خطا';
    }

    updateProgress(loaded = null) {
        if (loaded !== null) this.loadedFeeds = loaded;
        const percent = this.totalFeeds > 0 ? (this.loadedFeeds / this.totalFeeds) * 100 : 0;
        DOM.progressBar.style.width = `${Math.min(percent, 100)}%`;
        DOM.loadedCount.textContent = this.loadedFeeds;
        DOM.totalCount.textContent = this.totalFeeds;
        DOM.progressPercent.textContent = `${Math.round(percent)}%`;
    }

    updateDetail(text) {
        DOM.detailItem.textContent = text;
    }

    addFeedChip(name, status = 'success') {
        const chip = document.createElement('span');
        chip.className = `feed-chip ${status}`;
        chip.textContent = status === 'success' ? `✅ ${name}` : `❌ ${name}`;
        DOM.feedsGrid.appendChild(chip);
        DOM.feedsGrid.scrollTop = DOM.feedsGrid.scrollHeight;
    }

    feedLoaded(name) {
        this.loadedFeeds++;
        this.updateProgress();
        this.addFeedChip(name, 'success');
        this.updateDetail(`✅ ${name} دریافت شد`);
    }

    feedFailed(name) {
        this.loadedFeeds++;
        this.updateProgress();
        this.addFeedChip(name, 'failed');
        this.updateDetail(`❌ ${name} - خطا`);
    }

    firstBatch() {
        this.setStatus('first_batch');
        this.updateDetail('⚡ اولین اخبار نمایش داده شدند!');
    }

    complete() {
        this.setStatus('complete');
        this.updateDetail('✅ همه منابع پردازش شدند');
        DOM.progressBar.style.width = '100%';
        DOM.progressPercent.textContent = '100%';
    }

    error(message) {
        this.setStatus('error');
        this.updateDetail(`❌ ${message}`);
    }
}

const loadingManager = new LoadingManager();

// ============================================
// Utility Functions
// ============================================
function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function isSafeUrl(url) {
    return typeof url === 'string' && /^https?:\/\//i.test(url.trim());
}

function debounce(fn, delay) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(null, args), delay);
    };
}

function safeDate(input) {
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
}

function formatAbsoluteDate(input) {
    const d = safeDate(input);
    if (!d) return 'تاریخ نامشخص';
    try {
        return d.toLocaleString('fa-IR', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    } catch (e) {
        return d.toLocaleString();
    }
}

function formatRelativeDate(input) {
    const d = safeDate(input);
    if (!d) return '';
    const diffMs = Date.now() - d.getTime();
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 1) return 'همین الان';
    if (diffMin < 60) return `${diffMin} دقیقه پیش`;
    const diffHour = Math.round(diffMin / 60);
    if (diffHour < 24) return `${diffHour} ساعت پیش`;
    const diffDay = Math.round(diffHour / 24);
    if (diffDay < 30) return `${diffDay} روز پیش`;
    const diffMonth = Math.round(diffDay / 30);
    if (diffMonth < 12) return `${diffMonth} ماه پیش`;
    return `${Math.round(diffMonth / 12)} سال پیش`;
}

function estimateReadMinutes(text) {
    const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 150));
}

function getCategoryIcon(name) {
    return CONSTANTS.CATEGORY_ICONS[name] || '📁';
}

// ============================================
// NEW: Optimized Duplicate Handling
// ============================================
function getNewsKey(item) {
    const title = (item.title || '').trim().toLowerCase();
    const link = (item.link || '').trim();
    return title.length > 10 ? `title:${title}` : `link:${link}`;
}

function addNewsItems(newsItems) {
    if (!Array.isArray(newsItems) || !newsItems.length) return 0;
    let added = 0;
    for (const item of newsItems) {
        if (!item) continue;
        const key = getNewsKey(item);
        if (state.newsKeys.has(key)) continue;
        if (!item.category && item.source) item.category = item.source;
        state.newsKeys.add(key);
        state.allNews.push(item);
        added++;
    }
    return added;
}

// Legacy support: برای fallback که آرایه می‌گیرد
function removeDuplicateNews(newsArray) {
    const uniqueNews = [];
    const seen = new Set();
    for (const item of newsArray) {
        const key = getNewsKey(item);
        if (!seen.has(key)) {
            seen.add(key);
            if (!item.category && item.source) item.category = item.source;
            uniqueNews.push(item);
        }
    }
    return uniqueNews;
}

function extractCategories(newsArray) {
    const cats = new Map();
    cats.set('all', { name: 'همه اخبار', icon: '📰', count: 0 });
    for (const item of newsArray) {
        const category = item.category || item.source || 'متفرقه';
        if (!cats.has(category)) {
            cats.set(category, { name: category, icon: getCategoryIcon(category), count: 0 });
        }
        cats.get(category).count++;
    }
    cats.get('all').count = newsArray.length;
    return cats;
}

// ============================================
// Back to Top Button
// ============================================
function handleScroll() {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    if (scrollTop > CONSTANTS.SCROLL_THRESHOLD) {
        DOM.backToTop.classList.add('visible');
    } else {
        DOM.backToTop.classList.remove('visible');
    }
}

DOM.backToTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

window.addEventListener('scroll', debounce(handleScroll, 50));

// ============================================
// Theme
// ============================================
function setTheme(theme) {
    state.currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    if (DOM.themeColorMeta) {
        DOM.themeColorMeta.setAttribute('content', CONSTANTS.THEME_COLORS[theme] || CONSTANTS.THEME_COLORS.light);
    }
}

const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
setTheme(prefersDark ? 'dark' : 'light');

DOM.themeBtn.addEventListener('click', () => {
    setTheme(state.currentTheme === 'dark' ? 'light' : 'dark');
});

// ============================================
// Clock
// ============================================
function updateClock() {
    const now = new Date();
    try {
        DOM.clockTime.textContent = now.toLocaleTimeString('fa-IR', {
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        DOM.clockDate.textContent = now.toLocaleDateString('fa-IR', {
            weekday: 'long', day: 'numeric', month: 'long'
        });
    } catch (e) {
        DOM.clockTime.textContent = now.toLocaleTimeString();
        DOM.clockDate.textContent = now.toLocaleDateString();
    }
}

// ============================================
// View Toggle
// ============================================
DOM.viewToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const view = btn.dataset.view;
    if (view === state.currentView) return;
    state.currentView = view;
    document.querySelectorAll('#viewToggle button').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
    DOM.grid.classList.toggle('list-view', view === 'list');
    if (state.observer) {
        state.observer.disconnect();
        state.observer = setupIntersectionObserver();
    }
});

// ============================================
// Intersection Observer
// ============================================
function setupIntersectionObserver() {
    const io = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                io.unobserve(entry.target); // OPTIMIZE: فقط یک بار observe
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    });
    document.querySelectorAll('.news-card').forEach(card => io.observe(card));
    return io;
}

// ============================================
// Toast
// ============================================
function showToast(msg) {
    DOM.toast.textContent = msg;
    DOM.toast.classList.add('show');
    clearTimeout(state.toastTimeout);
    state.toastTimeout = setTimeout(() => {
        DOM.toast.classList.remove('show');
    }, 2500);
}

// ============================================
// Streaming Fetch
// ============================================
async function fetchNewsStream() {
    // OPTIMIZE: جلوگیری از چند Stream همزمان
    if (state.isStreaming) return;

    try {
        const feedsResponse = await fetch('/api/feeds');
        const feedsData = await feedsResponse.json();
        state.totalFeeds = feedsData.total || 0;
    } catch (e) {
        state.totalFeeds = 0;
    }

    loadingManager.show(state.totalFeeds || 50);
    state.isStreaming = true;
    state.streamNews = [];
    state.firstBatchReceived = false;
    state.lastFetchTime = Date.now();
    DOM.grid.setAttribute('aria-busy', 'true');

    try {
        const eventSource = new EventSource('/api/news/stream');
        let receivedNews = [];
        let firstBatchSent = false;

        eventSource.onmessage = function(event) {
            try {
                const data = JSON.parse(event.data);

                switch (data.type) {
                    case 'start':
                        loadingManager.updateDetail('🔄 اتصال به منابع خبری...');
                        break;

                    case 'news':
                        if (data.item) {
                            receivedNews.push(data.item);
                            state.streamNews.push(data.item);

                            if (!firstBatchSent) {
                                if (receivedNews.length >= 3) {
                                    firstBatchSent = true;
                                    displayStreamedNews(receivedNews);
                                    loadingManager.firstBatch();
                                    loadingManager.updateDetail(`⚡ ${receivedNews.length} خبر جدید دریافت شد`);
                                }
                            } else {
                                updateStreamedNews(data.item);
                                loadingManager.updateDetail(`📰 ${state.streamNews.length} خبر دریافت شد`);
                            }
                        }
                        break;

                    case 'first_batch':
                        if (!firstBatchSent && receivedNews.length > 0) {
                            firstBatchSent = true;
                            displayStreamedNews(receivedNews);
                            loadingManager.firstBatch();
                            loadingManager.updateDetail(`⚡ ${receivedNews.length} خبر جدید دریافت شد`);
                        }
                        break;

                    case 'progress':
                        if (data.source) {
                            loadingManager.feedLoaded(data.source);
                        }
                        if (data.loaded) {
                            loadingManager.updateDetail(`📰 ${data.loaded} خبر از ${data.feeds_completed} منبع`);
                        }
                        break;

                    case 'error':
                        if (data.source) {
                            loadingManager.feedFailed(data.source);
                        }
                        break;

                    case 'complete':
                        // OPTIMIZE: پاک کردن Timer و flush کردن Queue
                        if (state.renderTimer) {
                            clearTimeout(state.renderTimer);
                            state.renderTimer = null;
                        }
                        if (state.pendingStreamNews.length) {
                            addNewsItems(state.pendingStreamNews.splice(0));
                        }

                        loadingManager.complete();
                        eventSource.close();
                        state.isStreaming = false;
                        finalizeNews();
                        setTimeout(() => loadingManager.hide(), 1000);
                        break;

                    case '[DONE]':
                        eventSource.close();
                        state.isStreaming = false;
                        if (!firstBatchSent && receivedNews.length > 0) {
                            displayStreamedNews(receivedNews);
                            loadingManager.firstBatch();
                        }
                        // OPTIMIZE: flush باقی‌مانده
                        if (state.pendingStreamNews.length) {
                            addNewsItems(state.pendingStreamNews.splice(0));
                            applyFilters();
                        }
                        break;
                }
            } catch (e) {
                console.error('Error parsing stream data:', e);
            }
        };

        eventSource.onerror = function(error) {
            console.error('EventSource error:', error);
            if (!firstBatchSent) {
                eventSource.close();
                state.isStreaming = false;
                loadingManager.error('خطا در اتصال، استفاده از روش معمولی...');
                fetchNewsFallback();
            } else {
                eventSource.close();
                state.isStreaming = false;
                finalizeNews();
                loadingManager.complete();
                setTimeout(() => loadingManager.hide(), 1000);
            }
        };

    } catch (e) {
        console.error('Streaming error:', e);
        loadingManager.error('خطا در دریافت اخبار');
        state.isStreaming = false;
        fetchNewsFallback();
    }
}

// ============================================
// NEW: Batch Render Scheduler
// ============================================
function scheduleStreamRender() {
    if (state.renderTimer) return;

    state.renderTimer = setTimeout(() => {
        state.renderTimer = null;

        if (!state.pendingStreamNews.length) return;

        const batch = state.pendingStreamNews.splice(0);
        const added = addNewsItems(batch);

        if (!added) return;

        state.categoryMap = extractCategories(state.allNews);
        updateSidebar();

        // اگر فیلتر/جستجو فعال است، render کامل
        if (state.currentCategory !== 'all' || state.searchQuery) {
            applyFilters();
        } else {
            // Append-only برای حالت پیش‌فرض
            state.filteredNews = state.allNews;
            appendNewCards(added);
            DOM.countEl.textContent = String(state.filteredNews.length);
        }

        DOM.timeEl.textContent = `⏱️ بروزرسانی: ${formatAbsoluteDate(new Date())}`;
    }, CONSTANTS.STREAM_BATCH_DELAY);
}

// ============================================
// NEW: Append-only Rendering
// ============================================
function buildCardHtml(item, idx) {
    const safeTitle = escapeHtml(item.title || CONSTANTS.DEFAULT_TITLE);
    const safeSummary = escapeHtml(item.summary || 'خلاصه‌ای موجود نیست');
    const safeAuthor = item.author ? escapeHtml(item.author) : '';
    const safeLink = escapeHtml(isSafeUrl(item.link) ? item.link : '#');
    const safeSourceIcon = escapeHtml(item.source_icon || '📰');
    const safeSourceName = escapeHtml(item.source || '');
    const safeCategory = escapeHtml(item.category || item.source || 'متفرقه');
    const tags = Array.isArray(item.tags) ? item.tags : [];
    const relTime = escapeHtml(formatRelativeDate(item.published));
    const transId = `trans-${idx}`;
    const summaryId = `summary-${idx}`;
    const imageHtml = isSafeUrl(item.image)
        ? `<img src="${escapeHtml(item.image)}" alt="${safeTitle}" loading="lazy" decoding="async" data-fallback-icon="${safeSourceIcon}">`
        : `<div class="placeholder-icon" aria-hidden="true">${safeSourceIcon}</div>`;

    return `
        <div class="news-card" id="card-${idx}" data-idx="${idx}" style="--i:${idx % 12}" tabindex="0" role="button" aria-label="نمایش کامل خبر: ${safeTitle}">
            <div class="card-image">
                ${imageHtml}
                ${relTime ? `<span class="time-badge">${relTime}</span>` : ''}
                <span class="source-badge">${safeSourceIcon} ${safeSourceName}</span>
            </div>
            <div class="card-body">
                <div class="card-category">${safeCategory}</div>
                <div class="card-meta-top">
                    <span class="source-name"><span class="icon" aria-hidden="true">${safeSourceIcon}</span>${safeSourceName}</span>
                    <span>${relTime}</span>
                </div>
                <h3 class="card-title">
                    <a href="${safeLink}" target="_blank" rel="noopener noreferrer">${safeTitle}</a>
                </h3>
                <button type="button" class="translate-toggle" data-idx="${idx}">🌐 ترجمه به فارسی</button>
                <div class="translated-text" id="${transId}"></div>
                <p class="card-summary" id="${summaryId}">${safeSummary}</p>
                <div class="card-footer">
                    <div class="tags-container">
                        ${tags.slice(0, 3).map(t => `<span class="tag">#${escapeHtml(String(t).replace(/ /g, '_'))}</span>`).join('')}
                    </div>
                    <div class="card-meta-bottom">
                        ${safeAuthor ? `<span class="author">✍️ ${safeAuthor}</span>` : ''}
                        <a href="${safeLink}" target="_blank" rel="noopener noreferrer" class="read-more">مشاهده کامل →</a>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function appendNewCards(count) {
    if (count <= 0) return;

    const total = state.filteredNews.length;
    const startIdx = total - count;
    const newItems = state.filteredNews.slice(startIdx);

    // ساخت HTML برای فقط کارت‌های جدید
    const html = newItems.map((item, i) => buildCardHtml(item, startIdx + i)).join('');

    // Append به Grid
    DOM.grid.insertAdjacentHTML('beforeend', html);

    // Observe فقط کارت‌های جدید
    if (state.observer) {
        const cards = DOM.grid.querySelectorAll('.news-card');
        for (let i = startIdx; i < cards.length; i++) {
            state.observer.observe(cards[i]);
        }
    }
}

// ============================================
// Update Streamed News (batched)
// ============================================
function updateStreamedNews(newsItem) {
    if (!newsItem) return;
    state.pendingStreamNews.push(newsItem);
    scheduleStreamRender();
}

// ============================================
// Display First Batch
// ============================================
function displayStreamedNews(newsItems) {
    if (!newsItems || newsItems.length === 0) return;

    addNewsItems(newsItems);

    state.categoryMap = extractCategories(state.allNews);
    updateSidebar();
    applyFilters();

    DOM.countEl.textContent = String(state.filteredNews.length);
    DOM.timeEl.textContent = `⏱️ بروزرسانی: ${formatAbsoluteDate(new Date())}`;
    DOM.grid.setAttribute('aria-busy', 'false');
}

// ============================================
// Fallback Fetch (non-streaming)
// ============================================
async function fetchNewsFallback() {
    try {
        const res = await fetch('/api/news');
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const data = await res.json();
        const rawNews = Array.isArray(data.news) ? data.news : [];
        if (!rawNews.length) {
            loadingManager.error('هیچ خبری دریافت نشد');
            setTimeout(() => loadingManager.hide(), 2000);
            return;
        }

        // Reset keys و افزودن با addNewsItems
        state.newsKeys.clear();
        state.allNews = [];
        addNewsItems(rawNews);

        state.categoryMap = extractCategories(state.allNews);
        updateSidebar();
        applyFilters();

        DOM.timeEl.textContent = `⏱️ بروزرسانی: ${formatAbsoluteDate(data.timestamp || new Date())}`;
        loadingManager.complete();
        setTimeout(() => loadingManager.hide(), 1000);
    } catch (e) {
        console.warn('Fetch error:', e);
        loadingManager.error('خطا در دریافت اخبار');
        DOM.timeEl.textContent = `⏱️ بروزرسانی: ${formatAbsoluteDate(new Date())}`;
        showToast('❌ خطا در دریافت اخبار، لطفاً دوباره تلاش کنید');
        setTimeout(() => loadingManager.hide(), 2000);
    } finally {
        DOM.grid.setAttribute('aria-busy', 'false');
    }
}

// ============================================
// Finalize News
// ============================================
function finalizeNews(newsItems = []) {
    // flush باقی‌مانده
    if (state.pendingStreamNews.length) {
        addNewsItems(state.pendingStreamNews.splice(0));
    }

    if (Array.isArray(newsItems) && newsItems.length) {
        addNewsItems(newsItems);
    }

    state.categoryMap = extractCategories(state.allNews);
    updateSidebar();
    applyFilters();

    DOM.countEl.textContent = String(state.filteredNews.length);
    DOM.timeEl.textContent = `⏱️ بروزرسانی: ${formatAbsoluteDate(new Date())}`;
    DOM.grid.setAttribute('aria-busy', 'false');
}

// ============================================
// Sidebar (with Event Delegation)
// ============================================
function getCategorySignature() {
    // امضای سبک برای تشخیص تغییر واقعی دسته‌بندی‌ها
    let sig = '';
    for (const [key, cat] of state.categoryMap) {
        sig += `${key}:${cat.count}|`;
    }
    return sig;
}

function attachSidebarListener() {
    if (state.sidebarListenerAttached) return;

    DOM.sidebarCategories.addEventListener('click', (e) => {
        const btn = e.target.closest('.sidebar-category');
        if (!btn) return;

        document.querySelectorAll('.sidebar-category').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.currentCategory = btn.dataset.category;
        applyFilters();

        if (window.innerWidth <= 1024) {
            const wrapper = document.querySelector('.sidebar-wrapper');
            if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });

    state.sidebarListenerAttached = true;
}

function updateSidebar() {
    // OPTIMIZE: فقط اگر امضا تغییر کرده، rebuild کن
    const sig = getCategorySignature();
    if (sig === state.lastCategorySignature) return;
    state.lastCategorySignature = sig;

    let html = '';
    for (const [key, cat] of state.categoryMap) {
        const isActive = key === state.currentCategory ? 'active' : '';
        html += `
            <button class="sidebar-category ${isActive}" data-category="${escapeHtml(key)}">
                <span class="icon">${cat.icon || '📁'}</span>
                ${escapeHtml(cat.name || key)}
                <span class="count">${cat.count || 0}</span>
            </button>
        `;
    }
    DOM.sidebarCategories.innerHTML = html;

    attachSidebarListener();
}

// ============================================
// Filter & Search
// ============================================
function applyFilters() {
    state.searchQuery = DOM.searchInput.value.trim().toLowerCase();
    state.filteredNews = state.allNews.filter(item => {
        if (state.currentCategory !== 'all') {
            const itemCategory = item.category || item.source || 'متفرقه';
            if (itemCategory !== state.currentCategory) return false;
        }
        if (state.searchQuery) {
            const title = (item.title || '').toLowerCase();
            const summary = (item.summary || '').toLowerCase();
            if (!title.includes(state.searchQuery) && !summary.includes(state.searchQuery)) return false;
        }
        return true;
    });
    renderNews();
}

DOM.searchInput.addEventListener('input', debounce(applyFilters, CONSTANTS.SEARCH_DEBOUNCE));

// ============================================
// Translate
// ============================================
async function translateText(text, targetLang = 'fa') {
    if (!text || text.length < 3) return text;
    try {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${targetLang}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const data = await res.json();
        if (data.responseData && data.responseData.translatedText) {
            return data.responseData.translatedText;
        }
        return text;
    } catch (e) {
        console.error('Translation error:', e);
        return text;
    }
}

async function toggleTranslate(item, btn, summaryEl, transEl) {
    if (!btn || !summaryEl || !transEl) return;
    if (transEl.classList.contains('show')) {
        transEl.classList.remove('show');
        summaryEl.classList.remove('hidden');
        btn.classList.remove('translated');
        btn.textContent = '🌐 ترجمه به فارسی';
        return;
    }
    const cacheKey = item.id || item.link || item.title;
    if (state.translationCache.has(cacheKey)) {
        transEl.textContent = state.translationCache.get(cacheKey);
        transEl.classList.add('show');
        summaryEl.classList.add('hidden');
        btn.classList.add('translated');
        btn.textContent = '🌐 نمایش متن اصلی';
        return;
    }
    const originalLabel = btn.textContent;
    btn.textContent = '⏳ در حال ترجمه...';
    btn.disabled = true;
    try {
        const textToTranslate = `${item.title || ''}\n\n${item.summary || ''}`;
        const translated = await translateText(textToTranslate);
        state.translationCache.set(cacheKey, translated);
        transEl.textContent = translated;
        transEl.classList.add('show');
        summaryEl.classList.add('hidden');
        btn.classList.add('translated');
        btn.textContent = '🌐 نمایش متن اصلی';
    } catch (e) {
        showToast('❌ خطا در ترجمه');
        btn.textContent = originalLabel;
    } finally {
        btn.disabled = false;
    }
}

// ============================================
// Render News (full rebuild - فقط برای filter/search/first batch)
// ============================================
function renderNews() {
    if (!state.filteredNews.length) {
        if (state.isStreaming) return;
        DOM.grid.innerHTML = `
            <div class="empty-state">
                <span class="icon" aria-hidden="true">📭</span>
                <h3>خبری یافت نشد</h3>
                <p>سعی کنید جستجوی خود را تغییر دهید یا دسته‌بندی دیگری را انتخاب کنید.</p>
            </div>
        `;
        DOM.countEl.textContent = '0';
        return;
    }

    DOM.countEl.textContent = String(state.filteredNews.length);
    DOM.grid.innerHTML = state.filteredNews.map((item, idx) => buildCardHtml(item, idx)).join('');

    setupGridEventDelegation();

    if (state.observer) state.observer.disconnect();
    state.observer = setupIntersectionObserver();
}

// ============================================
// Grid Event Delegation
// ============================================
function setupGridEventDelegation() {
    DOM.grid.removeEventListener('click', handleGridClick);
    DOM.grid.removeEventListener('keydown', handleGridKeydown);
    DOM.grid.removeEventListener('error', handleGridError, true);
    DOM.grid.removeEventListener('load', handleGridLoad, true);
    DOM.grid.addEventListener('click', handleGridClick);
    DOM.grid.addEventListener('keydown', handleGridKeydown);
    DOM.grid.addEventListener('error', handleGridError, true);
    DOM.grid.addEventListener('load', handleGridLoad, true);
}

function handleGridClick(e) {
    const translateBtn = e.target.closest('.translate-toggle');
    if (translateBtn) {
        const idx = Number(translateBtn.dataset.idx);
        const item = state.filteredNews[idx];
        if (!item) return;
        const summaryEl = document.getElementById(`summary-${idx}`);
        const transEl = document.getElementById(`trans-${idx}`);
        if (!summaryEl || !transEl) return;
        toggleTranslate(item, translateBtn, summaryEl, transEl);
        return;
    }
    const link = e.target.closest('a');
    if (link) return;
    const card = e.target.closest('.news-card');
    if (card) {
        const idx = Number(card.dataset.idx);
        openModal(idx, card);
    }
}

function handleGridKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.news-card');
    if (!card) return;
    e.preventDefault();
    const idx = Number(card.dataset.idx);
    openModal(idx, card);
}

function handleGridError(e) {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    const wrap = img.closest('.card-image');
    if (!wrap) return;
    const icon = img.dataset.fallbackIcon || '📰';
    img.remove();
    const placeholder = document.createElement('div');
    placeholder.className = 'placeholder-icon';
    placeholder.setAttribute('aria-hidden', 'true');
    placeholder.textContent = icon;
    wrap.prepend(placeholder);
}

function handleGridLoad(e) {
    const img = e.target;
    if (img instanceof HTMLImageElement) {
        img.classList.add('loaded');
    }
}

// ============================================
// Modal - با دکمه‌های قبلی/بعدی
// ============================================
function renderModalFor(idx) {
    const item = state.filteredNews[idx];
    if (!item) return;
    state.modalIndex = idx;

    DOM.modalTitle.textContent = item.title || CONSTANTS.DEFAULT_TITLE;
    const catName = item.category || item.source || 'متفرقه';
    DOM.modalCategory.textContent = catName;
    DOM.modalCategory.style.color = item.source_color || 'var(--accent-primary)';

    const sourceIcon = item.source_icon || '📰';
    const sourceName = item.source || 'منبع ناشناخته';
    DOM.modalSource.textContent = `${sourceIcon} ${sourceName}`;
    DOM.modalSourceBadge.textContent = `${sourceIcon} ${sourceName}`;

    DOM.modalDate.textContent = formatAbsoluteDate(item.published);
    DOM.modalRelDate.textContent = formatRelativeDate(item.published);
    DOM.modalReadTime.textContent = `⏳ ${estimateReadMinutes(item.summary)} دقیقه مطالعه`;

    DOM.modalSummary.textContent = item.summary || 'خلاصه‌ای موجود نیست';
    DOM.modalTranslatedText.textContent = '';
    DOM.modalTranslatedText.classList.remove('show');
    DOM.modalSummary.classList.remove('hidden');
    DOM.modalTranslateBtn.classList.remove('translated');
    DOM.modalTranslateBtn.textContent = '🌐 ترجمه';

    if (isSafeUrl(item.image)) {
        DOM.modalImage.src = item.image;
        DOM.modalImage.alt = item.title || 'تصویر خبر';
        DOM.modalImageWrapper.style.display = 'block';
        DOM.modalImagePlaceholderWrapper.style.display = 'none';
    } else {
        DOM.modalImageWrapper.style.display = 'none';
        DOM.modalImagePlaceholderWrapper.style.display = 'block';
        DOM.modalImagePlaceholder.textContent = sourceIcon;
    }

    const tags = Array.isArray(item.tags) ? item.tags : [];
    if (tags.length > 0) {
        DOM.modalTags.innerHTML = tags.slice(0, 5).map(t =>
            `<span class="tag">#${escapeHtml(String(t).replace(/ /g, '_'))}</span>`
        ).join('');
        DOM.modalTags.style.display = 'flex';
    } else {
        DOM.modalTags.style.display = 'none';
    }

    const safeLink = isSafeUrl(item.link) ? item.link : '';
    if (safeLink) {
        DOM.modalReadMore.href = safeLink;
        DOM.modalReadMore.style.pointerEvents = '';
        DOM.modalReadMore.style.opacity = '';
    } else {
        DOM.modalReadMore.href = '#';
        DOM.modalReadMore.style.opacity = '0.5';
        DOM.modalReadMore.style.pointerEvents = 'none';
    }

    DOM.modalIndex.textContent = `${idx + 1} / ${state.filteredNews.length}`;
    DOM.modalPrevBtn.disabled = idx <= 0;
    DOM.modalNextBtn.disabled = idx >= state.filteredNews.length - 1;
}

function openModal(idx, triggerEl) {
    const item = state.filteredNews[idx];
    if (!item) return;
    state.lastFocusedEl = triggerEl || document.activeElement;
    renderModalFor(idx);
    DOM.modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    setTimeout(() => DOM.modalCloseBtn.focus(), 100);
}

function closeModal() {
    DOM.modalOverlay.classList.remove('active');
    document.body.style.overflow = '';
    state.modalIndex = -1;
    if (state.lastFocusedEl && typeof state.lastFocusedEl.focus === 'function') {
        state.lastFocusedEl.focus();
    }
}

function closeModalOutside(event) {
    if (event.target === DOM.modalOverlay) closeModal();
}

function showPrevModal() {
    if (state.modalIndex > 0) {
        renderModalFor(state.modalIndex - 1);
        DOM.modalPrevBtn.focus();
    }
}

function showNextModal() {
    if (state.modalIndex < state.filteredNews.length - 1) {
        renderModalFor(state.modalIndex + 1);
        DOM.modalNextBtn.focus();
    }
}

// Event Listeners مودال
DOM.modalCloseBtn.addEventListener('click', closeModal);
DOM.modalPrevBtn.addEventListener('click', showPrevModal);
DOM.modalNextBtn.addEventListener('click', showNextModal);

// دکمه ترجمه در مودال
DOM.modalTranslateBtn.addEventListener('click', () => {
    const item = state.filteredNews[state.modalIndex];
    if (!item) return;
    toggleTranslate(item, DOM.modalTranslateBtn, DOM.modalSummary, DOM.modalTranslatedText);
});

// دکمه اشتراک‌گذاری
DOM.modalShareBtn.addEventListener('click', async () => {
    const item = state.filteredNews[state.modalIndex];
    if (!item) return;
    const shareUrl = isSafeUrl(item.link) ? item.link : window.location.href;
    try {
        if (navigator.share) {
            await navigator.share({
                title: item.title || CONSTANTS.DEFAULT_TITLE,
                text: item.summary || '',
                url: shareUrl
            });
        } else if (navigator.clipboard) {
            await navigator.clipboard.writeText(shareUrl);
            showToast('🔗 لینک کپی شد');
        } else {
            showToast('امکان اشتراک‌گذاری وجود ندارد');
        }
    } catch (e) {}
});

// کیبورد در مودال
document.addEventListener('keydown', (e) => {
    if (!DOM.modalOverlay.classList.contains('active')) return;

    if (e.key === 'Escape') {
        closeModal();
        return;
    }
    if (e.key === 'ArrowRight') {
        e.preventDefault();
        showPrevModal();
        return;
    }
    if (e.key === 'ArrowLeft') {
        e.preventDefault();
        showNextModal();
        return;
    }
    if (e.key === 'Tab') {
        const focusables = DOM.modalContainer.querySelectorAll(
            'button:not(:disabled), a[href]:not([style*="pointer-events: none"])'
        );
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }
});

// ============================================
// Auto Refresh
// ============================================
function scheduleAutoRefresh() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(() => {
        if (document.visibilityState === 'visible' && !state.isStreaming) {
            fetchNewsStream();
        }
    }, CONSTANTS.REFRESH_INTERVAL);
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' &&
        Date.now() - state.lastFetchTime >= CONSTANTS.REFRESH_INTERVAL &&
        !state.isStreaming) {
        fetchNewsStream();
    }
});

// ============================================
// Init
// ============================================
function init() {
    updateClock();
    state.clockTimer = setInterval(updateClock, 1000);
    attachSidebarListener(); // یک بار برای همیشه
    fetchNewsStream();
    scheduleAutoRefresh();
    handleScroll();

    DOM.refreshBtn.addEventListener('click', () => {
        if (state.isStreaming) return;
        fetchNewsStream();
    });

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
            e.preventDefault();
            if (!state.isStreaming) fetchNewsStream();
        }
    });

    console.log('📰 News Spot v8.1 — Batched Stream + Append-only Rendering ⚡');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
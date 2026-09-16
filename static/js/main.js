/**
 * News Spot - Main Application v10
 * بهینه‌سازی‌شده برای سرعت، Cache-Aware Loading، و تغییر تم بدون هنگ
 */

'use strict';

// ============================================
// Constants
// ============================================
const CONSTANTS = Object.freeze({
    DEFAULT_TITLE: 'بدون عنوان',
    REFRESH_INTERVAL: 300000,
    SEARCH_DEBOUNCE: 200,
    STREAM_BATCH_DELAY: 250,
    SCROLL_THRESHOLD: 300,
    THEME_COLORS: { light: '#f8f5f0', dark: '#0d0a08' },
    THEME_SWITCH_DURATION: 100,
    CARD_SETTLE_DELAY: 800,
    CATEGORY_ICONS: Object.freeze({
        'سیاسی': '🏛️', 'سیاست': '🏛️', 'اقتصادی': '💰', 'اقتصاد': '💰',
        'ورزشی': '⚽', 'ورزش': '⚽', 'فناوری': '💻', 'تکنولوژی': '💻',
        'فرهنگی': '🎭', 'فرهنگ و هنر': '🎭', 'بین‌الملل': '🌍', 'جهان': '🌍',
        'علمی': '🔬', 'علم': '🔬', 'سلامت': '🩺', 'پزشکی': '🩺',
        'اجتماعی': '👥', 'حوادث': '🚨', 'متفرقه': '📰'
    })
});

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
    isStreaming: false,
    streamNews: [],
    pendingStreamNews: [],
    renderTimer: null,
    newsKeys: new Set(),
    lastCategorySignature: '',
    cacheState: 'unknown',
    isBackgroundRefresh: false,
    statusStripDismissed: false,
    themeSwitchTimer: null
};

// ============================================
// DOM References (batch query for speed)
// ============================================
const $ = (id) => document.getElementById(id);
const DOM = {
    grid: $('newsGrid'),
    countEl: $('newsCount'),
    timeEl: $('updateTime'),
    searchInput: $('searchInput'),
    sidebarCategories: $('sidebarCategories'),
    viewToggle: $('viewToggle'),
    themeBtn: $('themeToggle'),
    refreshBtn: $('refreshBtn'),
    toast: $('toast'),
    themeColorMeta: $('themeColorMeta'),
    clockTime: $('clockTime'),
    clockDate: $('clockDate'),
    backToTop: $('backToTop'),
    statusStrip: $('statusStrip'),
    statusStripText: $('statusStripText'),
    statusPulse: $('statusPulse'),
    statusMiniFill: $('statusMiniFill'),
    statusMiniText: $('statusMiniText'),
    statusStripClose: $('statusStripClose'),
    statusStripChips: $('statusStripChips'),
    refreshBadge: $('refreshBadge'),
    refreshBadgeText: $('refreshBadgeText'),
    modalOverlay: $('modalOverlay'),
    modalContainer: $('modalContainer'),
    modalImage: $('modalImage'),
    modalImageWrapper: $('modalImageWrapper'),
    modalImagePlaceholder: $('modalImagePlaceholder'),
    modalImagePlaceholderWrapper: $('modalImagePlaceholderWrapper'),
    modalCategory: $('modalCategory'),
    modalTitle: $('modalTitle'),
    modalSource: $('modalSource'),
    modalDate: $('modalDate'),
    modalRelDate: $('modalRelDate'),
    modalReadTime: $('modalReadTime'),
    modalSummary: $('modalSummary'),
    modalTranslatedText: $('modalTranslatedText'),
    modalTranslateBtn: $('modalTranslateBtn'),
    modalShareBtn: $('modalShareBtn'),
    modalTags: $('modalTags'),
    modalReadMore: $('modalReadMore'),
    modalCloseBtn: $('modalCloseBtn'),
    modalPrevBtn: $('modalPrevBtn'),
    modalNextBtn: $('modalNextBtn'),
    modalIndex: $('modalIndex'),
    modalSourceBadge: $('modalSourceBadge')
};

// ============================================
// Utility Functions (optimized)
// ============================================
const escapeHtml = (value) => {
    if (value == null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

const isSafeUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url.trim());

const debounce = (fn, delay) => {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
};

const throttle = (fn, delay) => {
    let last = 0;
    let timer = null;
    return (...args) => {
        const now = Date.now();
        const remaining = delay - (now - last);
        if (remaining <= 0) {
            clearTimeout(timer);
            timer = null;
            last = now;
            fn(...args);
        } else if (!timer) {
            timer = setTimeout(() => {
                last = Date.now();
                timer = null;
                fn(...args);
            }, remaining);
        }
    };
};

const safeDate = (input) => {
    if (!input) return null;
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
};

const formatAbsoluteDate = (input) => {
    const d = safeDate(input);
    if (!d) return 'تاریخ نامشخص';
    try {
        return d.toLocaleString('fa-IR', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    } catch { return d.toLocaleString(); }
};

const formatRelativeDate = (input) => {
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
};

const estimateReadMinutes = (text) => {
    const words = (text || '').trim().split(/\s+/).length;
    return Math.max(1, Math.round(words / 150));
};

const getCategoryIcon = (name) => CONSTANTS.CATEGORY_ICONS[name] || '📁';

const getNewsKey = (item) => {
    const title = (item.title || '').trim().toLowerCase();
    const link = (item.link || '').trim();
    return title.length > 10 ? `t:${title}` : `l:${link}`;
};

const addNewsItems = (newsItems) => {
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
};

const extractCategories = (newsArray) => {
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
};

// ============================================
// Theme Manager (optimized — no freeze!)
// ============================================
const ThemeManager = {
    init() {
        // تشخیص تم اولیه
        const saved = localStorage.getItem('newsSpotTheme');
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        const theme = saved || (prefersDark ? 'dark' : 'light');
        this.apply(theme, false);

        // گوش دادن به تغییر سیستم
        if (window.matchMedia) {
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
                if (!localStorage.getItem('newsSpotTheme')) {
                    this.apply(e.matches ? 'dark' : 'light', true);
                }
            });
        }
    },

    toggle() {
        const newTheme = state.currentTheme === 'dark' ? 'light' : 'dark';
        this.apply(newTheme, true);
        localStorage.setItem('newsSpotTheme', newTheme);
    },

    apply(theme, animate = true) {
        state.currentTheme = theme;

        if (animate) {
            // ⚡ کلید اصلی: disable همه transition ها در لحظه تغییر
            document.documentElement.classList.add('theme-switching');

            clearTimeout(state.themeSwitchTimer);
            state.themeSwitchTimer = setTimeout(() => {
                document.documentElement.classList.remove('theme-switching');
            }, CONSTANTS.THEME_SWITCH_DURATION);
        }

        // اعمال تم در یک frame واحد
        requestAnimationFrame(() => {
            document.documentElement.setAttribute('data-theme', theme);
            if (DOM.themeColorMeta) {
                DOM.themeColorMeta.setAttribute('content',
                    theme === 'dark' ? CONSTANTS.THEME_COLORS.dark : CONSTANTS.THEME_COLORS.light
                );
            }
        });
    }
};

// ============================================
// IntersectionObserver (optimized)
// ============================================
const observerCallback = (entries, observer) => {
    for (const entry of entries) {
        if (entry.isIntersecting) {
            const card = entry.target;
            card.classList.add('visible');
            observer.unobserve(card);

            // بعد از انیمیشن، will-change رو پاک کن
            setTimeout(() => card.classList.add('settled'), CONSTANTS.CARD_SETTLE_DELAY);
        }
    }
};

const createObserver = () => new IntersectionObserver(observerCallback, {
    threshold: 0.05,
    rootMargin: '100px 0px 100px 0px'
});

const observeNewCards = (fromIndex = 0) => {
    if (!state.observer) return;
    const cards = DOM.grid.querySelectorAll('.news-card');
    for (let i = fromIndex; i < cards.length; i++) {
        state.observer.observe(cards[i]);
    }
};

// ============================================
// Toast
// ============================================
const showToast = (msg, duration = 2500) => {
    DOM.toast.textContent = msg;
    DOM.toast.classList.add('show');
    clearTimeout(state.toastTimeout);
    state.toastTimeout = setTimeout(() => DOM.toast.classList.remove('show'), duration);
};

// ============================================
// Status Strip Manager
// ============================================
const statusStrip = {
    chipCount: 0,
    autoHideTimer: null,

    show(message, { complete = false, error = false } = {}) {
        if (state.statusStripDismissed) return;
        clearTimeout(this.autoHideTimer);
        DOM.statusStrip.hidden = false;
        DOM.statusStripText.textContent = message;
        DOM.statusPulse.className = 'status-pulse' +
            (complete ? ' complete' : '') +
            (error ? ' error' : '');
    },

    updateProgress(loaded, total) {
        const percent = total > 0 ? Math.min((loaded / total) * 100, 100) : 0;
        DOM.statusMiniFill.style.width = `${percent}%`;
        DOM.statusMiniText.textContent = `${loaded} / ${total}`;
    },

    addChip(name, success = true) {
        this.chipCount++;
        const chip = document.createElement('span');
        chip.className = 'chip ' + (success ? 'success' : 'failed');
        chip.textContent = (success ? '✅ ' : '❌ ') + name;
        DOM.statusStripChips.appendChild(chip);
        DOM.statusStripChips.classList.add('expanded');
        DOM.statusStripChips.scrollTop = DOM.statusStripChips.scrollHeight;
    },

    complete(message = '✅ همه اخبار دریافت شد') {
        this.show(message, { complete: true });
        this.autoHideTimer = setTimeout(() => this.hide(), 2500);
    },

    error(message) {
        this.show(message, { error: true });
        this.autoHideTimer = setTimeout(() => this.hide(), 4000);
    },

    hide() {
        DOM.statusStrip.hidden = true;
        DOM.statusStripChips.innerHTML = '';
        DOM.statusStripChips.classList.remove('expanded');
        this.chipCount = 0;
    },

    dismiss() {
        state.statusStripDismissed = true;
        this.hide();
    }
};

DOM.statusStripClose?.addEventListener('click', () => statusStrip.dismiss());

// ============================================
// Refresh Badge
// ============================================
const refreshBadge = {
    show(text = 'در حال بروزرسانی اخبار...') {
        DOM.refreshBadgeText.textContent = text;
        DOM.refreshBadge.hidden = false;
    },
    hide() {
        DOM.refreshBadge.hidden = true;
    }
};

// ============================================
// Card Builder (extracted for reuse)
// ============================================
const buildCardHtml = (item, idx) => {
    const safeTitle = escapeHtml(item.title || CONSTANTS.DEFAULT_TITLE);
    const safeSummary = escapeHtml(item.summary || 'خلاصه‌ای موجود نیست');
    const safeAuthor = item.author ? escapeHtml(item.author) : '';
    const safeLink = escapeHtml(isSafeUrl(item.link) ? item.link : '#');
    const safeSourceIcon = escapeHtml(item.source_icon || '📰');
    const safeSourceName = escapeHtml(item.source || '');
    const safeCategory = escapeHtml(item.category || item.source || 'متفرقه');
    const tags = Array.isArray(item.tags) ? item.tags : [];
    const relTime = escapeHtml(formatRelativeDate(item.published));
    const imageHtml = isSafeUrl(item.image)
        ? `<img src="${escapeHtml(item.image)}" alt="${safeTitle}" loading="lazy" decoding="async" data-fallback-icon="${safeSourceIcon}">`
        : `<div class="placeholder-icon" aria-hidden="true">${safeSourceIcon}</div>`;

    return `<div class="news-card" id="card-${idx}" data-idx="${idx}" tabindex="0" role="button" aria-label="نمایش کامل خبر: ${safeTitle}">
        <div class="card-image">
            ${imageHtml}
            ${relTime ? `<span class="time-badge">${relTime}</span>` : ''}
            <span class="source-badge">${safeSourceIcon} ${safeSourceName}</span>
        </div>
        <div class="card-body">
            <div class="card-category">${safeCategory}</div>
            <div class="card-meta-top">
                <span>${safeSourceIcon} ${safeSourceName}</span>
                <span>${relTime}</span>
            </div>
            <h3 class="card-title"><a href="${safeLink}" target="_blank" rel="noopener noreferrer">${safeTitle}</a></h3>
            <button type="button" class="translate-toggle" data-idx="${idx}">🌐 ترجمه</button>
            <div class="translated-text" id="trans-${idx}"></div>
            <p class="card-summary" id="summary-${idx}">${safeSummary}</p>
            <div class="card-footer">
                <div class="tags-container">
                    ${tags.slice(0, 3).map(t => `<span class="tag">#${escapeHtml(String(t).replace(/ /g, '_'))}</span>`).join('')}
                </div>
                <div class="card-meta-bottom">
                    ${safeAuthor ? `<span>✍️ ${safeAuthor}</span>` : ''}
                    <a href="${safeLink}" target="_blank" rel="noopener noreferrer" class="read-more">مشاهده کامل →</a>
                </div>
            </div>
        </div>
    </div>`;
};

// ============================================
// Render Functions
// ============================================
const renderSkeletons = (count = 6) => {
    const html = Array(count).fill(0).map(() =>
        `<div class="skeleton" aria-hidden="true"><div class="skeleton-img"></div><div class="skeleton-line long"></div><div class="skeleton-line medium"></div><div class="skeleton-line short"></div></div>`
    ).join('');
    DOM.grid.innerHTML = html;
};

const renderNews = () => {
    if (!state.filteredNews.length) {
        if (state.isStreaming) return;
        DOM.grid.innerHTML = `<div class="empty-state"><span class="icon" aria-hidden="true">📭</span><h3>خبری یافت نشد</h3><p>سعی کنید جستجوی خود را تغییر دهید.</p></div>`;
        DOM.countEl.textContent = '0';
        return;
    }

    DOM.countEl.textContent = String(state.filteredNews.length);
    DOM.grid.innerHTML = state.filteredNews.map((item, i) => buildCardHtml(item, i)).join('');

    if (state.observer) state.observer.disconnect();
    state.observer = createObserver();
    observeNewCards(0);
};

const appendNewCards = (count) => {
    if (count <= 0) return;
    const total = state.filteredNews.length;
    const startIdx = total - count;
    const newItems = state.filteredNews.slice(startIdx);

    const html = newItems.map((item, i) => buildCardHtml(item, startIdx + i)).join('');
    DOM.grid.insertAdjacentHTML('beforeend', html);
    observeNewCards(startIdx);
};

// ============================================
// Filters
// ============================================
const applyFilters = () => {
    state.searchQuery = DOM.searchInput.value.trim().toLowerCase();
    const cat = state.currentCategory;
    const query = state.searchQuery;

    if (cat === 'all' && !query) {
        state.filteredNews = state.allNews;
    } else {
        state.filteredNews = state.allNews.filter(item => {
            if (cat !== 'all') {
                const itemCat = item.category || item.source || 'متفرقه';
                if (itemCat !== cat) return false;
            }
            if (query) {
                const title = (item.title || '').toLowerCase();
                const summary = (item.summary || '').toLowerCase();
                if (!title.includes(query) && !summary.includes(query)) return false;
            }
            return true;
        });
    }
    renderNews();
};

const onSearchInput = debounce(applyFilters, CONSTANTS.SEARCH_DEBOUNCE);

// ============================================
// Sidebar (Event Delegation)
// ============================================
const getCategorySignature = () => {
    let sig = '';
    for (const [key, cat] of state.categoryMap) sig += `${key}:${cat.count}|`;
    return sig;
};

const updateSidebar = () => {
    const sig = getCategorySignature();
    if (sig === state.lastCategorySignature) return;
    state.lastCategorySignature = sig;

    let html = '';
    for (const [key, cat] of state.categoryMap) {
        const isActive = key === state.currentCategory ? 'active' : '';
        html += `<button class="sidebar-category ${isActive}" data-category="${escapeHtml(key)}">
            <span class="icon">${cat.icon || '📁'}</span>
            ${escapeHtml(cat.name || key)}
            <span class="count">${cat.count || 0}</span>
        </button>`;
    }
    DOM.sidebarCategories.innerHTML = html;
};

const handleSidebarClick = (e) => {
    const btn = e.target.closest('.sidebar-category');
    if (!btn) return;
    if (btn.classList.contains('active')) return;

    state.currentCategory = btn.dataset.category;
    document.querySelectorAll('.sidebar-category').forEach(b =>
        b.classList.toggle('active', b === btn)
    );
    applyFilters();

    if (window.innerWidth <= 1024) {
        document.querySelector('.sidebar-wrapper')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
};

// ============================================
// Grid Event Delegation (single listener)
// ============================================
const handleGridClick = (e) => {
    const translateBtn = e.target.closest('.translate-toggle');
    if (translateBtn) {
        const idx = Number(translateBtn.dataset.idx);
        const item = state.filteredNews[idx];
        if (!item) return;
        const summaryEl = document.getElementById(`summary-${idx}`);
        const transEl = document.getElementById(`trans-${idx}`);
        if (summaryEl && transEl) toggleTranslate(item, translateBtn, summaryEl, transEl);
        return;
    }
    if (e.target.closest('a')) return;
    const card = e.target.closest('.news-card');
    if (card) openModal(Number(card.dataset.idx), card);
};

const handleGridKeydown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.news-card');
    if (!card) return;
    e.preventDefault();
    openModal(Number(card.dataset.idx), card);
};

const handleGridError = (e) => {
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
};

const handleGridLoad = (e) => {
    if (e.target instanceof HTMLImageElement) e.target.classList.add('loaded');
};

// ============================================
// Translate
// ============================================
const translateCache = new Map();

async function translateText(text, targetLang = 'fa') {
    if (!text || text.length < 3) return text;
    const cacheKey = `${targetLang}:${text.slice(0, 100)}`;
    if (translateCache.has(cacheKey)) return translateCache.get(cacheKey);

    try {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${targetLang}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const translated = data.responseData?.translatedText || text;
        translateCache.set(cacheKey, translated);
        return translated;
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
        btn.textContent = '🌐 ترجمه';
        return;
    }

    const cacheKey = item.id || item.link || item.title;
    if (state.translationCache.has(cacheKey)) {
        transEl.textContent = state.translationCache.get(cacheKey);
        transEl.classList.add('show');
        summaryEl.classList.add('hidden');
        btn.classList.add('translated');
        btn.textContent = '🌐 متن اصلی';
        return;
    }

    const originalLabel = btn.textContent;
    btn.textContent = '⏳ در حال ترجمه...';
    btn.disabled = true;

    try {
        const text = `${item.title || ''}\n\n${item.summary || ''}`;
        const translated = await translateText(text);
        state.translationCache.set(cacheKey, translated);
        transEl.textContent = translated;
        transEl.classList.add('show');
        summaryEl.classList.add('hidden');
        btn.classList.add('translated');
        btn.textContent = '🌐 متن اصلی';
    } catch {
        showToast('❌ خطا در ترجمه');
        btn.textContent = originalLabel;
    } finally {
        btn.disabled = false;
    }
}

// ============================================
// Modal
// ============================================
function renderModalFor(idx) {
    const item = state.filteredNews[idx];
    if (!item) return;
    state.modalIndex = idx;

    DOM.modalTitle.textContent = item.title || CONSTANTS.DEFAULT_TITLE;
    const catName = item.category || item.source || 'متفرقه';
    DOM.modalCategory.textContent = catName;
    DOM.modalCategory.style.color = item.source_color || 'var(--accent-primary)';

    const icon = item.source_icon || '📰';
    const srcName = item.source || 'منبع ناشناخته';
    DOM.modalSource.textContent = `${icon} ${srcName}`;
    DOM.modalSourceBadge.textContent = `${icon} ${srcName}`;
    DOM.modalDate.textContent = formatAbsoluteDate(item.published);
    DOM.modalRelDate.textContent = formatRelativeDate(item.published);
    DOM.modalReadTime.textContent = `⏳ ${estimateReadMinutes(item.summary)} دقیقه`;

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
        DOM.modalImagePlaceholder.textContent = icon;
    }

    const tags = Array.isArray(item.tags) ? item.tags : [];
    if (tags.length) {
        DOM.modalTags.innerHTML = tags.slice(0, 5)
            .map(t => `<span class="tag">#${escapeHtml(String(t).replace(/ /g, '_'))}</span>`)
            .join('');
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
    requestAnimationFrame(() => DOM.modalCloseBtn.focus({ preventScroll: true }));
}

function closeModal() {
    DOM.modalOverlay.classList.remove('active');
    document.body.style.overflow = '';
    state.modalIndex = -1;
    if (state.lastFocusedEl?.focus) state.lastFocusedEl.focus({ preventScroll: true });
}

function showPrevModal() {
    if (state.modalIndex > 0) {
        renderModalFor(state.modalIndex - 1);
        DOM.modalPrevBtn.focus({ preventScroll: true });
    }
}

function showNextModal() {
    if (state.modalIndex < state.filteredNews.length - 1) {
        renderModalFor(state.modalIndex + 1);
        DOM.modalNextBtn.focus({ preventScroll: true });
    }
}

// ============================================
// Fetch Logic (Cache-Aware)
// ============================================
async function fetchNewsStream() {
    if (state.isStreaming || state.isBackgroundRefresh) return;

    let cacheStatus = { is_fresh: false, is_fetching: false, news_count: 0 };
    try {
        const res = await fetch('/api/feeds');
        const data = await res.json();
        state.totalFeeds = data.total || 0;
        if (data.cache) cacheStatus = data.cache;
    } catch (e) {
        console.warn('Could not fetch feeds status:', e);
    }

    if (cacheStatus.is_fresh && cacheStatus.news_count > 0) {
        // 🟢 حالت A: cache گرم → فوری
        state.cacheState = 'fresh';
        await loadFromCache();
    } else if (cacheStatus.is_fetching) {
        // 🟡 حالت B: fetch در جریان
        state.cacheState = 'fetching';
        await startStreamingWithStatus();
    } else {
        // 🔴 حالت C: cache خالی → trigger
        state.cacheState = 'empty';
        await startStreamingWithStatus();
    }
}

async function loadFromCache() {
    try {
        const res = await fetch('/api/news');
        const data = await res.json();

        if (data.news?.length > 0) {
            state.newsKeys.clear();
            state.allNews = [];
            addNewsItems(data.news);

            state.categoryMap = extractCategories(state.allNews);
            updateSidebar();
            applyFilters();
            DOM.timeEl.textContent = `⏱️ بروزرسانی: ${formatAbsoluteDate(data.timestamp)}`;
        }
    } catch (e) {
        console.error('loadFromCache error:', e);
        await startStreamingWithStatus();
    }
}

async function startStreamingWithStatus() {
    state.isStreaming = true;
    state.streamNews = [];
    state.pendingStreamNews = [];
    state.lastFetchTime = Date.now();
    state.statusStripDismissed = false;

    // فقط اگر grid خالی است، skeleton نشون بده
    if (!state.allNews.length) {
        renderSkeletons(6);
    }

    statusStrip.show('📡 در حال اتصال به منابع خبری...');
    statusStrip.updateProgress(0, state.totalFeeds || 50);

    try {
        const eventSource = new EventSource('/api/news/stream');
        let receivedNews = [];
        let firstBatchSent = false;
        let loadedFeeds = 0;
        const totalFeeds = state.totalFeeds || 50;

        eventSource.onmessage = (event) => {
            if (event.data === '[DONE]') {
                eventSource.close();
                return;
            }

            let data;
            try { data = JSON.parse(event.data); }
            catch { return; }

            switch (data.type) {
                case 'start':
                    statusStrip.show(data.from_cache
                        ? '⚡ بارگذاری از cache...'
                        : '📡 اتصال برقرار شد، در حال دریافت...');
                    break;

                case 'news':
                    if (data.item) {
                        receivedNews.push(data.item);
                        state.streamNews.push(data.item);

                        if (!firstBatchSent && receivedNews.length >= 3) {
                            firstBatchSent = true;
                            displayStreamedNews(receivedNews);
                            statusStrip.show(`⚡ ${receivedNews.length} خبر اول دریافت شد`);
                        } else if (firstBatchSent) {
                            state.pendingStreamNews.push(data.item);
                            scheduleStreamRender();
                        }
                    }
                    break;

                case 'first_batch':
                    if (!firstBatchSent && receivedNews.length > 0) {
                        firstBatchSent = true;
                        displayStreamedNews(receivedNews);
                    }
                    break;

                case 'progress':
                    if (data.source) {
                        loadedFeeds++;
                        statusStrip.addChip(data.source, true);
                        statusStrip.updateProgress(loadedFeeds, totalFeeds);
                        statusStrip.show(`📨 ${state.allNews.length} خبر از ${loadedFeeds} منبع`);
                    }
                    break;

                case 'error':
                    if (data.source) {
                        loadedFeeds++;
                        statusStrip.addChip(data.source, false);
                        statusStrip.updateProgress(loadedFeeds, totalFeeds);
                    }
                    break;

                case 'complete':
                    handleStreamComplete(eventSource, firstBatchSent, receivedNews);
                    break;
            }
        };

        eventSource.onerror = () => {
            eventSource.close();
            state.isStreaming = false;

            if (!firstBatchSent) {
                fetchNewsFallback();
            } else {
                finalizeNews();
                statusStrip.complete();
            }
        };

    } catch (e) {
        console.error('Stream setup error:', e);
        state.isStreaming = false;
        statusStrip.error('خطا در اتصال به سرور');
        fetchNewsFallback();
    }
}

function handleStreamComplete(eventSource, firstBatchSent, receivedNews) {
    if (state.renderTimer) {
        clearTimeout(state.renderTimer);
        state.renderTimer = null;
    }
    if (state.pendingStreamNews.length) {
        addNewsItems(state.pendingStreamNews.splice(0));
    }

    eventSource.close();
    state.isStreaming = false;

    if (!firstBatchSent && receivedNews.length > 0) {
        displayStreamedNews(receivedNews);
    }

    finalizeNews();
    statusStrip.complete(`✅ ${state.allNews.length} خبر آماده است`);
}

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

        if (state.currentCategory !== 'all' || state.searchQuery) {
            applyFilters();
        } else {
            state.filteredNews = state.allNews;
            appendNewCards(added);
            DOM.countEl.textContent = String(state.filteredNews.length);
        }
        DOM.timeEl.textContent = `⏱️ بروزرسانی: ${formatAbsoluteDate(new Date())}`;
    }, CONSTANTS.STREAM_BATCH_DELAY);
}

function displayStreamedNews(newsItems) {
    if (!newsItems?.length) return;
    addNewsItems(newsItems);
    state.categoryMap = extractCategories(state.allNews);
    updateSidebar();
    applyFilters();
    DOM.timeEl.textContent = `⏱️ بروزرسانی: ${formatAbsoluteDate(new Date())}`;
    DOM.grid.setAttribute('aria-busy', 'false');
}

function finalizeNews(newsItems = []) {
    if (state.pendingStreamNews.length) {
        addNewsItems(state.pendingStreamNews.splice(0));
    }
    if (Array.isArray(newsItems) && newsItems.length) {
        addNewsItems(newsItems);
    }

    state.categoryMap = extractCategories(state.allNews);
    updateSidebar();
    applyFilters();
    DOM.timeEl.textContent = `⏱️ بروزرسانی: ${formatAbsoluteDate(new Date())}`;
    DOM.grid.setAttribute('aria-busy', 'false');
}

async function fetchNewsFallback() {
    try {
        const res = await fetch('/api/news');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const rawNews = Array.isArray(data.news) ? data.news : [];

        if (!rawNews.length) {
            statusStrip.error('هیچ خبری دریافت نشد');
            return;
        }

        state.newsKeys.clear();
        state.allNews = [];
        addNewsItems(rawNews);
        state.categoryMap = extractCategories(state.allNews);
        updateSidebar();
        applyFilters();
        DOM.timeEl.textContent = `⏱️ بروزرسانی: ${formatAbsoluteDate(data.timestamp || new Date())}`;
        statusStrip.complete();
    } catch (e) {
        console.warn('Fetch error:', e);
        statusStrip.error('خطا در دریافت اخبار');
        showToast('❌ خطا در دریافت اخبار');
    } finally {
        DOM.grid.setAttribute('aria-busy', 'false');
    }
}

// ============================================
// Background Refresh
// ============================================
function startBackgroundRefresh() {
    if (state.isBackgroundRefresh || state.isStreaming) return;
    state.isBackgroundRefresh = true;
    refreshBadge.show('در حال بروزرسانی اخبار...');

    fetch('/api/refresh', { method: 'POST' })
        .then(() => {
            const startTime = Date.now();
            const poll = setInterval(async () => {
                try {
                    const res = await fetch('/api/status');
                    const status = await res.json();

                    if (!status.cache.is_fetching) {
                        clearInterval(poll);
                        refreshBadge.hide();
                        state.isBackgroundRefresh = false;

                        const newsRes = await fetch('/api/news');
                        const newsData = await newsRes.json();
                        if (newsData.news) {
                            const oldCount = state.allNews.length;
                            state.newsKeys.clear();
                            state.allNews = [];
                            addNewsItems(newsData.news);

                            if (state.allNews.length > oldCount) {
                                showToast(`📨 ${state.allNews.length - oldCount} خبر جدید`);
                            }

                            state.categoryMap = extractCategories(state.allNews);
                            updateSidebar();
                            applyFilters();
                            DOM.timeEl.textContent = `⏱️ بروزرسانی: ${formatAbsoluteDate(new Date())}`;
                        }
                    } else if (Date.now() - startTime > 60000) {
                        // timeout
                        clearInterval(poll);
                        refreshBadge.hide();
                        state.isBackgroundRefresh = false;
                    }
                } catch (e) {
                    console.warn('Poll error:', e);
                }
            }, 2000);
        })
        .catch(() => {
            refreshBadge.hide();
            state.isBackgroundRefresh = false;
        });
}

// ============================================
// Auto Refresh
// ============================================
function scheduleAutoRefresh() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(() => {
        if (document.visibilityState === 'visible' && !state.isStreaming) {
            startBackgroundRefresh();
        }
    }, CONSTANTS.REFRESH_INTERVAL);
}

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
    } catch {
        DOM.clockTime.textContent = now.toLocaleTimeString();
        DOM.clockDate.textContent = now.toLocaleDateString();
    }
}

// ============================================
// Scroll Handling
// ============================================
let backToTopVisible = false;
const handleScroll = throttle(() => {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const shouldShow = scrollTop > CONSTANTS.SCROLL_THRESHOLD;
    if (shouldShow !== backToTopVisible) {
        backToTopVisible = shouldShow;
        DOM.backToTop.classList.toggle('visible', shouldShow);
    }
}, 100);

// ============================================
// Event Bindings
// ============================================
function bindEvents() {
    // Grid (single delegation)
    DOM.grid.addEventListener('click', handleGridClick);
    DOM.grid.addEventListener('keydown', handleGridKeydown);
    DOM.grid.addEventListener('error', handleGridError, true);
    DOM.grid.addEventListener('load', handleGridLoad, true);

    // Sidebar
    DOM.sidebarCategories.addEventListener('click', handleSidebarClick);

    // Search
    DOM.searchInput.addEventListener('input', onSearchInput);

    // View toggle
    DOM.viewToggle.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn || btn.dataset.view === state.currentView) return;
        state.currentView = btn.dataset.view;
        DOM.viewToggle.querySelectorAll('button').forEach(b => {
            const active = b === btn;
            b.classList.toggle('active', active);
            b.setAttribute('aria-pressed', String(active));
        });
        DOM.grid.classList.toggle('list-view', state.currentView === 'list');
    });

    // Theme
    DOM.themeBtn.addEventListener('click', () => ThemeManager.toggle());

    // Refresh
    DOM.refreshBtn.addEventListener('click', () => {
        if (state.isStreaming || state.isBackgroundRefresh) return;
        if (state.allNews.length > 0) startBackgroundRefresh();
        else fetchNewsStream();
    });

    // Back to top
    DOM.backToTop.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Scroll
    window.addEventListener('scroll', handleScroll, { passive: true });

    // Modal
    DOM.modalCloseBtn.addEventListener('click', closeModal);
    DOM.modalPrevBtn.addEventListener('click', showPrevModal);
    DOM.modalNextBtn.addEventListener('click', showNextModal);
    DOM.modalOverlay.addEventListener('click', (e) => {
        if (e.target === DOM.modalOverlay) closeModal();
    });

    DOM.modalTranslateBtn.addEventListener('click', () => {
        const item = state.filteredNews[state.modalIndex];
        if (item) toggleTranslate(item, DOM.modalTranslateBtn, DOM.modalSummary, DOM.modalTranslatedText);
    });

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
        } catch {}
    });

    // Keyboard
    document.addEventListener('keydown', (e) => {
        if (!DOM.modalOverlay.classList.contains('active')) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
                e.preventDefault();
                if (!state.isStreaming && !state.isBackgroundRefresh) {
                    state.allNews.length > 0 ? startBackgroundRefresh() : fetchNewsStream();
                }
            }
            return;
        }

        if (e.key === 'Escape') { closeModal(); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); showPrevModal(); return; }
        if (e.key === 'ArrowLeft') { e.preventDefault(); showNextModal(); return; }

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

    // Visibility
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' &&
            Date.now() - state.lastFetchTime >= CONSTANTS.REFRESH_INTERVAL &&
            !state.isStreaming && !state.isBackgroundRefresh) {
            state.allNews.length > 0 ? startBackgroundRefresh() : fetchNewsStream();
        }
    });
}

// ============================================
// Init
// ============================================
function init() {
    // 1. Theme first (avoid flash)
    ThemeManager.init();

    // 2. Clock
    updateClock();
    state.clockTimer = setInterval(updateClock, 1000);

    // 3. Observer
    state.observer = createObserver();

    // 4. Events
    bindEvents();

    // 5. Initial data fetch
    fetchNewsStream();
    scheduleAutoRefresh();

    // 6. Initial scroll check
    handleScroll();

    console.log('%c📰 News Spot v10 ', 'background: linear-gradient(135deg,#8B5A2B,#C4956A); color:white; padding:4px 10px; border-radius:6px; font-weight:bold;',
        'Cache-Aware + Progressive Loading + Theme Fix');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    init();
}
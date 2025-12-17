const GLOBAL_CONFIG = { REPO_README_URL: "./README.md" };
let readmeLoaded = false;

function showToast(msg, type = 'normal') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = type === 'success' ? `<span>✅</span> ${msg}` : (type === 'error' ? `<span>⚠️</span> ${msg}` : msg);
    container.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(-20px)'; setTimeout(() => el.remove(), 300); }, 3000);
}

function showLoading(show) {
    const overlay = document.getElementById('loadingOverlay');
    show ? overlay.classList.remove('hidden') : overlay.classList.add('hidden');
}

async function toggleSidebar() {
    const body = document.body; const isOpen = body.classList.contains('sidebar-open');
    const containers = document.querySelectorAll('.container');
    if (isOpen) {
        body.classList.remove('sidebar-open');
        containers.forEach(el => el.onclick = null);
    } else {
        body.classList.add('sidebar-open');
        setTimeout(() => { containers.forEach(el => el.onclick = toggleSidebar); }, 100);
        if (!readmeLoaded) await fetchAndRenderReadme();
    }
}

async function fetchAndRenderReadme() {
    const contentDiv = document.getElementById('readmeContent');
    try {
        const response = await fetch(GLOBAL_CONFIG.REPO_README_URL + '?t=' + Date.now());
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        const markdownText = await response.text();
        if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
            contentDiv.innerHTML = DOMPurify.sanitize(marked.parse(markdownText));
            readmeLoaded = true;
        } else contentDiv.innerHTML = "<p style='color:red'>Marked or DOMPurify not loaded.</p>";
    } catch (error) {
        contentDiv.innerHTML = `<div style="text-align:center; padding-top:50px; color:var(--text-secondary)"><p>⚠️ 无法加载 README</p><button class="btn btn-secondary" onclick="fetchAndRenderReadme()" style="margin:20px auto">重试</button></div>`;
    }
}

function scrollToSection(sectionName) {
    const targetId = 'page-' + sectionName;
    const el = document.getElementById(targetId);
    if(el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}

function updateNavigationState() {
    const sections = ['welcome', 'cast', 'forge', 'refine'];
    const bookmarks = {
        'cast': document.getElementById('bm-cast'),
        'forge': document.getElementById('bm-forge'),
        'refine': document.getElementById('bm-refine')
    };
    const rightNav = document.getElementById('rightNavContainer');
    const leftNav = document.getElementById('guideBookmark');
    const homeBm = document.getElementById('homeBookmark');
    
    let currentSection = 'welcome';
    let maxVisibility = 0;
    sections.forEach(sec => {
        const el = document.getElementById('page-' + sec);
        if(!el) return;
        const rect = el.getBoundingClientRect();
        const windowHeight = window.innerHeight;
        const visibleTop = Math.max(0, rect.top);
        const visibleBottom = Math.min(windowHeight, rect.bottom);
        const visibleHeight = Math.max(0, visibleBottom - visibleTop);
        if (visibleHeight > maxVisibility) {
            maxVisibility = visibleHeight;
            currentSection = sec;
        }
    });

    Object.values(bookmarks).forEach(bm => bm.classList.remove('active'));
    if (currentSection === 'welcome') {
        rightNav.classList.add('nav-hidden');
        if(leftNav) leftNav.classList.add('nav-hidden');
        if(homeBm) homeBm.classList.add('nav-hidden');
    } else {
        rightNav.classList.remove('nav-hidden');
        if(leftNav) leftNav.classList.remove('nav-hidden');
        if(homeBm) homeBm.classList.remove('nav-hidden');
        if (bookmarks[currentSection]) { bookmarks[currentSection].classList.add('active'); }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.addEventListener('scroll', () => { requestAnimationFrame(updateNavigationState); });
    updateNavigationState();
    window.addEventListener('beforeunload', (e) => {
        const msg = "刷新页面将导致当前工作区数据丢失，确定要继续吗？";
        e.returnValue = msg;
        return msg;
    });
});
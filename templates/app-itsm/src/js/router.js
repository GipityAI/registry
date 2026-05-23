// router.js - Client-side History API router

const routes = [];
let currentCleanup = null;

/**
 * Register a route.
 * @param {string} pattern - URL pattern (supports :param placeholders)
 * @param {function} handler - (params) => void, called when route matches
 */
export function registerRoute(pattern, handler) {
    const paramNames = [];
    const regexStr = pattern.replace(/:([^/]+)/g, (_, name) => {
        paramNames.push(name);
        return '([^/]+)';
    });
    const regex = new RegExp(`^${regexStr}$`);
    routes.push({ pattern, regex, paramNames, handler });
}

/**
 * Navigate to a URL.
 */
export function navigate(url, replace = false) {
    if (replace) {
        history.replaceState(null, '', url);
    } else {
        history.pushState(null, '', url);
    }
    renderRoute();
}

/**
 * Match current URL to a registered route and render it.
 */
export function renderRoute() {
    const path = location.pathname;

    // Clean up previous page
    if (currentCleanup && typeof currentCleanup === 'function') {
        currentCleanup();
        currentCleanup = null;
    }

    for (const route of routes) {
        const match = path.match(route.regex);
        if (match) {
            const params = {};
            route.paramNames.forEach((name, i) => {
                params[name] = decodeURIComponent(match[i + 1]);
            });
            const result = route.handler(params);
            // If handler returns a cleanup function, store it
            if (typeof result === 'function') {
                currentCleanup = result;
            }
            return;
        }
    }

    // 404 fallback
    const main = document.getElementById('main-content');
    if (main) {
        main.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">404</div>
                <p>Page not found</p>
                <a href="/" data-link class="btn btn-primary">Go Home</a>
            </div>
        `;
    }
}

/**
 * Initialize the router: intercept link clicks, handle popstate.
 */
export function initRouter() {
    // Handle browser back/forward
    window.addEventListener('popstate', renderRoute);

    // Intercept clicks on [data-link] anchors
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a[data-link]');
        if (!link) return;
        e.preventDefault();
        const href = link.getAttribute('href');
        if (href && href !== location.pathname) {
            navigate(href);
        }
    });

    // Initial render
    renderRoute();
}

/**
 * Update sidebar active state based on current path.
 */
export function updateSidebarActive() {
    const path = location.pathname;
    document.querySelectorAll('.nav-item').forEach((item) => {
        const href = item.getAttribute('href');
        if (!href) return;
        // Exact match or prefix match for nested routes
        const isActive = path === href || (href !== '/' && href !== '/agent' && path.startsWith(href));
        const isExactAgent = href === '/agent' && path === '/agent';
        item.classList.toggle('active', isActive || isExactAgent);
    });
}

// utils.js - Shared utility functions

/**
 * Relative time string (e.g., "5 minutes ago").
 */
export function timeAgo(dateStr) {
    if (!dateStr) return '';
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = now - then;

    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'just now';

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;

    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;

    return `${Math.floor(months / 12)}y ago`;
}

/**
 * Format SLA remaining time as human-readable countdown.
 */
export function formatSlaRemaining(targetTimeStr) {
    if (!targetTimeStr) return { text: '--', status: 'ok' };

    const now = Date.now();
    const target = new Date(targetTimeStr).getTime();
    const diff = target - now;

    if (diff <= 0) {
        const overBy = Math.abs(diff);
        const mins = Math.floor(overBy / 60000);
        if (mins < 60) return { text: `-${mins}m`, status: 'breached' };
        const hrs = Math.floor(mins / 60);
        return { text: `-${hrs}h ${mins % 60}m`, status: 'breached' };
    }

    const totalMins = Math.floor(diff / 60000);
    const totalTarget = target - now;
    // Warning if less than 25% remaining (approximate)
    const status = totalMins < 30 ? 'warning' : 'ok';

    if (totalMins < 60) return { text: `${totalMins}m`, status };
    const hrs = Math.floor(totalMins / 60);
    if (hrs < 24) return { text: `${hrs}h ${totalMins % 60}m`, status };
    const days = Math.floor(hrs / 24);
    return { text: `${days}d ${hrs % 24}h`, status };
}

/**
 * Escape HTML to prevent XSS.
 */
export function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Create an element with optional attributes and children.
 */
export function el(tag, attrs = {}, ...children) {
    const elem = document.createElement(tag);
    for (const [key, val] of Object.entries(attrs)) {
        if (key === 'className') {
            elem.className = val;
        } else if (key === 'dataset') {
            for (const [dk, dv] of Object.entries(val)) {
                elem.dataset[dk] = dv;
            }
        } else if (key.startsWith('on') && typeof val === 'function') {
            elem.addEventListener(key.slice(2).toLowerCase(), val);
        } else if (key === 'innerHTML') {
            elem.innerHTML = val;
        } else {
            elem.setAttribute(key, val);
        }
    }
    for (const child of children) {
        if (typeof child === 'string') {
            elem.appendChild(document.createTextNode(child));
        } else if (child instanceof Node) {
            elem.appendChild(child);
        }
    }
    return elem;
}

/**
 * Show a toast notification.
 */
export function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = el('div', { className: `toast toast-${type}` }, message);
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.2s';
        setTimeout(() => toast.remove(), 200);
    }, duration);
}

/**
 * Debounce a function.
 */
export function debounce(fn, delay = 300) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

/**
 * Get priority info (label + color class).
 */
export function priorityInfo(level) {
    const map = {
        1: { label: 'Critical', className: 'priority-1', badgeClass: 'priority-badge-1' },
        2: { label: 'High', className: 'priority-2', badgeClass: 'priority-badge-2' },
        3: { label: 'Moderate', className: 'priority-3', badgeClass: 'priority-badge-3' },
        4: { label: 'Low', className: 'priority-4', badgeClass: 'priority-badge-4' },
        5: { label: 'Planning', className: 'priority-5', badgeClass: 'priority-badge-5' },
    };
    return map[level] || { label: `P${level}`, className: 'priority-4', badgeClass: 'priority-badge-4' };
}

/**
 * Render a state badge span.
 */
export function stateBadge(state) {
    const label = (state || 'unknown').replace(/_/g, ' ');
    return `<span class="state-badge state-${escapeHtml(state)}">${escapeHtml(label)}</span>`;
}

/**
 * Format a date for display.
 */
export function formatDate(dateStr) {
    if (!dateStr) return '--';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Format a datetime for display.
 */
export function formatDateTime(dateStr) {
    if (!dateStr) return '--';
    const d = new Date(dateStr);
    return d.toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
}

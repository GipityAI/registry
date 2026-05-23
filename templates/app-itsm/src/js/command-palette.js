// command-palette.js - Cmd+K command palette with fuzzy search

import { navigate } from './router.js';

const DEFAULT_COMMANDS = [
    { name: 'Dashboard', description: 'Go to agent dashboard', action: () => navigate('/agent') },
    { name: 'Incidents', description: 'View all incidents', action: () => navigate('/agent/incidents') },
    { name: 'New Incident', description: 'Create a new incident', action: () => navigate('/agent/incidents/new') },
    { name: 'Knowledge Base', description: 'Browse knowledge articles', action: () => navigate('/agent/knowledge') },
    { name: 'SLA Dashboard', description: 'View SLA timers', action: () => navigate('/agent/sla') },
    { name: 'Reports', description: 'Analytics and reporting', action: () => navigate('/agent/reports') },
    { name: 'Settings', description: 'Application settings', action: () => navigate('/agent/settings') },
    { name: 'Portal Home', description: 'Go to self-service portal', action: () => navigate('/') },
    { name: 'Service Catalog', description: 'Browse service catalog', action: () => navigate('/catalog') },
];

let isOpen = false;
let activeIndex = 0;
let filteredCommands = [...DEFAULT_COMMANDS];

function fuzzyMatch(query, text) {
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    if (t.includes(q)) return true;
    let qi = 0;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
        if (t[ti] === q[qi]) qi++;
    }
    return qi === q.length;
}

function render() {
    const list = document.getElementById('command-list');
    if (!list) return;

    list.innerHTML = '';
    filteredCommands.forEach((cmd, i) => {
        const li = document.createElement('li');
        li.textContent = cmd.name;
        if (cmd.description) {
            const span = document.createElement('span');
            span.style.color = 'var(--text-faint)';
            span.style.marginLeft = '8px';
            span.style.fontSize = 'var(--text-xs)';
            span.textContent = `- ${cmd.description}`;
            li.appendChild(span);
        }
        if (i === activeIndex) li.classList.add('active');
        li.addEventListener('click', () => executeCommand(i));
        list.appendChild(li);
    });
}

function executeCommand(index) {
    const cmd = filteredCommands[index];
    if (cmd) {
        close();
        cmd.action();
    }
}

function open() {
    const palette = document.getElementById('command-palette');
    const input = document.getElementById('command-input');
    if (!palette || !input) return;

    isOpen = true;
    activeIndex = 0;
    filteredCommands = [...DEFAULT_COMMANDS];
    palette.classList.remove('hidden');
    input.value = '';
    input.focus();
    render();
}

function close() {
    const palette = document.getElementById('command-palette');
    if (!palette) return;
    isOpen = false;
    palette.classList.add('hidden');
}

export function initCommandPalette() {
    // Keyboard shortcut: Cmd+K or Ctrl+K
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            if (isOpen) {
                close();
            } else {
                open();
            }
        }
        if (e.key === 'Escape' && isOpen) {
            close();
        }
    });

    // Backdrop click to close
    const backdrop = document.querySelector('.command-palette-backdrop');
    if (backdrop) {
        backdrop.addEventListener('click', close);
    }

    // Input filtering
    const input = document.getElementById('command-input');
    if (input) {
        input.addEventListener('input', () => {
            const query = input.value.trim();
            if (!query) {
                filteredCommands = [...DEFAULT_COMMANDS];
            } else {
                filteredCommands = DEFAULT_COMMANDS.filter(
                    (cmd) => fuzzyMatch(query, cmd.name) || fuzzyMatch(query, cmd.description || '')
                );
            }
            activeIndex = 0;
            render();
        });

        // Arrow key navigation
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                activeIndex = Math.min(activeIndex + 1, filteredCommands.length - 1);
                render();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                activeIndex = Math.max(activeIndex - 1, 0);
                render();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                executeCommand(activeIndex);
            }
        });
    }
}

/**
 * @gipity/chatbot: the <chatbot-widget> custom element.
 *
 * The default UI over the headless engine: a corner bubble, an inline panel or
 * a full-page chat with a conversation sidebar. Markdown replies, live tool
 * steps, approve/deny cards for confirmed tools, image and file attachments
 * (pick, drop or paste), voice in and out, stop / regenerate / edit / copy,
 * and an optional model picker. Apps wanting a different UI use the engine
 * (createChatbot) directly.
 *
 * Theming: colors come from CSS variables. `ui.theme: 'match-app'` (default)
 * takes the page's --primary; 'light', 'dark' and 'auto' pick a palette.
 */

import { createChatbot } from './engine.js';
import { renderMarkdown } from './markdown.js';
import { readAttachment } from './attachments.js';
import { startRecording, speak } from './voice.js';

const STYLES = `
  /* match-app (default): the page's Gipity theme tokens, with a dark fallback. */
  :host {
    --gc-primary: var(--primary, #fea60b);
    --gc-on-primary: var(--button-text, #1a1a1a);
    --gc-bg: var(--background-body, #16181f);
    --gc-bg-elev: var(--surface, #1f222b);
    --gc-text: var(--text-main, #e6e8ee);
    --gc-text-muted: var(--text-muted, #8a92a6);
    --gc-border: var(--border, #2c3140);
    --gc-bg-hover: color-mix(in srgb, var(--gc-bg-elev) 88%, var(--gc-text));
    --gc-code-bg: color-mix(in srgb, var(--gc-text) 8%, transparent);
    --gc-danger: #f87171;
    --gc-radius: 14px;
    --gc-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
    --gc-font: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    --gc-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    position: fixed;
    z-index: 2147483000;
    font-family: var(--gc-font);
    font-size: 15px;
    color: var(--gc-text);
  }
  :host([theme="dark"]) {
    --gc-bg: #16181f; --gc-bg-elev: #1f222b; --gc-text: #e6e8ee;
    --gc-text-muted: #8a92a6; --gc-border: #2c3140;
  }
  :host([theme="light"]) {
    --gc-bg: #ffffff; --gc-bg-elev: #f5f6f8; --gc-bg-hover: #eceef2;
    --gc-text: #1d2129; --gc-text-muted: #667085; --gc-border: #dfe3ea;
    --gc-code-bg: #f0f2f5; --gc-shadow: 0 12px 32px rgba(16, 24, 40, 0.16);
  }
  @media (prefers-color-scheme: light) {
    :host([theme="auto"]) {
      --gc-bg: #ffffff; --gc-bg-elev: #f5f6f8; --gc-bg-hover: #eceef2;
      --gc-text: #1d2129; --gc-text-muted: #667085; --gc-border: #dfe3ea;
      --gc-code-bg: #f0f2f5; --gc-shadow: 0 12px 32px rgba(16, 24, 40, 0.16);
    }
  }
  :host([placement="bottom-right"]) { bottom: 20px; right: 20px; }
  :host([placement="bottom-left"])  { bottom: 20px; left: 20px; }
  :host([placement="inline"]) { position: relative; display: block; width: 100%; height: 100%; z-index: auto; }
  :host([placement="fullscreen"]) { inset: 0; }
  * { box-sizing: border-box; }
  button { font: inherit; color: inherit; }
  .hidden { display: none !important; }

  .launcher {
    width: 60px; height: 60px; border-radius: 50%;
    background: var(--gc-primary); color: var(--gc-on-primary);
    box-shadow: var(--gc-shadow); border: none; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 28px; transition: transform 0.15s ease;
  }
  .launcher:hover { transform: scale(1.05); }
  .launcher img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }

  .panel {
    width: 400px; max-width: calc(100vw - 40px);
    height: 600px; max-height: calc(100vh - 60px);
    background: var(--gc-bg); border: 1px solid var(--gc-border);
    border-radius: var(--gc-radius); box-shadow: var(--gc-shadow);
    display: flex; overflow: hidden; position: relative;
  }
  :host([placement="inline"]) .panel, :host([placement="fullscreen"]) .panel {
    width: 100%; height: 100%; max-width: none; max-height: none;
    border-radius: 0; box-shadow: none; border: none;
  }
  :host([placement="inline"]) .panel { border: 1px solid var(--gc-border); border-radius: var(--gc-radius); }

  /* Sidebar */
  .sidebar {
    width: 260px; flex-shrink: 0; display: flex; flex-direction: column;
    background: var(--gc-bg-elev); border-right: 1px solid var(--gc-border);
  }
  .sidebar .new {
    margin: 12px; padding: 10px 12px; border-radius: 10px; cursor: pointer;
    border: 1px solid var(--gc-border); background: var(--gc-bg); text-align: left; font-weight: 600;
  }
  .sidebar .new:hover { border-color: var(--gc-primary); }
  .convs { flex: 1; overflow-y: auto; padding: 0 8px 12px; }
  .conv {
    display: flex; align-items: center; gap: 4px; width: 100%;
    padding: 8px 10px; border-radius: 8px; cursor: pointer;
    background: transparent; border: none; text-align: left; color: var(--gc-text);
  }
  .conv:hover { background: var(--gc-bg-hover); }
  .conv.active { background: var(--gc-bg-hover); }
  .conv .title { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 14px; }
  .conv .act { opacity: 0; border: none; background: none; cursor: pointer; color: var(--gc-text-muted); padding: 2px 5px; border-radius: 5px; }
  .conv:hover .act, .conv.active .act { opacity: 1; }
  .conv .act:hover { color: var(--gc-text); background: var(--gc-bg); }
  .conv input { flex: 1; font: inherit; font-size: 14px; background: var(--gc-bg); color: var(--gc-text); border: 1px solid var(--gc-primary); border-radius: 6px; padding: 3px 6px; }
  .convs .empty { color: var(--gc-text-muted); font-size: 13px; padding: 8px 10px; }

  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  header {
    display: flex; align-items: center; gap: 10px; padding: 10px 14px;
    border-bottom: 1px solid var(--gc-border); background: var(--gc-bg-elev);
  }
  header .avatar { width: 30px; height: 30px; border-radius: 50%; object-fit: cover; background: var(--gc-primary); flex-shrink: 0; }
  header .name { font-weight: 600; font-size: 15px; flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  header select {
    font: inherit; font-size: 13px; color: var(--gc-text); background: var(--gc-bg);
    border: 1px solid var(--gc-border); border-radius: 8px; padding: 4px 8px; max-width: 160px;
  }
  .icon-btn {
    background: transparent; border: none; color: var(--gc-text-muted); cursor: pointer;
    padding: 5px 8px; border-radius: 7px; font-size: 14px; line-height: 1;
  }
  .icon-btn:hover { color: var(--gc-text); background: var(--gc-bg-hover); }
  .menu-btn { display: none; }

  .messages { flex: 1; overflow-y: auto; padding: 18px 16px; display: flex; flex-direction: column; gap: 14px; }
  .thread { width: 100%; max-width: 820px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
  .row { display: flex; flex-direction: column; gap: 6px; }
  .row.user { align-items: flex-end; }
  .bubble { max-width: 88%; padding: 10px 14px; border-radius: 14px; line-height: 1.5; overflow-wrap: anywhere; }
  .row.user .bubble { background: var(--gc-primary); color: var(--gc-on-primary); border-bottom-right-radius: 4px; white-space: pre-wrap; }
  .row.assistant .bubble { background: var(--gc-bg-elev); border-bottom-left-radius: 4px; }
  .row.assistant .bubble.plain { background: transparent; padding: 0 2px; max-width: 100%; }
  .thumbs { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
  .thumbs img { width: 96px; height: 96px; object-fit: cover; border-radius: 10px; border: 1px solid var(--gc-border); }
  .chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 4px 9px; border-radius: 999px; background: var(--gc-bg-elev); border: 1px solid var(--gc-border); color: var(--gc-text); }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }

  /* Markdown */
  .md > :first-child { margin-top: 0; }
  .md > :last-child { margin-bottom: 0; }
  .md p { margin: 0 0 10px; }
  .md h3, .md h4, .md h5, .md h6 { margin: 14px 0 6px; line-height: 1.3; }
  .md h3 { font-size: 17px; } .md h4 { font-size: 15px; } .md h5, .md h6 { font-size: 14px; }
  .md ul, .md ol { margin: 0 0 10px; padding-left: 22px; }
  .md li { margin: 3px 0; }
  .md code { background: var(--gc-code-bg); padding: 1px 5px; border-radius: 5px; font-family: var(--gc-mono); font-size: 0.88em; }
  .md pre { position: relative; background: var(--gc-code-bg); padding: 12px; border-radius: 10px; overflow-x: auto; margin: 0 0 10px; }
  .md pre code { background: none; padding: 0; font-size: 13px; white-space: pre; }
  .md pre .copy { position: absolute; top: 6px; right: 6px; font-size: 11px; padding: 3px 7px; border-radius: 6px; border: 1px solid var(--gc-border); background: var(--gc-bg); color: var(--gc-text-muted); cursor: pointer; opacity: 0; }
  .md pre:hover .copy { opacity: 1; }
  .md blockquote { margin: 0 0 10px; padding-left: 12px; border-left: 3px solid var(--gc-border); color: var(--gc-text-muted); }
  .md hr { border: none; border-top: 1px solid var(--gc-border); margin: 12px 0; }
  .md a { color: var(--gc-primary); }
  .md img { max-width: 100%; border-radius: 10px; display: block; margin: 6px 0; }
  .md .table-wrap { overflow-x: auto; margin: 0 0 10px; }
  .md table { border-collapse: collapse; font-size: 14px; }
  .md th, .md td { border: 1px solid var(--gc-border); padding: 6px 10px; text-align: left; vertical-align: top; }
  .md th { background: var(--gc-bg-elev); font-weight: 600; }

  /* Tool steps */
  .steps { display: flex; flex-direction: column; gap: 4px; max-width: 88%; }
  details.step { font-size: 13px; border: 1px solid var(--gc-border); border-radius: 10px; background: var(--gc-bg); }
  details.step summary { cursor: pointer; padding: 6px 10px; color: var(--gc-text-muted); list-style: none; display: flex; gap: 8px; align-items: center; }
  details.step summary::-webkit-details-marker { display: none; }
  details.step summary .nm { font-family: var(--gc-mono); color: var(--gc-text); }
  details.step.error summary .st { color: var(--gc-danger); }
  details.step pre { margin: 0; padding: 8px 10px; border-top: 1px solid var(--gc-border); font-family: var(--gc-mono); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 240px; overflow-y: auto; color: var(--gc-text-muted); }
  .spin { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--gc-border); border-top-color: var(--gc-primary); animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .confirm { max-width: 88%; border: 1px solid var(--gc-primary); border-radius: 12px; padding: 10px 12px; background: var(--gc-bg-elev); font-size: 14px; }
  .confirm pre { font-family: var(--gc-mono); font-size: 12px; background: var(--gc-code-bg); padding: 8px; border-radius: 8px; white-space: pre-wrap; margin: 8px 0; max-height: 180px; overflow-y: auto; }
  .confirm .btns { display: flex; gap: 8px; }

  .actions { display: flex; gap: 2px; align-items: center; color: var(--gc-text-muted); font-size: 12px; }
  .actions .usage { margin-left: 6px; }
  .note { color: var(--gc-text-muted); font-size: 12px; font-style: italic; }
  .typing { display: inline-flex; gap: 4px; padding: 12px 14px; }
  .typing i { width: 6px; height: 6px; border-radius: 50%; background: var(--gc-text-muted); animation: blink 1.2s infinite; }
  .typing i:nth-child(2) { animation-delay: 0.2s; } .typing i:nth-child(3) { animation-delay: 0.4s; }
  @keyframes blink { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
  .error { color: var(--gc-danger); font-size: 13px; display: flex; gap: 10px; align-items: center; }

  .empty-state { margin: auto; text-align: center; color: var(--gc-text-muted); max-width: 520px; padding: 20px; }
  .empty-state .hello { font-size: 22px; font-weight: 600; color: var(--gc-text); margin-bottom: 8px; }
  .starters { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 16px; }
  .starter { background: var(--gc-bg-elev); border: 1px solid var(--gc-border); padding: 8px 12px; border-radius: 999px; font-size: 13px; cursor: pointer; }
  .starter:hover { border-color: var(--gc-primary); }

  .composer-wrap { padding: 10px 14px 14px; }
  .composer {
    max-width: 820px; margin: 0 auto; border: 1px solid var(--gc-border); border-radius: 16px;
    background: var(--gc-bg-elev); padding: 8px; display: flex; flex-direction: column; gap: 6px;
  }
  .composer.drag { border-color: var(--gc-primary); }
  .composer:focus-within { border-color: var(--gc-primary); }
  .pending { display: flex; gap: 6px; flex-wrap: wrap; }
  .pending .chip button { border: none; background: none; cursor: pointer; color: var(--gc-text-muted); padding: 0 0 0 2px; }
  .pending img { width: 22px; height: 22px; border-radius: 4px; object-fit: cover; }
  .composer-row { display: flex; align-items: flex-end; gap: 6px; }
  .composer textarea {
    flex: 1; resize: none; min-height: 24px; max-height: 200px; padding: 6px 6px;
    background: transparent; color: var(--gc-text); border: none; outline: none; font: inherit; line-height: 1.45;
  }
  .send {
    width: 36px; height: 36px; border-radius: 50%; border: none; cursor: pointer; flex-shrink: 0;
    background: var(--gc-primary); color: var(--gc-on-primary); font-size: 16px; font-weight: 700;
  }
  .send:disabled { opacity: 0.4; cursor: not-allowed; }
  .rec { color: var(--gc-danger) !important; }

  @media (max-width: 720px) {
    .sidebar { position: absolute; inset: 0 auto 0 0; z-index: 2; box-shadow: var(--gc-shadow); transform: translateX(-100%); transition: transform 0.2s ease; }
    .panel.nav-open .sidebar { transform: none; }
    .menu-btn { display: inline-block; }
    .bubble, .steps, .confirm { max-width: 94%; }
  }
`;

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pretty(value) {
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function userText(m) {
  if (m.display !== undefined) return m.display;
  if (typeof m.content === 'string') return m.content;
  return (m.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
}

export class ChatbotWidget extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._bot = null;
    this._open = false;
    this._live = null;          // streaming text of the current model call
    this._running = new Map();  // tool call id -> { name }
    this._confirms = [];        // pending { id, name, args, approve, deny }
    this._pending = [];         // attachments waiting to be sent
    this._error = null;         // { message, signIn }
    this._recorder = null;
    this._renaming = null;
    this._deleting = null;      // conversation id awaiting "Delete?" confirmation
    this._editing = false;      // the composer holds an edit of the last message
  }

  /** Set the chatbot config (order-independent with DOM insertion). */
  setConfig(config) {
    this._config = config;
    if (this.isConnected && !this._bot) this._init();
  }

  /** The headless engine behind this widget (send, open, setModel, on, ...). */
  get bot() { return this._bot; }

  connectedCallback() {
    if (this._config && !this._bot) this._init();
  }

  _init() {
    this._bot = createChatbot(this._config);
    const { ui, persona, features, model } = this._bot.config;
    this.setAttribute('placement', ui.placement);
    if (ui.theme !== 'match-app') this.setAttribute('theme', ui.theme);
    const big = ui.placement === 'inline' || ui.placement === 'fullscreen';
    this._sidebar = this._bot.hasStore() && (ui.sidebar ?? big);
    this._open = big;

    const launcher = ui.launcherIcon ? `<img src="${escapeHtml(ui.launcherIcon)}" alt="">` : '💬';
    const attach = features.vision.enabled || features.files.enabled;
    const accept = [features.vision.enabled ? 'image/*' : '', features.files.enabled ? '.txt,.csv,.tsv,.log,.json,.jsonl,.md,.xml,.yaml,.yml,.sql,.html,.js,.ts,.py,text/*' : ''].filter(Boolean).join(',');
    const choices = model.choices.length
      ? `<select class="model" aria-label="Model">${model.choices.map(c => `<option value="${escapeHtml(c.route)}"${c.route === model.route ? ' selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}</select>`
      : '';

    this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      ${ui.primaryColor ? `<style>:host { --gc-primary: ${escapeHtml(ui.primaryColor)}; }</style>` : ''}
      <button class="launcher ${big ? 'hidden' : ''}" part="launcher" aria-label="Open chat">${launcher}</button>
      <div class="panel ${big ? '' : 'hidden'}" part="panel">
        ${this._sidebar ? `
          <nav class="sidebar" part="sidebar">
            <button class="new">+ New chat</button>
            <div class="convs"></div>
          </nav>` : ''}
        <div class="main">
          <header part="header">
            ${this._sidebar ? '<button class="icon-btn menu-btn" aria-label="Conversations">☰</button>' : ''}
            ${persona.avatar ? `<img class="avatar" src="${escapeHtml(persona.avatar)}" alt="">` : ''}
            <div class="name">${escapeHtml(persona.name)}</div>
            ${choices}
            ${this._sidebar ? '' : '<button class="icon-btn reset" title="New chat" aria-label="New chat">↺</button>'}
            ${big ? '' : '<button class="icon-btn close" aria-label="Close">✕</button>'}
          </header>
          <div class="messages" part="messages"><div class="thread"></div></div>
          <div class="composer-wrap">
            <div class="composer">
              <div class="editing note hidden">Editing your last message. <button class="icon-btn cancel-edit">Cancel</button></div>
              <div class="pending hidden"></div>
              <div class="composer-row">
                ${attach ? '<button class="icon-btn attach" title="Attach" aria-label="Attach a file">📎</button>' : ''}
                ${attach ? `<input type="file" class="file hidden" multiple accept="${accept}">` : ''}
                <textarea rows="1" placeholder="${escapeHtml(ui.placeholder)}" aria-label="Message"></textarea>
                ${features.voice.enabled ? '<button class="icon-btn mic" title="Speak" aria-label="Speak">🎤</button>' : ''}
                <button class="send" aria-label="Send">↑</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this._wireDom();
    this._wireEngine();
    this._renderThread();
    if (this._sidebar) this._renderConversations();
  }

  _$(sel) { return this.shadowRoot.querySelector(sel); }

  _wireDom() {
    const ta = this._$('textarea');
    this._$('.launcher').addEventListener('click', () => this._toggle(true));
    this._$('.close')?.addEventListener('click', () => this._toggle(false));
    this._$('.reset')?.addEventListener('click', () => this._bot.newChat());
    this._$('.new')?.addEventListener('click', () => { this._bot.newChat(); this._closeNav(); ta.focus(); });
    this._$('.menu-btn')?.addEventListener('click', () => this._$('.panel').classList.toggle('nav-open'));
    this._$('.model')?.addEventListener('change', (e) => this._bot.setModel(e.target.value));
    this._$('.send').addEventListener('click', () => (this._bot.isBusy() ? this._bot.stop() : this._submit()));
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this._submit(); }
      if (e.key === 'Escape' && this._editing) this._setEditing(false);
    });
    this._$('.cancel-edit').addEventListener('click', () => this._setEditing(false));
    ta.addEventListener('input', () => this._autosize());

    const fileInput = this._$('.file');
    if (fileInput) {
      this._$('.attach').addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => { this._addFiles([...fileInput.files]); fileInput.value = ''; });
      const composer = this._$('.composer');
      composer.addEventListener('dragover', (e) => { e.preventDefault(); composer.classList.add('drag'); });
      composer.addEventListener('dragleave', () => composer.classList.remove('drag'));
      composer.addEventListener('drop', (e) => {
        e.preventDefault();
        composer.classList.remove('drag');
        this._addFiles([...(e.dataTransfer?.files ?? [])]);
      });
      ta.addEventListener('paste', (e) => {
        const files = [...(e.clipboardData?.files ?? [])];
        if (files.length) { e.preventDefault(); this._addFiles(files); }
      });
    }
    this._$('.mic')?.addEventListener('click', () => this._toggleMic());

    // Clicks inside the thread: copy buttons, step toggles, message actions.
    this._$('.thread').addEventListener('click', (e) => this._onThreadClick(e));
  }

  _wireEngine() {
    const bot = this._bot;
    bot.on('start', () => { this._error = null; this._live = ''; this._renderThread(); this._updateSend(); });
    bot.on('delta', (text) => { this._live = (this._live ?? '') + text; this._renderLive(); });
    bot.on('message', (m) => {
      if (m.role === 'assistant') this._live = '';
      this._renderThread();
    });
    bot.on('tool_start', ({ id, name }) => { this._running.set(id, { name }); this._renderThread(); });
    bot.on('tool_end', ({ id }) => { this._running.delete(id); this._renderThread(); });
    bot.on('confirm', (req) => { this._confirms.push(req); this._renderThread(); });
    bot.on('complete', (msg) => {
      this._live = null;
      this._running.clear();
      this._confirms = [];
      this._renderThread();
      this._updateSend();
      if (bot.config.features.voice.enabled && bot.config.features.voice.autoPlay && msg?.content) {
        speak(msg.content, { voice: bot.config.features.voice.voice }).catch(err => console.warn('[chatbot] read-aloud failed:', err.message));
      }
    });
    bot.on('error', (err) => {
      console.error('[chatbot]', err.message);
      this._live = null;
      this._running.clear();
      this._confirms = [];
      this._error = { message: err.visitorMessage || err.message, signIn: err.code === 'LOGIN_REQUIRED' };
      this._renderThread();
      this._updateSend();
    });
    bot.on('auth_required', () => { this._error = { message: 'Sign in so I can look that up for you.', signIn: true }; });
    bot.on('reset', () => { this._error = null; this._renderThread(); this._renderConversations(); });
    bot.on('history', () => { this._error = null; this._renderThread(); });
    bot.on('conversation', () => { this._renderConversations(); });
    bot.on('conversations', () => { this._renderConversations(); });
  }

  _toggle(open) {
    this._open = open;
    this._$('.launcher').classList.toggle('hidden', open);
    this._$('.panel').classList.toggle('hidden', !open);
    if (open) { this._renderThread(); this._$('textarea').focus(); }
  }

  _closeNav() { this._$('.panel')?.classList.remove('nav-open'); }

  _autosize() {
    const ta = this._$('textarea');
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }

  _updateSend() {
    const btn = this._$('.send');
    const busy = this._bot.isBusy();
    btn.textContent = busy ? '■' : '↑';
    btn.setAttribute('aria-label', busy ? 'Stop' : 'Send');
    btn.title = busy ? 'Stop' : 'Send';
  }

  // --- Composer ---

  async _addFiles(files) {
    for (const file of files) {
      try {
        const att = await readAttachment(file);
        const { vision, files: fileFeature } = this._bot.config.features;
        if (att.kind === 'image' && !vision.enabled) throw new Error('Photos are not enabled for this chat.');
        if (att.kind === 'file' && !fileFeature.enabled) throw new Error('Files are not enabled for this chat.');
        this._pending.push(att);
      } catch (err) {
        this._error = { message: err.message };
        this._renderThread();
      }
    }
    this._renderPending();
  }

  _renderPending() {
    const box = this._$('.pending');
    box.classList.toggle('hidden', this._pending.length === 0);
    box.innerHTML = this._pending.map((a, i) => `
      <span class="chip">${a.kind === 'image' ? `<img src="${a.dataUrl}" alt="">` : '📄'}
        ${escapeHtml(a.name)}<button data-remove="${i}" aria-label="Remove">✕</button></span>`).join('');
    box.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => {
      this._pending.splice(Number(b.dataset.remove), 1);
      this._renderPending();
    }));
  }

  async _submit(textOverride) {
    if (this._bot.isBusy()) return;
    const ta = this._$('textarea');
    const text = (textOverride ?? ta.value).trim();
    if (!text && this._pending.length === 0) return;
    const attachments = this._pending;
    this._pending = [];
    this._renderPending();
    ta.value = '';
    this._autosize();
    const editing = this._editing;
    this._setEditing(false, { keepText: true });
    try {
      if (editing) await this._bot.editLast(text);
      else await this._bot.send(text, { attachments });
    } catch (err) {
      // Put the message back so nothing typed is lost.
      if (!ta.value) ta.value = err.unsentText ?? text;
      if (!this._pending.length) { this._pending = attachments; this._renderPending(); }
      this._autosize();
      if (!err.visitorMessage) { this._error = { message: err.message }; this._renderThread(); }
    }
  }

  _setEditing(on, { keepText = false } = {}) {
    this._editing = on;
    this._$('.editing').classList.toggle('hidden', !on);
    if (!on && !keepText) { this._$('textarea').value = ''; this._autosize(); }
  }

  async _toggleMic() {
    const btn = this._$('.mic');
    if (this._recorder) {
      const rec = this._recorder;
      this._recorder = null;
      btn.classList.remove('rec');
      btn.textContent = '…';
      try {
        const text = await rec.stop();
        const ta = this._$('textarea');
        ta.value = ta.value ? `${ta.value} ${text}` : text;
        this._autosize();
        ta.focus();
      } catch (err) {
        this._error = { message: `Couldn't hear that: ${err.message}` };
        this._renderThread();
      }
      btn.textContent = '🎤';
      return;
    }
    try {
      this._recorder = await startRecording();
      btn.classList.add('rec');
      btn.textContent = '⏺';
      btn.title = 'Stop and transcribe';
    } catch (err) {
      this._error = { message: `Microphone unavailable: ${err.message}` };
      this._renderThread();
    }
  }

  // --- Sidebar ---

  async _renderConversations() {
    if (!this._sidebar) return;
    const box = this._$('.convs');
    let list;
    try {
      list = await this._bot.conversations();
    } catch (err) {
      box.innerHTML = `<div class="empty">Couldn't load conversations.</div>`;
      console.error('[chatbot] listing conversations failed:', err.message);
      return;
    }
    const current = this._bot.current().id;
    if (!list.length) { box.innerHTML = '<div class="empty">No conversations yet.</div>'; return; }
    box.innerHTML = list.map(c => this._renaming === c.id
      ? `<div class="conv active"><input value="${escapeHtml(c.title)}" data-rename="${escapeHtml(c.id)}" aria-label="Conversation name"></div>`
      : this._deleting === c.id
      ? `<div class="conv active"><span class="title">Delete this chat?</span>
          <button class="act" data-del-yes="${escapeHtml(c.id)}">Delete</button><button class="act" data-del-no>Keep</button></div>`
      : `<div class="conv${c.id === current ? ' active' : ''}" data-open="${escapeHtml(c.id)}" role="button" tabindex="0">
          <span class="title">${escapeHtml(c.title || 'Untitled')}</span>
          <button class="act" data-edit="${escapeHtml(c.id)}" title="Rename" aria-label="Rename">✎</button>
          <button class="act" data-del="${escapeHtml(c.id)}" title="Delete" aria-label="Delete">🗑</button>
        </div>`).join('');
    box.querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', async (e) => {
      if (e.target.closest('.act')) return;
      try { await this._bot.open(el.dataset.open); this._closeNav(); } catch (err) { this._error = { message: err.message }; this._renderThread(); }
    }));
    box.querySelectorAll('[data-edit]').forEach(el => el.addEventListener('click', () => {
      this._renaming = el.dataset.edit;
      this._renderConversations();
    }));
    box.querySelectorAll('[data-del]').forEach(el => el.addEventListener('click', () => {
      this._deleting = el.dataset.del;
      this._renderConversations();
    }));
    box.querySelector('[data-del-yes]')?.addEventListener('click', async (e) => {
      this._deleting = null;
      await this._bot.remove(e.currentTarget.dataset.delYes);
    });
    box.querySelector('[data-del-no]')?.addEventListener('click', () => { this._deleting = null; this._renderConversations(); });
    const input = box.querySelector('[data-rename]');
    if (input) {
      input.focus();
      input.select();
      const finish = async (save) => {
        const id = input.dataset.rename;
        const title = input.value.trim();
        this._renaming = null;
        if (save && title) await this._bot.rename(id, title.slice(0, 80));
        else this._renderConversations();
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
      input.addEventListener('blur', () => finish(true));
    }
  }

  // --- Thread ---

  _renderThread() {
    if (!this._bot || !this._open) return;
    const thread = this._$('.thread');
    const history = this._bot.history();
    const cfg = this._bot.config;

    if (!history.length && this._live === null && !this._error) {
      const greeting = cfg.persona.greeting ? `<div class="md">${renderMarkdown(cfg.persona.greeting)}</div>` : `<div class="hello">${escapeHtml(cfg.persona.name)}</div>`;
      thread.innerHTML = `<div class="empty-state">${greeting}
        ${cfg.persona.starters.length ? `<div class="starters">${cfg.persona.starters.map(s => `<button class="starter">${escapeHtml(s)}</button>`).join('')}</div>` : ''}
      </div>`;
      thread.querySelectorAll('.starter').forEach(b => b.addEventListener('click', () => this._submit(b.textContent)));
      return;
    }

    const results = new Map(history.filter(m => m.role === 'tool').map(m => [m.tool_call_id, m]));
    const lastUser = history.map(m => m.role).lastIndexOf('user');
    const lastAssistant = history.map(m => m.role).lastIndexOf('assistant');
    const busy = this._bot.isBusy();
    let html = '';
    history.forEach((m, i) => {
      if (m.role === 'user') html += this._userRow(m, i === lastUser && !busy);
      else if (m.role === 'assistant') html += this._assistantRow(m, results, i === lastAssistant && !busy);
    });
    for (const c of this._confirms) {
      html += `<div class="row assistant"><div class="confirm" data-confirm="${escapeHtml(c.id)}">
        Allow <strong>${escapeHtml(c.name)}</strong>?
        <pre>${escapeHtml(pretty(c.args))}</pre>
        <div class="btns"><button class="starter" data-approve="${escapeHtml(c.id)}">Allow</button><button class="starter" data-deny="${escapeHtml(c.id)}">Don't allow</button></div>
      </div></div>`;
    }
    if (this._live !== null) html += '<div class="row assistant live"></div>';
    if (this._error) {
      html += `<div class="error">${escapeHtml(this._error.message)}
        ${this._error.signIn && globalThis.Gipity?.auth ? '<button class="starter" data-signin>Sign in</button>' : ''}</div>`;
    }
    thread.innerHTML = html;
    this._decorateCode(thread);
    this._renderLive();
    this._scroll();
  }

  _userRow(m, isLast) {
    const images = Array.isArray(m.content) ? m.content.filter(b => b.type === 'image_url') : [];
    const files = (m.attachments || []).filter(a => a.kind === 'file');
    const text = userText(m);
    return `<div class="row user">
      ${images.length ? `<div class="thumbs">${images.map(b => `<img src="${escapeHtml(b.image_url.url)}" alt="">`).join('')}</div>` : ''}
      ${files.length ? `<div class="chips">${files.map(f => `<span class="chip">📄 ${escapeHtml(f.name)}</span>`).join('')}</div>` : ''}
      ${text ? `<div class="bubble">${escapeHtml(text)}</div>` : ''}
      ${isLast ? '<div class="actions"><button class="icon-btn" data-edit-last title="Edit">✎</button></div>' : ''}
    </div>`;
  }

  _assistantRow(m, results, isLast) {
    const cfg = this._bot.config;
    let html = '<div class="row assistant">';
    if (m.content) html += `<div class="bubble plain md">${renderMarkdown(m.content)}</div>`;
    if (m.tool_calls?.length) {
      html += '<div class="steps">';
      for (const call of m.tool_calls) {
        const res = results.get(call.id);
        const running = this._running.has(call.id);
        let failed = false;
        if (res) { try { failed = !!JSON.parse(res.content)?.error; } catch { /* plain text */ } }
        const status = running ? '<span class="spin"></span>' : res ? (failed ? '<span class="st">failed</span>' : '<span class="st">✓</span>') : '<span class="st">…</span>';
        html += `<details class="step${failed ? ' error' : ''}"><summary>${status}<span class="nm">${escapeHtml(call.function.name)}</span></summary>
          <pre>${escapeHtml(pretty(call.function.arguments))}${res ? `\n\n→ ${escapeHtml(pretty(res.content))}` : ''}</pre></details>`;
      }
      html += '</div>';
    }
    if (m.truncated) html += '<div class="note">The answer hit its length limit.</div>';
    if (m.stopped) html += '<div class="note">Stopped.</div>';
    if (isLast && m.content) {
      html += `<div class="actions">
        <button class="icon-btn" data-copy title="Copy">⧉</button>
        <button class="icon-btn" data-regen title="Regenerate">↻</button>
        ${cfg.features.voice.enabled ? '<button class="icon-btn" data-speak title="Read aloud">🔊</button>' : ''}
        ${cfg.ui.showUsage && m.usage ? `<span class="usage">${m.usage.credits} credits</span>` : ''}
      </div>`;
    }
    return `${html}</div>`;
  }

  _renderLive() {
    const el = this._$('.thread .live');
    if (!el) return;
    const waiting = !this._live && this._running.size === 0 && this._confirms.length === 0;
    el.innerHTML = this._live
      ? `<div class="bubble plain md">${renderMarkdown(this._live)}</div>`
      : waiting ? '<div class="bubble typing"><i></i><i></i><i></i></div>' : '';
    this._decorateCode(el);
    this._scroll();
  }

  _decorateCode(root) {
    root.querySelectorAll('.md pre').forEach(pre => {
      if (pre.querySelector('.copy')) return;
      const b = document.createElement('button');
      b.className = 'copy';
      b.textContent = 'Copy';
      pre.appendChild(b);
    });
  }

  _scroll() {
    const list = this._$('.messages');
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 160;
    if (nearBottom || this._bot.isBusy()) list.scrollTop = list.scrollHeight;
  }

  async _onThreadClick(e) {
    const t = e.target.closest('button');
    if (!t) return;
    const history = this._bot.history();
    if (t.classList.contains('copy')) {
      await navigator.clipboard?.writeText(t.parentElement.querySelector('code')?.textContent ?? '');
      t.textContent = 'Copied';
      setTimeout(() => { t.textContent = 'Copy'; }, 1200);
    } else if (t.dataset.copy !== undefined) {
      const last = [...history].reverse().find(m => m.role === 'assistant' && m.content);
      await navigator.clipboard?.writeText(last?.content ?? '');
    } else if (t.dataset.regen !== undefined) {
      this._bot.regenerate().catch(() => { /* the error event shows it */ });
    } else if (t.dataset.speak !== undefined) {
      const last = [...history].reverse().find(m => m.role === 'assistant' && m.content);
      speak(last?.content, { voice: this._bot.config.features.voice.voice })
        .catch(err => { this._error = { message: `Couldn't read that aloud: ${err.message}` }; this._renderThread(); });
    } else if (t.dataset.editLast !== undefined) {
      const lastUser = [...history].reverse().find(m => m.role === 'user');
      const ta = this._$('textarea');
      ta.value = userText(lastUser);
      this._setEditing(true, { keepText: true });
      this._autosize();
      ta.focus();
    } else if (t.dataset.approve || t.dataset.deny) {
      const id = t.dataset.approve || t.dataset.deny;
      const req = this._confirms.find(c => c.id === id);
      this._confirms = this._confirms.filter(c => c.id !== id);
      if (t.dataset.approve) req?.approve(); else req?.deny();
      this._renderThread();
    } else if (t.dataset.signin !== undefined) {
      try { await globalThis.Gipity.auth.signIn(); this._error = null; this._renderThread(); } catch (err) { console.warn('[chatbot] sign-in failed:', err.message); }
    }
  }
}

let registered = false;
export function registerWidget() {
  if (registered || typeof customElements === 'undefined') return;
  if (!customElements.get('chatbot-widget')) customElements.define('chatbot-widget', ChatbotWidget);
  registered = true;
}

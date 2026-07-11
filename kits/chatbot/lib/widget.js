/**
 * @gipity/chatbot — <chatbot-widget> custom element.
 *
 * Collapsible bubble in the corner of the page. Wraps the headless engine
 * with a default UI. Apps wanting a different look-and-feel skip this and
 * call createChatbot() directly.
 *
 * Theming: all colors and spacing come from CSS variables. `ui.theme:
 * "match-app"` (default) inherits the host page's `--primary` and friends.
 * Override per-instance via the element's style attribute.
 */

import { createChatbot } from './engine.js';

const STYLES = `
  :host {
    --gc-primary: var(--primary, #fea60b);
    --gc-bg: var(--gc-bg-override, #1a1c24);
    --gc-bg-elev: #232631;
    --gc-text: #e6e8ee;
    --gc-text-muted: #8a92a6;
    --gc-border: #2a2f3e;
    --gc-radius: 14px;
    --gc-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
    --gc-font: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    position: fixed;
    z-index: 2147483000;
    font-family: var(--gc-font);
    color: var(--gc-text);
  }
  :host([placement="bottom-right"]) { bottom: 20px; right: 20px; }
  :host([placement="bottom-left"])  { bottom: 20px; left: 20px; }
  :host([placement="inline"]) { position: static; }

  .launcher {
    width: 60px; height: 60px; border-radius: 50%;
    background: var(--gc-primary);
    box-shadow: var(--gc-shadow);
    border: none; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    color: white; font-size: 28px;
    transition: transform 0.15s ease;
  }
  .launcher:hover { transform: scale(1.05); }
  .launcher img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }

  .panel {
    width: 380px; max-width: calc(100vw - 40px);
    height: 560px; max-height: calc(100vh - 60px);
    background: var(--gc-bg);
    border: 1px solid var(--gc-border);
    border-radius: var(--gc-radius);
    box-shadow: var(--gc-shadow);
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  :host([placement="inline"]) .panel { width: 100%; height: 100%; max-width: none; max-height: none; box-shadow: none; }

  header {
    display: flex; align-items: center; gap: 10px;
    padding: 12px 14px;
    background: var(--gc-bg-elev);
    border-bottom: 1px solid var(--gc-border);
  }
  header .avatar { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; background: var(--gc-primary); flex-shrink: 0; }
  header .name { font-weight: 600; font-size: 14px; flex: 1; }
  header button {
    background: transparent; border: none; color: var(--gc-text-muted);
    cursor: pointer; padding: 4px 8px; border-radius: 6px;
    font-size: 12px;
  }
  header button:hover { color: var(--gc-text); background: rgba(255,255,255,0.05); }

  .messages {
    flex: 1; overflow-y: auto; padding: 14px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .msg { max-width: 88%; padding: 10px 12px; border-radius: 12px; line-height: 1.4; font-size: 14px; white-space: pre-wrap; word-wrap: break-word; }
  .msg.user      { align-self: flex-end;   background: var(--gc-primary); color: white; border-bottom-right-radius: 4px; }
  .msg.assistant { align-self: flex-start; background: var(--gc-bg-elev); color: var(--gc-text); border-bottom-left-radius: 4px; }
  .msg code { background: rgba(0,0,0,0.3); padding: 1px 5px; border-radius: 4px; font-family: ui-monospace, "SF Mono", monospace; font-size: 12px; }
  .msg pre { background: rgba(0,0,0,0.3); padding: 10px; border-radius: 8px; overflow-x: auto; margin: 6px 0; }
  .msg pre code { background: transparent; padding: 0; }
  .msg strong { font-weight: 600; }
  .msg em { font-style: italic; }
  .typing { color: var(--gc-text-muted); font-style: italic; padding: 6px 12px; }

  .starters {
    display: flex; flex-wrap: wrap; gap: 6px;
    padding: 0 14px 8px;
  }
  .starter {
    background: var(--gc-bg-elev); color: var(--gc-text);
    border: 1px solid var(--gc-border);
    padding: 6px 10px; border-radius: 16px;
    font-size: 12px; cursor: pointer;
  }
  .starter:hover { border-color: var(--gc-primary); }

  .composer {
    display: flex; gap: 8px; padding: 10px;
    border-top: 1px solid var(--gc-border);
    background: var(--gc-bg-elev);
  }
  .composer textarea {
    flex: 1; resize: none; min-height: 38px; max-height: 120px;
    background: var(--gc-bg); color: var(--gc-text);
    border: 1px solid var(--gc-border); border-radius: 10px;
    padding: 8px 10px; font: inherit; font-size: 14px;
    outline: none;
  }
  .composer textarea:focus { border-color: var(--gc-primary); }
  .composer button {
    background: var(--gc-primary); color: white; border: none;
    border-radius: 10px; padding: 0 14px; font-weight: 600;
    cursor: pointer; font-size: 14px;
  }
  .composer button:disabled { opacity: 0.5; cursor: not-allowed; }

  .error { color: #f87171; padding: 6px 12px; font-size: 12px; }
  .hidden { display: none !important; }
`;

/** Minimal inline-markdown: bold/italic/inline-code/code-fence. Escapes HTML first. */
function renderInlineMarkdown(text) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)\*([^*]+)\*(?=\s|$)/g, '$1<em>$2</em>');
}

export class ChatbotWidget extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._bot = null;
    this._open = false;
    this._streaming = false;
    this._currentAssistantEl = null;
  }

  /**
   * Set the chatbot config. Order-independent with DOM insertion:
   * - setConfig before insert: connectedCallback will run _init() once attached.
   * - setConfig after insert:  triggers _init() right away.
   */
  setConfig(config) {
    this._config = config;
    if (this.isConnected && !this._bot) this._init();
  }

  connectedCallback() {
    // Waiting for setConfig() is normal — the user's mount() call may not have
    // run yet (e.g. element is in HTML and mount runs inside DOMContentLoaded).
    if (this._config && !this._bot) this._init();
  }

  _init() {
    this._bot = createChatbot(this._config);
    const placement = this._bot.config.ui.placement;
    this.setAttribute('placement', placement);
    this._render();
    this._wireEngine();
    if (placement === 'inline') this._open = true;
    this._updateOpenState();
    // Inline chats are open from mount with no launcher to click, so the
    // greeting that other placements show on first open must render here.
    if (placement === 'inline') this._renderGreeting();
  }

  _render() {
    const cfg = this._bot.config;
    const persona = cfg.persona;
    const launcherIcon = cfg.ui.launcherIcon
      ? `<img src="${cfg.ui.launcherIcon}" alt="">`
      : '💬';
    const primaryColor = cfg.ui.primaryColor;

    this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      ${primaryColor ? `<style>:host { --gc-primary: ${primaryColor}; }</style>` : ''}
      <button class="launcher" part="launcher" aria-label="Open chat">${launcherIcon}</button>
      <div class="panel hidden" part="panel">
        <header>
          ${persona.avatar ? `<img class="avatar" src="${persona.avatar}" alt="">` : '<div class="avatar"></div>'}
          <div class="name">${escapeHtml(persona.name)}</div>
          <button class="reset" aria-label="Reset conversation">Reset</button>
          <button class="close" aria-label="Close">✕</button>
        </header>
        <div class="messages" part="messages"></div>
        <div class="starters hidden"></div>
        <div class="composer">
          <textarea placeholder="Type a message…" rows="1"></textarea>
          <button class="send">Send</button>
        </div>
      </div>
    `;

    const root = this.shadowRoot;
    root.querySelector('.launcher').addEventListener('click', () => this._toggle());
    root.querySelector('.close').addEventListener('click', () => this._toggle(false));
    root.querySelector('.reset').addEventListener('click', () => this._reset());
    root.querySelector('.send').addEventListener('click', () => this._submit());
    const ta = root.querySelector('textarea');
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._submit();
      }
    });

    this._renderStarters();
  }

  _renderStarters() {
    const cfg = this._bot.config;
    const root = this.shadowRoot;
    const wrap = root.querySelector('.starters');
    const starters = cfg.persona.starters;
    if (!starters?.length || this._bot.history().length > 0) {
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');
    wrap.innerHTML = starters
      .map((s) => `<button class="starter">${escapeHtml(s)}</button>`)
      .join('');
    wrap.querySelectorAll('.starter').forEach((el) => {
      el.addEventListener('click', () => {
        const ta = root.querySelector('textarea');
        ta.value = el.textContent;
        this._submit();
      });
    });
  }

  _renderGreeting() {
    const cfg = this._bot.config;
    if (!cfg.persona.greeting) return;
    if (this._bot.history().length > 0) return;
    this._appendMessage({ role: 'assistant', content: cfg.persona.greeting });
  }

  _wireEngine() {
    this._bot.on('delta', (text) => {
      if (!this._currentAssistantEl) {
        this._currentAssistantEl = this._appendMessage({ role: 'assistant', content: '' });
      }
      this._currentAssistantEl._raw += text;
      this._currentAssistantEl.innerHTML = renderInlineMarkdown(this._currentAssistantEl._raw);
      this._scrollToBottom();
    });
    this._bot.on('complete', () => {
      this._streaming = false;
      this._currentAssistantEl = null;
      this._updateSendButton();
    });
    this._bot.on('error', (err) => {
      this._streaming = false;
      this._currentAssistantEl = null;
      this._showError(err.message);
      this._updateSendButton();
    });
    this._bot.on('reset', () => {
      this.shadowRoot.querySelector('.messages').innerHTML = '';
      this._renderStarters();
      this._renderGreeting();
    });
  }

  _toggle(force) {
    this._open = force !== undefined ? force : !this._open;
    this._updateOpenState();
    if (this._open) {
      // Show greeting on first open if we have one and no messages yet.
      this._renderGreeting();
      this.shadowRoot.querySelector('textarea').focus();
    }
  }

  _updateOpenState() {
    const launcher = this.shadowRoot.querySelector('.launcher');
    const panel = this.shadowRoot.querySelector('.panel');
    if (this._bot.config.ui.placement === 'inline') {
      launcher.classList.add('hidden');
      panel.classList.remove('hidden');
      return;
    }
    launcher.classList.toggle('hidden', this._open);
    panel.classList.toggle('hidden', !this._open);
  }

  async _submit() {
    if (this._streaming) return;
    const ta = this.shadowRoot.querySelector('textarea');
    const text = ta.value.trim();
    if (!text) return;
    ta.value = '';
    this._appendMessage({ role: 'user', content: text });
    this._renderStarters(); // hides them once a message exists
    this._streaming = true;
    this._updateSendButton();
    try {
      await this._bot.send(text);
    } catch {
      // Error event handler already surfaced it.
    }
  }

  _appendMessage(msg) {
    const list = this.shadowRoot.querySelector('.messages');
    const el = document.createElement('div');
    el.className = `msg ${msg.role}`;
    el._raw = msg.content;
    el.innerHTML = renderInlineMarkdown(msg.content);
    list.appendChild(el);
    this._scrollToBottom();
    return el;
  }

  _showError(message) {
    const list = this.shadowRoot.querySelector('.messages');
    const el = document.createElement('div');
    el.className = 'error';
    el.textContent = message;
    list.appendChild(el);
    this._scrollToBottom();
  }

  _scrollToBottom() {
    const list = this.shadowRoot.querySelector('.messages');
    list.scrollTop = list.scrollHeight;
  }

  _updateSendButton() {
    const btn = this.shadowRoot.querySelector('.send');
    btn.disabled = this._streaming;
    btn.textContent = this._streaming ? '…' : 'Send';
  }

  _reset() {
    this._bot.reset();
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let registered = false;
export function registerWidget() {
  if (registered || typeof customElements === 'undefined') return;
  if (!customElements.get('chatbot-widget')) {
    customElements.define('chatbot-widget', ChatbotWidget);
  }
  registered = true;
}

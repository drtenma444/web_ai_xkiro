// ---------- Constants ----------
const COPY_SVG = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
const CHECK_SVG = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>';
const TRASH_SVG = '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path></svg>';

const STORAGE_KEY = 'lessbot_conversations_v1';
const ACTIVE_KEY = 'lessbot_active_id';

// ---------- Markdown ----------
const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const renderer = new marked.Renderer();

renderer.code = (code, infostring) => {
  const info = (infostring || '').trim();
  const lang = (info.split(/\s+/)[0] || 'text').toLowerCase();
  const safeLang = escapeHtml(lang);
  let highlighted;
  try {
    if (lang !== 'text' && window.hljs && hljs.getLanguage(lang)) {
      highlighted = hljs.highlight(code, { language: lang }).value;
    } else if (window.hljs) {
      highlighted = hljs.highlightAuto(code).value;
    } else {
      highlighted = escapeHtml(code);
    }
  } catch (e) {
    highlighted = escapeHtml(code);
  }
  return `<div class="code-block">
    <div class="code-header">
      <span class="code-lang">${safeLang}</span>
    </div>
    <pre><code class="hljs">${highlighted}</code></pre>
  </div>`;
};

renderer.link = (href, title, text) => {
  const t = title ? ` title="${escapeHtml(title)}"` : '';
  return `<a href="${href}"${t} target="_blank" rel="noopener noreferrer">${text}</a>`;
};

marked.setOptions({ renderer, breaks: true, gfm: true });

function renderMarkdown(text) {
  const raw = marked.parse(text);
  return DOMPurify.sanitize(raw, { ADD_ATTR: ['target'] });
}

// ---------- Storage ----------
function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('loadStore failed:', e);
    return [];
  }
}

function saveStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (e) {
    console.error('saveStore failed:', e);
  }
}

function getActiveId() { return localStorage.getItem(ACTIVE_KEY); }
function setActiveId(id) {
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
}

function makeTitle(text) {
  const t = (text || '').trim().replace(/\s+/g, ' ');
  if (!t) return 'New chat';
  return t.length > 40 ? t.slice(0, 40).trim() + '…' : t;
}

// ---------- DOM ----------
const shell = document.getElementById('shell');
const convList = document.getElementById('conversation-list');
const newChatBtn = document.getElementById('new-chat-btn');
const sidebarToggle = document.getElementById('sidebar-toggle');
const backdrop = document.getElementById('backdrop');

const app = document.getElementById('app');
const messagesDiv = document.getElementById('messages');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send-btn');
const searchToggle = document.getElementById('search-toggle');
const iconSend = sendBtn.querySelector('.icon-send');
const iconStop = sendBtn.querySelector('.icon-stop');

// ---------- State ----------
let store = loadStore();
let activeId = getActiveId();
let conversation = [];
let isWaiting = false;
let webSearchEnabled = false;
let currentAbortController = null;

// ---------- Sidebar toggle ----------
function isMobile() { return window.innerWidth <= 768; }

function openMobileSidebar() {
  shell.classList.add('sidebar-mobile-open');
  backdrop.classList.add('visible');
}
function closeMobileSidebar() {
  shell.classList.remove('sidebar-mobile-open');
  backdrop.classList.remove('visible');
}

sidebarToggle.addEventListener('click', () => {
  if (isMobile()) {
    if (shell.classList.contains('sidebar-mobile-open')) {
      closeMobileSidebar();
    } else {
      openMobileSidebar();
    }
  } else {
    shell.classList.toggle('sidebar-collapsed');
  }
});

backdrop.addEventListener('click', closeMobileSidebar);

// ---------- Search toggle ----------
searchToggle.addEventListener('click', () => {
  webSearchEnabled = !webSearchEnabled;
  searchToggle.classList.toggle('active', webSearchEnabled);
});

// ---------- Auto-grow textarea ----------
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 180) + 'px';
});

// ---------- Smart scroll ----------
let stickToBottom = true;
messagesDiv.addEventListener('scroll', () => {
  const d = messagesDiv.scrollHeight - messagesDiv.scrollTop - messagesDiv.clientHeight;
  stickToBottom = d < 60;
});

function scrollToBottom(force = false) {
  if (force || stickToBottom) {
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }
}

function forceScrollToBottom() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    });
  });
}

// ---------- Copy button (icon only) ----------
function createCopyButton(getText) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'copy-btn';
  btn.title = 'Copy';
  btn.setAttribute('aria-label', 'Copy');
  btn.innerHTML = COPY_SVG;
  btn.addEventListener('click', async () => {
    const text = getText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      btn.innerHTML = CHECK_SVG;
      btn.classList.add('copied');
      setTimeout(() => {
        btn.innerHTML = COPY_SVG;
        btn.classList.remove('copied');
      }, 1500);
    } catch (e) { console.error('Copy failed:', e); }
  });
  return btn;
}

function enhanceCodeBlocks(container) {
  container.querySelectorAll('.code-block').forEach(block => {
    const header = block.querySelector('.code-header');
    const codeEl = block.querySelector('code');
    if (!header || !codeEl || header.querySelector('.copy-btn')) return;
    const btn = createCopyButton(() => codeEl.textContent);
    header.appendChild(btn);
  });
}

// ---------- Message rendering ----------
function addMessage(role, text, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;

  const content = document.createElement('div');
  content.className = 'msg-content';
  if (role === 'ai') {
    content.innerHTML = renderMarkdown(text);
  } else {
    content.textContent = text;
  }
  wrap.appendChild(content);

  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  actions.appendChild(createCopyButton(() => text));
  wrap.appendChild(actions);

  messagesDiv.appendChild(wrap);
  if (role === 'ai') enhanceCodeBlocks(wrap);
  if (opts.animate !== false) scrollToBottom(true);
  return wrap;
}

// ---------- Conversation store ops ----------
function createConversation() {
  const id = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const now = Date.now();
  const conv = {
    id,
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    messages: []
  };
  store.unshift(conv);
  saveStore(store);
  return conv;
}

function findConversation(id) {
  return store.find(c => c.id === id);
}

function deleteConversation(id) {
  store = store.filter(c => c.id !== id);
  saveStore(store);
  if (activeId === id) {
    activeId = null;
    setActiveId(null);
    startNewChat();
  }
  renderSidebar();
}

// ---------- Sidebar rendering ----------
function renderSidebar() {
  convList.innerHTML = '';
  if (store.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-convs';
    empty.textContent = 'No chats yet';
    convList.appendChild(empty);
    return;
  }
  const sorted = [...store].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  for (const c of sorted) {
    const item = document.createElement('div');
    item.className = 'conv-item' + (c.id === activeId ? ' active' : '');
    item.title = c.title;

    const title = document.createElement('div');
    title.className = 'conv-title';
    title.textContent = c.title;
    item.appendChild(title);

    const del = document.createElement('button');
    del.className = 'conv-delete';
    del.type = 'button';
    del.title = 'Delete chat';
    del.innerHTML = TRASH_SVG;
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('Delete this chat?')) deleteConversation(c.id);
    });
    item.appendChild(del);

    item.addEventListener('click', () => {
      loadConversation(c.id);
      if (isMobile()) closeMobileSidebar();
    });

    convList.appendChild(item);
  }
}

// ---------- Loading a conversation ----------
function loadConversation(id) {
  const conv = findConversation(id);
  if (!conv) return;

  activeId = id;
  setActiveId(id);
  conversation = conv.messages.slice();

  messagesDiv.innerHTML = '';

  if (conversation.length === 0) {
    app.classList.remove('state-chatting');
    app.classList.add('state-initial');
  } else {
    app.classList.remove('state-initial');
    app.classList.add('state-chatting');
    for (const m of conversation) {
      addMessage(m.role, m.content, { animate: false });
    }
    forceScrollToBottom();
  }

  renderSidebar();
}

// ---------- New chat ----------
function startNewChat() {
  activeId = null;
  setActiveId(null);
  conversation = [];
  messagesDiv.innerHTML = '';
  app.classList.remove('state-chatting');
  app.classList.add('state-initial');
  renderSidebar();
  input.focus();
}

newChatBtn.addEventListener('click', () => {
  startNewChat();
  if (isMobile()) closeMobileSidebar();
});

// ---------- Streaming send ----------
async function send() {
  const text = input.value.trim();
  if (!text || isWaiting) return;

  isWaiting = true;
  setButtonMode('stop');
  input.value = '';
  input.style.height = 'auto';

  if (!activeId) {
    const conv = createConversation();
    activeId = conv.id;
    setActiveId(activeId);
  }

  if (app.classList.contains('state-initial')) {
    app.classList.remove('state-initial');
    app.classList.add('state-chatting');
  }

  addMessage('user', text);
  conversation.push({ role: 'user', content: text });

  const conv = findConversation(activeId);
  if (conv) {
    conv.messages = conversation.slice();
    if (conv.title === 'New chat' && conv.messages.length === 1) {
      conv.title = makeTitle(text);
    }
    conv.updatedAt = Date.now();
    saveStore(store);
    renderSidebar();
  }

  // AI placeholder
  const wrap = document.createElement('div');
  wrap.className = 'msg ai';
  const contentEl = document.createElement('div');
  contentEl.className = 'msg-content';
  contentEl.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
  wrap.appendChild(contentEl);
  messagesDiv.appendChild(wrap);
  scrollToBottom(true);

  const abortController = new AbortController();
  currentAbortController = abortController;

  let fullText = '';
  let rafScheduled = false;

  const scheduleRender = () => {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      if (fullText) {
        contentEl.innerHTML = renderMarkdown(fullText) + '<span class="stream-cursor"></span>';
        enhanceCodeBlocks(wrap);
        scrollToBottom();
      }
    });
  };

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: conversation,
        webSearchEnabled: webSearchEnabled
      }),
      signal: abortController.signal
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      contentEl.textContent = `⚠️ Error: ${errData.error}`;
      return;
    }

    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/event-stream')) {
      const data = await res.json();
      if (data.error) {
        contentEl.textContent = `⚠️ Error: ${data.error}`;
      } else {
        const reply = data.choices[0].message.content;
        contentEl.innerHTML = renderMarkdown(reply);
        enhanceCodeBlocks(wrap);
        conversation.push({ role: 'assistant', content: reply });
        persistConversation();
      }
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            scheduleRender();
          }
        } catch (e) { /* ignore */ }
      }
    }

    contentEl.innerHTML = renderMarkdown(fullText || '(no response)');
    enhanceCodeBlocks(wrap);
    if (fullText) {
      conversation.push({ role: 'assistant', content: fullText });
      persistConversation();
    }

  } catch (err) {
    if (err.name === 'AbortError') {
      if (fullText) {
        contentEl.innerHTML = renderMarkdown(fullText);
        enhanceCodeBlocks(wrap);
        conversation.push({ role: 'assistant', content: fullText });
        persistConversation();
      } else {
        contentEl.textContent = '(stopped)';
      }
    } else {
      contentEl.textContent = `⚠️ Network error: ${err.message}`;
    }
  } finally {
    if (!wrap.querySelector('.msg-actions')) {
      const actions = document.createElement('div');
      actions.className = 'msg-actions';
      actions.appendChild(createCopyButton(() => fullText));
      wrap.appendChild(actions);
    }
    isWaiting = false;
    currentAbortController = null;
    setButtonMode('send');
    input.focus();
  }
}

function persistConversation() {
  if (!activeId) return;
  const conv = findConversation(activeId);
  if (!conv) return;
  conv.messages = conversation.slice();
  conv.updatedAt = Date.now();
  saveStore(store);
  renderSidebar();
}

function setButtonMode(mode) {
  if (mode === 'stop') {
    iconSend.style.display = 'none';
    iconStop.style.display = 'block';
    sendBtn.disabled = false;
    sendBtn.setAttribute('aria-label', 'Stop');
  } else {
    iconSend.style.display = 'block';
    iconStop.style.display = 'none';
    sendBtn.disabled = false;
    sendBtn.setAttribute('aria-label', 'Send');
  }
}

// ---------- Button handlers ----------
sendBtn.addEventListener('click', () => {
  if (isWaiting && currentAbortController) currentAbortController.abort();
  else send();
});

input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!isWaiting) send();
  }
});

// ---------- Init ----------
function init() {
  if (isMobile()) {
    closeMobileSidebar();
  } else {
    shell.classList.remove('sidebar-collapsed');
  }

  window.addEventListener('resize', () => {
    if (!isMobile()) {
      closeMobileSidebar();
    }
  });

  renderSidebar();

  if (activeId && findConversation(activeId)) {
    loadConversation(activeId);
  } else {
    startNewChat();
  }

  input.focus();
}

init();

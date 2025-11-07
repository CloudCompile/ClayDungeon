// script.js — module
// ClayDungeon: frontend-only Pollinations implementation
// Security: this stores token only in sessionStorage. Do not commit tokens.

const TEXT_PRIMARY = 'https://enter.pollinations.ai/api/generate/v1';
const TEXT_FALLBACK = 'https://text.pollinations.ai/openai'; // documented
const IMAGE_PRIMARY = 'https://enter.pollinations.ai/api/generate/image';
const IMAGE_FALLBACK = 'https://image.pollinations.ai/prompt'; // documented image endpoint

// UI refs
const storyEl = document.getElementById('story');
const inputForm = document.getElementById('inputForm');
const inputText = document.getElementById('inputText');
const sendBtn = document.getElementById('sendBtn');
const sceneImage = document.getElementById('sceneImage');

const settingsBtn = document.getElementById('settingsBtn');
const modal = document.getElementById('modal');
const closeModal = document.getElementById('closeModal');
const apiKeyInput = document.getElementById('apiKeyInput');
const saveSettings = document.getElementById('saveSettings');
const tryEnter = document.getElementById('tryEnter');
const clearBtn = document.getElementById('clearBtn');

let storyHistory = JSON.parse(localStorage.getItem('claydungeon_history') || '[]');
let useEnterDefault = true;

// load UI
function renderStory(){
  storyEl.innerHTML = '';
  for (const item of storyHistory){
    const b = document.createElement('div');
    b.className = `bubble ${item.role === 'user' ? 'user':'ai'}`;
    b.textContent = item.text;
    storyEl.appendChild(b);
  }
  storyEl.scrollTop = storyEl.scrollHeight;
}
renderStory();

// settings modal
settingsBtn.onclick = () => {
  apiKeyInput.value = sessionStorage.getItem('poll_key') || '';
  tryEnter.checked = localStorage.getItem('clay_try_enter') !== 'false';
  modal.classList.remove('hidden');
};
closeModal.onclick = () => modal.classList.add('hidden');
saveSettings.onclick = () => {
  const k = apiKeyInput.value.trim();
  if (k) sessionStorage.setItem('poll_key', k);
  else sessionStorage.removeItem('poll_key');
  localStorage.setItem('clay_try_enter', tryEnter.checked ? 'true':'false');
  modal.classList.add('hidden');
};
clearBtn.onclick = () => {
  if (!confirm('Clear the saved story?')) return;
  storyHistory = [];
  localStorage.removeItem('claydungeon_history');
  renderStory();
};

// helper to append story items
function pushToStory(role, text){
  storyHistory.push({role, text, time:Date.now()});
  localStorage.setItem('claydungeon_history', JSON.stringify(storyHistory));
  renderStory();
}

// attempt a POST to primary URL, if 401/403 or network fail then fallback
async function callTextAPI(promptText){
  const token = sessionStorage.getItem('poll_key') || '';
  const tryEnterFlag = localStorage.getItem('clay_try_enter') !== 'false';
  const body = {
    model: "openai",
    messages: [
      { role: "system", content: "You are a creative story-teller for an interactive text adventure. Keep answers concise and descriptive." },
      { role: "user", content: promptText }
    ],
    temperature: 0.8,
    max_tokens: 500,
    reasoning_effort: "medium"
  };

  async function postTo(url){
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { method:'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) throw res;
    return res.json();
  }

  // try user-specified enter.* endpoints first if allowed
  if (tryEnterFlag){
    try {
      const url = TEXT_PRIMARY;
      const json = await postTo(url);
      // try to extract text — pollinations responses vary so be flexible
      if (json?.choices?.[0]?.message?.content) return json.choices[0].message.content;
      if (json?.output) return (Array.isArray(json.output) ? json.output.join("\n") : json.output);
      if (typeof json === 'string') return json;
      return JSON.stringify(json);
    } catch (e) {
      console.warn('Primary text endpoint failed, falling back.', e && e.status ? `status ${e.status}` : e);
      // fallthrough to fallback
    }
  }

  // fallback: documented text.pollinations.ai "openai" endpoint via POST
  try {
    const json = await postTo(TEXT_FALLBACK);
    if (json?.choices?.[0]?.message?.content) return json.choices[0].message.content;
    if (json?.output) return (Array.isArray(json.output) ? json.output.join("\n") : json.output);
    if (typeof json === 'string') return json;
    return JSON.stringify(json);
  } catch (err) {
    console.error('Both text endpoints failed', err);
    throw new Error('Text generation failed (check console).');
  }
}

async function callImageAPI(promptText){
  const token = sessionStorage.getItem('poll_key') || '';
  const tryEnterFlag = localStorage.getItem('clay_try_enter') !== 'false';
  // For image we will use GET prompt endpoints (documented)
  // try enter.* first (if user insisted), else fallback to image.pollinations.ai/prompt
  const buildUrl = (base, p) => {
    const enc = encodeURIComponent(p);
    // configure dims optionally
    return `${base}/${enc}?width=1024&height=576`;
  };

  if (tryEnterFlag){
    try {
      const url = buildUrl(IMAGE_PRIMARY, promptText);
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw res;
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    } catch (e) {
      console.warn('Primary image endpoint failed, falling back.', e);
    }
  }

  // fallback documented endpoint
  try {
    const url = buildUrl(IMAGE_FALLBACK, promptText);
    const res = await fetch(url);
    if (!res.ok) throw res;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch (err) {
    console.error('Image generation failed', err);
    throw new Error('Image generation failed.');
  }
}

// UI flow on submit
inputForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const text = inputText.value.trim();
  if (!text) return;
  inputText.value = '';
  pushToStory('user', text);
  sendBtn.disabled = true;
  const loadingBubble = document.createElement('div');
  loadingBubble.className = 'bubble ai';
  loadingBubble.textContent = '… thinking …';
  storyEl.appendChild(loadingBubble);
  storyEl.scrollTop = storyEl.scrollHeight;

  try {
    // Build prompt that includes recent context (keeps it small: last 6 turns)
    const recent = storyHistory.slice(-12).map(i => `${i.role === 'user' ? 'Player':'Narrator'}: ${i.text}`).join('\n');
    const prompt = `${recent}\nPlayer: ${text}\nNarrator: Continue the story (short, vivid).`;

    const aiText = await callTextAPI(prompt);
    // replace loading bubble with actual
    loadingBubble.remove();
    pushToStory('ai', aiText);

    // try to auto-generate an image for the last AI text (best-effort)
    try {
      sceneImage.classList.remove('hidden');
      sceneImage.style.backgroundImage = 'linear-gradient(90deg, rgba(255,255,255,0.2), rgba(255,255,255,0.02))';
      const imgUrl = await callImageAPI(aiText.split('\n')[0] || aiText.slice(0,120));
      sceneImage.style.backgroundImage = `url(${imgUrl})`;
    } catch (imgErr){
      console.info('Image skipped:', imgErr);
      sceneImage.classList.add('hidden');
    }
  } catch (err) {
    loadingBubble.remove();
    pushToStory('ai', `Error: ${err.message || 'Unknown error'}`);
  } finally {
    sendBtn.disabled = false;
  }
});

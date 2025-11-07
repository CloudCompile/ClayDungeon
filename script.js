// ClayDungeon AI-Dungeon style
const TEXT_PRIMARY = 'https://enter.pollinations.ai/api/generate/v1';
const TEXT_FALLBACK = 'https://text.pollinations.ai/openai';
const IMAGE_PRIMARY = 'https://enter.pollinations.ai/api/generate/image';
const IMAGE_FALLBACK = 'https://image.pollinations.ai/prompt';

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

function renderStory() {
  storyEl.innerHTML = '';
  for (const item of storyHistory) {
    const b = document.createElement('div');
    b.className = `bubble ${item.role === 'user' ? 'user' : 'ai'}`;
    b.textContent = item.text;
    storyEl.appendChild(b);
    if (item.choices) {
      const choicesContainer = document.createElement('div');
      choicesContainer.className = 'choices';
      for (const c of item.choices) {
        const btn = document.createElement('button');
        btn.className = 'btn ghost';
        btn.textContent = c;
        btn.onclick = () => {
          inputText.value = c;
          inputForm.dispatchEvent(new Event('submit'));
        };
        choicesContainer.appendChild(btn);
      }
      storyEl.appendChild(choicesContainer);
    }
  }
  storyEl.scrollTop = storyEl.scrollHeight;
}
renderStory();

// Modal handlers
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
  localStorage.setItem('clay_try_enter', tryEnter.checked ? 'true' : 'false');
  modal.classList.add('hidden');
};
clearBtn.onclick = () => {
  if (!confirm('Clear the saved story?')) return;
  storyHistory = [];
  localStorage.removeItem('claydungeon_history');
  renderStory();
};

// Helper
function pushToStory(role, text, choices = null) {
  storyHistory.push({ role, text, choices, time: Date.now() });
  localStorage.setItem('claydungeon_history', JSON.stringify(storyHistory));
  renderStory();
}

// Pollinations API wrapper
async function callTextAPI(promptText) {
  const token = sessionStorage.getItem('poll_key') || '';
  const tryEnterFlag = localStorage.getItem('clay_try_enter') !== 'false';
  const body = {
    model: "openai",
    messages: [
      {
        role: "system",
        content: `You are a Game Master for an interactive text adventure. 
Respond vividly, describe environment, characters, consequences of actions. 
At the end, suggest 2-4 concise next moves for the player in format: [Option 1] | [Option 2] ...`
      },
      { role: "user", content: promptText }
    ],
    temperature: 0.8,
    max_tokens: 500
  };

  async function postTo(url) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) throw res;
    return res.json();
  }

  if (tryEnterFlag) {
    try { return extractText(await postTo(TEXT_PRIMARY)); } catch { }
  }
  return extractText(await postTo(TEXT_FALLBACK));
}

function extractText(json) {
  let text = '';
  if (json?.choices?.[0]?.message?.content) text = json.choices[0].message.content;
  else if (json?.output) text = Array.isArray(json.output) ? json.output.join('\n') : json.output;
  else if (typeof json === 'string') text = json;
  else text = JSON.stringify(json);
  // try parsing AI suggested choices
  const choiceRegex = /\[([^\]]+)\]/g;
  let choices = [];
  let m;
  while ((m = choiceRegex.exec(text)) !== null) {
    choices.push(m[1].trim());
  }
  // remove choices from text for cleaner display
  const cleanText = text.replace(/\s*\[[^\]]+\]/g, '').trim();
  return { text: cleanText, choices };
}

async function callImageAPI(promptText) {
  const token = sessionStorage.getItem('poll_key') || '';
  const tryEnterFlag = localStorage.getItem('clay_try_enter') !== 'false';
  const buildUrl = (base, p) => `${base}/${encodeURIComponent(p)}?width=1024&height=576`;
  try {
    if (tryEnterFlag) {
      const url = buildUrl(IMAGE_PRIMARY, promptText);
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(url, { headers });
      if (!res.ok) throw res;
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    }
    const url = buildUrl(IMAGE_FALLBACK, promptText);
    const res = await fetch(url);
    if (!res.ok) throw res;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch { return null; }
}

// Submit
inputForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const rawText = inputText.value.trim();
  if (!rawText) return;
  inputText.value = '';
  pushToStory('user', rawText);

  sendBtn.disabled = true;
  const loadingBubble = document.createElement('div');
  loadingBubble.className = 'bubble ai';
  loadingBubble.textContent = '… thinking …';
  storyEl.appendChild(loadingBubble);
  storyEl.scrollTop = storyEl.scrollHeight;

  try {
    const recent = storyHistory.slice(-12).map(i => `${i.role === 'user' ? 'Player' : 'Narrator'}: ${i.text}`).join('\n');
    const cmdMatch = rawText.match(/^(Do|Say|Story):\s*(.*)$/i);
    const userInput = cmdMatch ? `${cmdMatch[1]}: ${cmdMatch[2]}` : `Do: ${rawText}`;
    const prompt = `${recent}\nPlayer: ${userInput}\nNarrator: Continue the story.`;
    const aiResp = await callTextAPI(prompt);
    loadingBubble.remove();
    pushToStory('ai', aiResp.text, aiResp.choices.length ? aiResp.choices : null);

    try {
      const imgUrl = await callImageAPI(aiResp.text.slice(0, 120));
      if (imgUrl) {
        sceneImage.classList.remove('hidden');
        sceneImage.style.backgroundImage = `url(${imgUrl})`;
      } else sceneImage.classList.add('hidden');
    } catch { sceneImage.classList.add('hidden'); }

  } catch (err) {
    loadingBubble.remove();
    pushToStory('ai', `Error: ${err.message || 'Unknown error'}`);
  } finally { sendBtn.disabled = false; }
});

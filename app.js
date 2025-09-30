// Minimal Bingo app using Supabase
const urlEl = document.getElementById('url');
const keyEl = document.getElementById('key');
const saveBtn = document.getElementById('saveEnv');
const signInBtn = document.getElementById('signin');
const signOutBtn = document.getElementById('signout');
const whoEl = document.getElementById('who');
const statsEl = document.getElementById('stats');
const debugEl = document.getElementById('debug');
const boardEl = document.getElementById('board');

// Load saved env
const saved = JSON.parse(localStorage.getItem('lapco_env') || '{}');
urlEl.value = saved.url || '';
keyEl.value = saved.key || '';

let supa = null;
let session = null;
let user = null;

function ensureClient(){
  const url = urlEl.value.trim();
  const key = keyEl.value.trim();
  if(!url || !key){ alert('Enter SUPABASE URL and Publishable key'); return null; }
  if(!supa){
    supa = window.supabase.createClient(url, key);
  }
  return supa;
}

saveBtn.onclick = ()=>{
  localStorage.setItem('lapco_env', JSON.stringify({url:urlEl.value.trim(), key:keyEl.value.trim()}));
  alert('Saved settings.');
};

signInBtn.onclick = async ()=>{
  if(!ensureClient()) return;
  await supa.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin }});
};

signOutBtn.onclick = async ()=>{
  if(!ensureClient()) return;
  await supa.auth.signOut();
  session = null; user = null;
  whoEl.textContent = 'Not signed in';
  debugEl.textContent = '(none)';
  renderBoard([]);
};

async function boot(){
  if(!ensureClient()) return;
  const { data: { session: s } } = await supa.auth.getSession();
  session = s; user = s?.user || null;
  if(user){
    whoEl.textContent = `Signed in as ${user.user_metadata?.full_name || user.email}`;
    debugEl.textContent = JSON.stringify(session, null, 2);
  }else{
    whoEl.textContent = 'Not signed in';
  }
  await loadAndRender();
}

const TILES = [
  'Attend a morning class',
  'Try a new instructor',
  'Bring a friend',
  'Do 10 minutes of stretching',
  'Complete 3 classes this week',
  'Share a studio post',
  'Hydrate: 64oz water',
  'Post-class selfie (tag us)',
  'Free space',
  'Take a reformer class',
  'Do a mat workout at home',
  'Leave a review',
  'Attend an evening class',
  'Try a new class type',
  'Book next week early',
  'Core focus day',
  'Balance work: single-leg',
  'Mobility day',
  'Bring your own mat',
  'Foam roll 5 minutes',
  'Ask a question',
  'Stretch with a friend',
  'Try a resistance band',
  'Walk 15 minutes',
  'Mindfulness 5 minutes'
];

async function loadAndRender(){
  if(!ensureClient()) return;
  // fetch user completions (if logged in)
  let completedCodes = [];
  if(user){
    const { data, error } = await supa.from('completions').select('tile_code').eq('user_id', user.id);
    if(error){ console.error(error); } else { completedCodes = data.map(r=>r.tile_code); }
  }
  renderBoard(completedCodes);
}

function renderBoard(done){
  boardEl.innerHTML = '';
  statsEl.textContent = user ? `Completed ${done.length}/25` : 'Sign in to track your progress';
  TILES.forEach((label, i)=>{
    const code = `r${Math.floor(i/5)}c${i%5}`;
    const cell = document.createElement('div');
    cell.className = 'tile' + (done.includes(code) ? ' done' : '');
    cell.innerHTML = `<div class="check">${done.includes(code) ? '✓' : ''}</div><div>${label}</div>`;
    cell.onclick = async ()=>{
      if(!user){ alert('Sign in to mark tiles'); return; }
      const isDone = cell.classList.contains('done');
      if(isDone){
        const { error } = await ensureClient().from('completions').delete().eq('user_id', user.id).eq('tile_code', code);
        if(error){ alert('Error removing'); console.error(error); return; }
        cell.classList.remove('done'); cell.querySelector('.check').textContent = '';
      }else{
        const { error } = await ensureClient().from('completions').insert({ user_id: user.id, tile_code: code });
        if(error){ alert('Error saving'); console.error(error); return; }
        cell.classList.add('done'); cell.querySelector('.check').textContent = '✓';
      }
      const n = document.querySelectorAll('.tile.done').length;
      statsEl.textContent = `Completed ${n}/25`;
    };
    boardEl.appendChild(cell);
  });
}

boot();
document.getElementById('signin')?.addEventListener('click', async () => {
  await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
});

document.getElementById('signout')?.addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  window.location.reload();
});
document.getElementById('who').textContent = currentUser
  ? `Signed in: ${currentUser.email}`
  : 'Not signed in';

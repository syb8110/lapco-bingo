// ===== LAPCo Bingo — env-driven Supabase client =====
const urlEl = document.getElementById('url');
const keyEl = document.getElementById('key');
const saveBtn = document.getElementById('saveEnv');
const signInBtn = document.getElementById('signin');
const signOutBtn = document.getElementById('signout');
const whoEl = document.getElementById('who');
const statsEl = document.getElementById('stats');
const debugEl = document.getElementById('debug');
const boardEl = document.getElementById('board');
const claimBarEl = document.getElementById('claimbar');

// Load saved env
const saved = JSON.parse(localStorage.getItem('lapco_env') || '{}');
urlEl.value = saved.url || '';
keyEl.value = saved.key || '';

let supa = null;
let user = null;

// ===== Utilities =====
const $ = (sel)=>document.querySelector(sel);

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

// ===== KSU tiles (no Free Space; doubles; “Any Class Type”) =====
const KSU_TILES = [
  // Classes (doubled)
  "Aerial class","Aerial class",
  "Reformer class","Reformer class",
  "Yoga class","Yoga class",
  "Dance class","Dance class",
  "Stretching class","Stretching class",
  "Soundbath class","Soundbath class",
  // Instagram (doubled)
  "IG reel + tag @LAPCo","IG reel + tag @LAPCo",
  "IG post + tag @LAPCo","IG post + tag @LAPCo",
  // Purchases / actions
  "Bring a friend for free (space permitting)",
  "Buy socks ($8)",
  "Buy a booty band ($8)",
  "Buy a shirt from our website",
  "Leave a 5-star Google review",
  "Try sauna ($10)",
  "Try vibration plate ($7)",
  "InBody scan ($15)",
  // Replacement for free space
  "Any Class Type"
];

function shuffle(arr){
  const a = [...arr];
  for (let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}
function codeAt(i){ const r=Math.floor(i/5), c=i%5; return `r${r}c${c}`; }

function hasBingo(done){
  const L = [
    ['r0c0','r0c1','r0c2','r0c3','r0c4'],
    ['r1c0','r1c1','r1c2','r1c3','r1c4'],
    ['r2c0','r2c1','r2c2','r2c3','r2c4'],
    ['r3c0','r3c1','r3c2','r3c3','r3c4'],
    ['r4c0','r4c1','r4c2','r4c3','r4c4'],
    ['r0c0','r1c0','r2c0','r3c0','r4c0'],
    ['r0c1','r1c1','r2c1','r3c1','r4c1'],
    ['r0c2','r1c2','r2c2','r3c2','r4c2'],
    ['r0c3','r1c3','r2c3','r3c3','r4c3'],
    ['r0c4','r1c4','r2c4','r3c4','r4c4'],
    ['r0c0','r1c1','r2c2','r3c3','r4c4'],
    ['r0c4','r1c3','r2c2','r3c1','r4c0'],
  ];
  return L.some(line => line.every(c => done.includes(c)));
}
function hasBlackout(done){ return done.length === 25; }

// ===== Auth buttons =====
signInBtn.onclick = async ()=>{
  if(!ensureClient()) return;
  await supa.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
};
signOutBtn.onclick = async ()=>{
  if(!ensureClient()) return;
  await supa.auth.signOut();
  user = null;
  whoEl.textContent = 'Not signed in';
  statsEl.textContent = '';
  debugEl.textContent = '(none)';
  boardEl.innerHTML = '';
  claimBarEl.innerHTML = '';
};

// ===== Consent (profiles) =====
async function ensureConsent(userId){
  const { data, error } = await supa
    .from('profiles').select('consent').eq('id', userId).maybeSingle();
  if (error){ console.error(error); return; }
  if (!data){
    await supa.from('profiles').insert({ id: userId, consent: false });
  }
  const needs = !data || data.consent === false;
  if (needs){
    const modal = document.getElementById('consentModal');
    modal.style.display = 'flex';
    document.getElementById('consentAgree').onclick = async ()=>{
      await supa.from('profiles').update({ consent: true }).eq('id', userId);
      modal.style.display = 'none';
    };
  }
}

// ===== Per-user board labels (user_card_cells) =====
async function loadUserBoardLabels(){
  const { data, error } = await supa
    .from('user_card_cells')
    .select('tile_code,label')
    .eq('user_id', user.id)
    .order('tile_code', { ascending: true });
  if (error){ console.error(error); }
  if (data && data.length === 25) return data;

  // seed
  const shuffled = shuffle(KSU_TILES);
  const rows = shuffled.map((label, i)=>({
    user_id: user.id,
    tile_code: codeAt(i),
    label
  }));
  const ins = await supa.from('user_card_cells').insert(rows);
  if (ins.error){ console.error(ins.error); }
  return rows;
}

// ===== Completions (stamps) =====
async function loadCompletions(){
  const { data, error } = await supa
    .from('completions')
    .select('tile_code')
    .eq('user_id', user.id);
  if (error){ console.error(error); return []; }
  return data.map(r => r.tile_code);
}
async function setCompletion(tile_code, done){
  if (done){
    await supa.from('completions').insert({ user_id: user.id, tile_code });
  } else {
    await supa.from('completions').delete()
      .eq('user_id', user.id).eq('tile_code', tile_code);
  }
}

// ===== Claim UI =====
async function renderClaimBar(done){
  const bar = claimBarEl;
  if(!user){ bar.innerHTML=''; return; }

  const bingo = hasBingo(done);
  const blackout = hasBlackout(done);

  async function logAndEmail(kind){
    const { error } = await supa.from('claims').insert({
      user_id: user.id,
      email: user.email,
      kind,
      tiles: done
    });
    if (error){ alert('Error logging claim; please tell the front desk.'); console.error(error); return; }
    const subject = encodeURIComponent(kind === 'blackout' ? 'Blackout claim' : 'Bingo claim');
    const body = encodeURIComponent(
      `User: ${user.email}\nKind: ${kind}\nTiles: ${done.join(', ')}\nTime: ${new Date().toLocaleString()}`
    );
    window.location.href = `mailto:powercatpilates@gmail.com?subject=${subject}&body=${body}`;
  }

  if (blackout){
    bar.innerHTML = `<button id="claimBtn" style="padding:10px 14px;border-radius:10px;background:#27d27d;color:#000;font-weight:800;border:none;cursor:pointer">Email studio & log Blackout</button>`;
    document.getElementById('claimBtn').onclick = ()=>logAndEmail('blackout');
  } else if (bingo){
    bar.innerHTML = `<button id="claimBtn" style="padding:10px 14px;border-radius:10px;background:#ffd166;color:#000;font-weight:800;border:none;cursor:pointer">Email studio & log Bingo</button>`;
    document.getElementById('claimBtn').onclick = ()=>logAndEmail('bingo');
  } else {
    bar.innerHTML = '';
  }
}

// ===== Render board =====
async function renderBoard(){
  const labels = await loadUserBoardLabels();
  let done = await loadCompletions();

  boardEl.innerHTML = '';
  labels.forEach(({tile_code, label})=>{
    const cell = document.createElement('div');
    cell.className = 'tile' + (done.includes(tile_code) ? ' done' : '');
    const span = document.createElement('span');
    span.textContent = label;
    cell.appendChild(span);
    cell.onclick = async ()=>{
      const willBeDone = !cell.classList.contains('done');
      cell.classList.toggle('done', willBeDone);
      await setCompletion(tile_code, willBeDone);
      done = await loadCompletions();
      statsEl.textContent = `Completed ${done.length}/25`;
      renderClaimBar(done);
    };
    boardEl.appendChild(cell);
  });

  statsEl.textContent = `Completed ${done.length}/25`;
  renderClaimBar(done);
}

// ===== Boot =====
async function boot(){
  if(!ensureClient()) return;

  // Reflect session
  const { data: { session } } = await supa.auth.getSession();
  user = session?.user || null;

  whoEl.textContent = user ? `Signed in as ${user.user_metadata?.full_name || user.email}` : 'Not signed in';
  debugEl.textContent = session ? JSON.stringify(session, null, 2) : '(none)';

  if (!user){
    // not signed in yet
    boardEl.innerHTML = '';
    claimBarEl.innerHTML = '';
    statsEl.textContent = '';
    return;
  }

  // consent, then board
  await ensureConsent(user.id);
  await renderBoard();
}

// react to OAuth redirects
function watchAuth(){
  if(!ensureClient()) return;
  supa.auth.onAuthStateChange((_evt, sess)=>{
    const u = sess?.user || null;
    if (u && (!user || u.id !== user.id)){
      user = u;
      whoEl.textContent = `Signed in as ${user.user_metadata?.full_name || user.email}`;
      debugEl.textContent = JSON.stringify(sess, null, 2);
      ensureConsent(user.id).then(renderBoard);
    }
    if (!u){
      whoEl.textContent = 'Not signed in';
      debugEl.textContent = '(none)';
      boardEl.innerHTML = '';
      claimBarEl.innerHTML = '';
      statsEl.textContent = '';
    }
  });
}

boot();
watchAuth();

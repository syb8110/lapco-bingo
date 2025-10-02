/* =========================
   LAPCo Bingo — Production
   ========================= */

/* === Supabase config (public anon key is OK to embed) === */
const SUPABASE_URL = 'https://flknutfjusmbxfgdthcu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_805-pUNi1vu6mhUA7Y9UTw_Yv8QAKbD';
const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* === State & UI refs === */
let user = null;
let ACTIVE_CONTEST = null;

const whoEl      = document.getElementById('who');
const statsEl    = document.getElementById('stats');
const debugEl    = document.getElementById('debug');
const boardEl    = document.getElementById('board');
const claimBarEl = document.getElementById('claimbar');
const emailInput = document.getElementById('emailInput');
const emailBtn   = document.getElementById('emailLogin');

/* === Utilities === */
const $ = (sel)=>document.querySelector(sel);
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

// deterministic shuffle (locks board per user+contest)
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; } }
function hashString(s){ let h=2166136261>>>0; for (let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
function seededShuffle(arr, seedStr){
  const rnd = mulberry32(hashString(seedStr));
  const a = [...arr];
  for (let i=a.length-1;i>0;i--){
    const j = Math.floor(rnd()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

/* ---------- Artwork loader: set background AND auto-detect aspect ratio ---------- */
async function setArtBackground(url){
  const art = document.querySelector('.art');
  if (!art) return;
  art.style.backgroundImage = `url('${url}')`;
  await new Promise((resolve)=>{
    const img = new Image();
    img.onload = ()=>{
      const ratio = img.naturalWidth / img.naturalHeight;  // width / height
      document.documentElement.style.setProperty('--art-ratio', ratio);
      resolve();
    };
    img.onerror = resolve;
    img.src = url;
  });
}

/* ---------- Leaderboard ---------- */
async function loadLeaderboard(){
  const box = document.getElementById('leaderboard');
  if (!box) return;
  try {
    const { data, error } = await supa.rpc('leaderboard_public', { limit_n: 10 });
    if (error) { console.error('leaderboard', error); box.innerHTML = '<div style="opacity:.7">Unavailable</div>'; return; }
    if (!data || data.length === 0) { box.innerHTML = '<div style="opacity:.7">No entries yet. Be the first!</div>'; return; }
    const rows = data.map((r, i) =>
      `<div style="display:flex;justify-content:space-between;padding:8px 10px;border-bottom:1px solid #222">
         <div><strong>#${i+1}</strong> ${r.display_name || 'Player'}</div>
         <div>${r.tiles_done} tiles</div>
       </div>`
    ).join('');
    box.innerHTML = rows;
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div style="opacity:.7">Unavailable</div>';
  }
}

/* ---------- Active contest loader (sets background + ratio FIRST) ---------- */
async function loadActiveContest(){
  const { data, error } = await supa
    .from('contests')
    .select('*')
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data){
    console.error('No active contest', error);
    await setArtBackground('/october-halloween-bingo.png'); // fallback still works
    return null;
  }

  ACTIVE_CONTEST = data;

  // Use Storage art if present; else fallback
  let artUrl = '/october-halloween-bingo.png';
  if (ACTIVE_CONTEST.bg_image_path){
    const { data: pub } = supa.storage.from('bingo').getPublicUrl(ACTIVE_CONTEST.bg_image_path);
    if (pub?.publicUrl) artUrl = pub.publicUrl;
  }

  await setArtBackground(artUrl); // also sets --art-ratio
  return ACTIVE_CONTEST;
}

/* ---------- Consent (shows once) ---------- */
async function ensureConsent(userId){
  let { data, error } = await supa
    .from('profiles')
    .select('consent')
    .eq('id', userId)
    .maybeSingle();
  if (error) { console.error('profiles select', error); return; }

  if (!data){
    const ins = await supa
      .from('profiles')
      .upsert({ id: userId, consent: false })
      .select('consent')
      .single();
    if (ins.error) { console.error('profiles upsert', ins.error); return; }
    data = ins.data;
  }

  if (data?.consent === true) return;

  const modal = document.getElementById('consentModal');
  modal.style.display = 'flex';
  document.getElementById('consentAgree').onclick = async ()=>{
    const upd = await supa.from('profiles').update({ consent: true }).eq('id', userId).select().single();
    if (upd.error) { console.error('profiles update', upd.error); return; }
    modal.style.display = 'none';
  };
}

/* ---------- Tiles (from contest row if present; fallback otherwise) ---------- */
function getContestTiles(){
  const t = Array.isArray(ACTIVE_CONTEST?.tiles) ? ACTIVE_CONTEST.tiles : null;
  if (t && t.length === 25) return t;
  return [
    "Aerial class","Aerial class",
    "Reformer class","Reformer class",
    "Yoga class","Yoga class",
    "Dance class","Dance class",
    "Stretching class","Stretching class",
    "Soundbath class","Soundbath class",
    "IG reel + tag @LAPCo","IG reel + tag @LAPCo",
    "IG post + tag @LAPCo","IG post + tag @LAPCo",
    "Bring a friend for free (space permitting)",
    "Buy socks ($8)",
    "Buy a booty band ($8)",
    "Buy a shirt from our website",
    "Leave a 5-star Google review",
    "Try sauna ($10)",
    "Try vibration plate ($7)",
    "InBody scan ($15)",
    "Any Class Type"
  ];
}

/* ---------- Stamp URL ---------- */
function getStampUrl(){
  if (ACTIVE_CONTEST?.stamp_image_path){
    const { data:pub } = supa.storage.from('bingo').getPublicUrl(ACTIVE_CONTEST.stamp_image_path);
    if (pub?.publicUrl) return pub.publicUrl;
  }
  return '/apple-core-stamp.png';
}

/* ---------- Per-user board labels (contest-scoped, locked) ---------- */
async function loadUserBoardLabels(){
  const contestId = ACTIVE_CONTEST.id;

  const { data, error } = await supa
    .from('user_card_cells')
    .select('tile_code,label')
    .eq('user_id', user.id)
    .eq('contest_id', contestId)
    .order('tile_code', { ascending: true });

  if (error){ console.error('user_card_cells select', error); }

  if (data && data.length === 25) return data;

  if (data && data.length > 0){
    const del = await supa
      .from('user_card_cells')
      .delete()
      .eq('user_id', user.id)
      .eq('contest_id', contestId);
    if (del.error){ console.error('user_card_cells cleanup', del.error); }
  }

  const tiles = getContestTiles();
  const seed = `${user.id}::${contestId}`;
  const shuffled = seededShuffle(tiles, seed);

  const rows = shuffled.map((label, i)=>({
    user_id: user.id,
    contest_id: contestId,
    tile_code: codeAt(i),
    label
  }));

  const ins = await supa.from('user_card_cells').upsert(rows);
  if (ins.error){ console.error('user_card_cells upsert', ins.error); }

  return rows;
}

/* ---------- Completions (stamps) ---------- */
async function loadCompletions(){
  const contestId = ACTIVE_CONTEST.id;
  const { data, error } = await supa
    .from('completions')
    .select('tile_code')
    .eq('user_id', user.id)
    .eq('contest_id', contestId);
  if (error){ console.error('completions select', error); return []; }
  return (data||[]).map(r=>r.tile_code);
}
async function setCompletion(tile_code, done){
  const contestId = ACTIVE_CONTEST.id;
  if (done){
    const { error } = await supa.from('completions')
      .insert({ user_id: user.id, contest_id: contestId, tile_code });
    if (error) console.error('completion insert', error);
  } else {
    const { error } = await supa.from('completions')
      .delete()
      .eq('user_id', user.id)
      .eq('contest_id', contestId)
      .eq('tile_code', tile_code);
    if (error) console.error('completion delete', error);
  }
}

/* ---------- Claims (Bingo/Blackout) ---------- */
async function renderClaimBar(done){
  const bar = claimBarEl;
  if(!user){ bar.innerHTML=''; return; }

  const bingo = hasBingo(done);
  const blackout = hasBlackout(done);
  const contestId = ACTIVE_CONTEST.id;

  async function logAndEmail(kind){
    if (kind === 'bingo'){
      const { data: claimed } = await supa
        .from('claims').select('id')
        .eq('user_id', user.id).eq('contest_id', contestId).eq('kind','bingo')
        .maybeSingle();
      if (claimed){ alert('Bingo already claimed for this contest — go for Blackout!'); return; }
    }

    const { error } = await supa.from('claims').insert({
      user_id: user.id,
      contest_id: contestId,
      email: user.email,
      kind,
      tiles: done
    });
    if (error){ alert('Error logging claim; please tell the front desk.'); console.error(error); return; }

    const subject = encodeURIComponent(kind === 'blackout' ? 'Blackout claim' : 'Bingo claim');
    const body = encodeURIComponent(
      `User: ${user.email}\nContest: ${contestId}\nKind: ${kind}\nTiles: ${done.join(', ')}\nTime: ${new Date().toLocaleString()}`
    );
    window.location.href = `mailto:powercatpilates@gmail.com?subject=${subject}&body=${body}`;
  }

  if (blackout){
    bar.innerHTML = `<button id="claimBtn" style="padding:10px 14px;border-radius:10px;background:#27d27d;color:#000;font-weight:800;border:none;cursor:pointer">Email studio & log Blackout</button>`;
    $('#claimBtn').onclick = ()=>logAndEmail('blackout');
  } else if (bingo){
    bar.innerHTML = `<button id="claimBtn" style="padding:10px 14px;border-radius:10px;background:#ffd166;color:#000;font-weight:800;border:none;cursor:pointer">Email studio & log Bingo</button>`;
    $('#claimBtn').onclick = ()=>logAndEmail('bingo');
  } else {
    bar.innerHTML = '';
  }

  if (debugEl){
    debugEl.textContent = JSON.stringify(
      { doneCount: done.length, hasBingo: bingo, hasBlackout: blackout }, null, 2
    );
  }
}

/* ---------- Render board ---------- */
async function renderBoard(){
  const labels = await loadUserBoardLabels();
  let done = await loadCompletions();
  const stampUrl = getStampUrl();

  boardEl.innerHTML = '';
  labels.forEach(({tile_code, label})=>{
    const cell = document.createElement('div');
    cell.className = 'tile' + (done.includes(tile_code) ? ' done' : '');
    const span = document.createElement('span');
    span.textContent = label;
    cell.appendChild(span);

    function syncStamp(){
      const existing = cell.querySelector('.stamp');
      if (cell.classList.contains('done')){
        if (!existing){
          const s = document.createElement('div');
          s.className = 'stamp';
          s.setAttribute('style',
            `background-image:url('${stampUrl}');background-position:center;background-size:80%;background-repeat:no-repeat;position:absolute;inset:0;opacity:.85;transform:rotate(-8deg);pointer-events:none;`);
          cell.appendChild(s);
        }
      } else {
        existing?.remove();
      }
    }
    syncStamp();

    cell.onclick = async ()=>{
      const willBeDone = !cell.classList.contains('done');
      cell.classList.toggle('done', willBeDone);
      syncStamp();
      await setCompletion(tile_code, willBeDone);
      done = await loadCompletions();
      statsEl.textContent = `Completed ${done.length}/25`;
      renderClaimBar(done);
      loadLeaderboard();
    };

    boardEl.appendChild(cell);
  });

  statsEl.textContent = `Completed ${done.length}/25`;
  renderClaimBar(done);
}

/* ---------- Admin helpers ---------- */
async function amIAdmin() {
  if (!user) return false;
  const { data, error } = await supa
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();
  if (error) { console.error('admin check', error); return false; }
  return !!data?.is_admin;
}
function setAdminMsg(msg) {
  const el = document.getElementById('adminMsg');
  if (el) el.textContent = msg;
}
function linesToTiles(text) {
  return text.split('\n').map(s => s.trim()).filter(Boolean);
}
function tilesToLines(arr) {
  return Array.isArray(arr) ? arr.join('\n') : '';
}
async function loadContestIntoAdmin() {
  if (!ACTIVE_CONTEST) return;
  $('#contestId').value   = ACTIVE_CONTEST.id || '';
  $('#contestName').value = ACTIVE_CONTEST.name || '';
  $('#tilesText').value   = tilesToLines(ACTIVE_CONTEST.tiles || []);
}
async function saveTilesFromAdmin() {
  const contestId = $('#contestId').value.trim();
  const name      = $('#contestName').value.trim();
  const tilesArr  = linesToTiles($('#tilesText').value);
  if (!contestId || !name) return setAdminMsg('Contest ID and Name are required.');
  if (tilesArr.length !== 25) return setAdminMsg(`Please enter exactly 25 tiles (you have ${tilesArr.length}).`);
  const { error } = await supa.from('contests').upsert({ id: contestId, name, tiles: tilesArr });
  if (error) return setAdminMsg('Error saving tiles: ' + error.message);
  setAdminMsg('Tiles saved.');
  if (ACTIVE_CONTEST && ACTIVE_CONTEST.id === contestId) {
    ACTIVE_CONTEST.tiles = tilesArr;
    await renderBoard();
  }
}
async function uploadImage(fileInputId, targetField) {
  const file = document.getElementById(fileInputId)?.files?.[0];
  if (!file) return setAdminMsg('No file selected.');
  const contestId = $('#contestId').value.trim() || (ACTIVE_CONTEST && ACTIVE_CONTEST.id);
  if (!contestId) return setAdminMsg('Contest ID is required first.');
  const ext = (file.name.toLowerCase().endsWith('.png') ? '.png' : '.jpg');
  const base = (targetField === 'bg_image_path') ? 'background' : 'stamp';
  const path = `${contestId}/${base}${ext}`;
  const { error: upErr } = await supa.storage.from('bingo').upload(path, file, { upsert: true });
  if (upErr) return setAdminMsg('Upload failed: ' + upErr.message);
  const { error: updErr } = await supa.from('contests').update({ [targetField]: path }).eq('id', contestId);
  if (updErr) return setAdminMsg('Could not update contest row: ' + updErr.message);
  setAdminMsg(`${base} uploaded.`);
  if (ACTIVE_CONTEST && ACTIVE_CONTEST.id === contestId && targetField === 'bg_image_path') {
    const { data:pub } = supa.storage.from('bingo').getPublicUrl(path);
    const img = document.querySelector('.art'); // background on .art now
    if (img && pub?.publicUrl) await setArtBackground(pub.publicUrl);
  }
}
async function setActiveContest() {
  const contestId = $('#contestId').value.trim();
  if (!contestId) return setAdminMsg('Contest ID required.');
  await supa.from('contests').update({ is_active: false }).neq('id', contestId);
  await supa.from('contests').update({ is_active: true }).eq('id', contestId);
  setAdminMsg('Active contest set.');
  await loadActiveContest();
  if (user) await renderBoard();
}
async function showAdminIfNeeded() {
  const panel = document.getElementById('adminPanel');
  if (!panel) return;
  if (!user) { panel.style.display = 'none'; return; }
  const admin = await amIAdmin();
  panel.style.display = admin ? 'block' : 'none';
  if (admin) {
    await loadActiveContest();
    await loadContestIntoAdmin();
    document.getElementById('saveTiles').onclick   = saveTilesFromAdmin;
    document.getElementById('uploadBg').onclick    = ()=>uploadImage('bgFile','bg_image_path');
    document.getElementById('uploadStamp').onclick = ()=>uploadImage('stampFile','stamp_image_path');
    document.getElementById('setActive').onclick   = setActiveContest;
  }
}

/* ---------- Auth & boot ---------- */
document.getElementById('signin').onclick = async ()=>{
  await supa.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: window.location.origin }});
};
document.getElementById('signout').onclick = async ()=>{
  await supa.auth.signOut();
  window.location.reload();
};
/* Email magic link login (non-Google) */
if (emailBtn){
  emailBtn.onclick = async ()=>{
    const email = (emailInput?.value || '').trim();
    if (!email){ alert('Enter an email'); return; }
    const { error } = await supa.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin }
    });
    if (error){ alert('Could not send login link.'); console.error(error); return; }
    alert('Check your email for the login link.');
  };
}

/* Display name prompt (leaderboard username) */
async function ensureDisplayName(userId){
  const { data, error } = await supa
    .from('profiles')
    .select('display_name')
    .eq('id', userId)
    .maybeSingle();
  if (error) { console.error('display_name select', error); return; }
  const current = data?.display_name?.trim();
  if (current) return;
  const modal = document.getElementById('nameModal');
  const input = document.getElementById('nameInput');
  const save  = document.getElementById('nameSave');
  modal.style.display = 'flex';
  const suggestion = (user?.email || '').split('@')[0];
  if (suggestion && !input.value) input.value = suggestion;
  save.onclick = async ()=>{
    const val = (input.value || '').trim().slice(0, 40);
    if (!val){ alert('Please enter a name'); return; }
    const { error: updErr } = await supa.from('profiles').update({ display_name: val }).eq('id', userId);
    if (updErr){ alert('Could not save name'); console.error(updErr); return; }
    modal.style.display = 'none';
    loadLeaderboard();
  };
}

/* Boot order: contest/art FIRST, then board */
async function boot(){
  const { data:{ session } } = await supa.auth.getSession();
  user = session?.user || null;
  whoEl.textContent = user ? `Signed in: ${user.user_metadata?.full_name || user.email}` : 'Not signed in';
  debugEl.textContent = session ? JSON.stringify(session, null, 2) : '(none)';

  await loadActiveContest();   // sets art + --art-ratio first
  loadLeaderboard();           // can show logged-out too

  if (!user) return;

  await ensureConsent(user.id);
  await ensureDisplayName(user.id);
  await renderBoard();
  await showAdminIfNeeded();
}

/* React to auth state changes */
supa.auth.onAuthStateChange(async (_evt, sess)=>{
  user = sess?.user || null;
  if (user) {
    whoEl.textContent = `Signed in as ${user.user_metadata?.full_name || user.email}`;
    await ensureConsent(user.id);
    await ensureDisplayName(user.id);
    await loadActiveContest(); // make sure art/ratio are ready
    await renderBoard();
    await showAdminIfNeeded();
    loadLeaderboard();
  } else {
    whoEl.textContent = 'Not signed in';
    boardEl.innerHTML = '';
    claimBarEl.innerHTML = '';
    statsEl.textContent = '';
    const panel = document.getElementById('adminPanel');
    if (panel) panel.style.display = 'none';
  }
});

boot();


/* ===== Config (embed these so no inputs are needed) ===== */
const SUPABASE_URL = 'https://flknutfjusmbxfgdthcu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_805-pUNi1vu6mhUA7Y9UTw_Yv8QAKbD';
const CONTEST_ID   = 'October2025';                             // <-- change monthly

/* ===== Supabase ===== */
const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let user = null;

/* ===== UI refs ===== */
const whoEl = document.getElementById('who');
const statsEl = document.getElementById('stats');
const debugEl = document.getElementById('debug');
const boardEl = document.getElementById('board');
const claimBarEl = document.getElementById('claimbar');

/* ===== Tiles (no Free Space; doubles; Any Class Type) ===== */
const KSU_TILES = [
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

/* ===== Utils ===== */
const $ = (sel)=>document.querySelector(sel);
function shuffle(a){ a=[...a]; for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; }
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

/* ===== Consent ===== */
async function ensureConsent(userId){
  const { data } = await supa.from('profiles').select('consent').eq('id', userId).maybeSingle();
  if (!data){ await supa.from('profiles').insert({ id: userId, consent: false }); }
  const needs = !data || data.consent === false;
  if (needs){
    const modal = $('#consentModal');
    modal.style.display = 'flex';
    $('#consentAgree').onclick = async ()=>{
      await supa.from('profiles').update({ consent: true }).eq('id', userId);
      modal.style.display = 'none';
    };
  }
}

/* ===== Board labels per user (contest-scoped) ===== */
async function loadUserBoardLabels(){
  const { data } = await supa
    .from('user_card_cells')
    .select('tile_code,label')
    .eq('user_id', user.id)
    .eq('contest_id', CONTEST_ID)
    .order('tile_code', { ascending: true });

  if (data && data.length === 25) return data;

  const shuffled = shuffle(KSU_TILES);
  const rows = shuffled.map((label, i)=>({
    user_id: user.id,
    contest_id: CONTEST_ID,
    tile_code: codeAt(i),
    label
  }));
  await supa.from('user_card_cells').insert(rows);
  return rows;
}

/* ===== Completions ===== */
async function loadCompletions(){
  const { data } = await supa
    .from('completions')
    .select('tile_code')
    .eq('user_id', user.id)
    .eq('contest_id', CONTEST_ID);
  return (data||[]).map(r=>r.tile_code);
}
async function setCompletion(tile_code, done){
  if (done){
    await supa.from('completions').insert({ user_id: user.id, contest_id: CONTEST_ID, tile_code });
  } else {
    await supa.from('completions')
      .delete()
      .eq('user_id', user.id).eq('contest_id', CONTEST_ID).eq('tile_code', tile_code);
  }
}

/* ===== Claim UI ===== */
async function renderClaimBar(done){
  const bar = claimBarEl;
  if(!user){ bar.innerHTML=''; return; }

  const bingo = hasBingo(done);
  const blackout = hasBlackout(done);

  async function logAndEmail(kind){
    if (kind === 'bingo'){
      const { data: claimed } = await supa
        .from('claims').select('id')
        .eq('user_id', user.id).eq('contest_id', CONTEST_ID).eq('kind','bingo')
        .maybeSingle();
      if (claimed){ alert('Bingo already claimed for this contest — go for Blackout!'); return; }
    }

    const { error } = await supa.from('claims').insert({
      user_id: user.id,
      contest_id: CONTEST_ID,
      email: user.email,
      kind,
      tiles: done
    });
    if (error){ alert('Error logging claim; please tell the front desk.'); console.error(error); return; }

    const subject = encodeURIComponent(kind === 'blackout' ? 'Blackout claim' : 'Bingo claim');
    const body = encodeURIComponent(
      `User: ${user.email}\nContest: ${CONTEST_ID}\nKind: ${kind}\nTiles: ${done.join(', ')}\nTime: ${new Date().toLocaleString()}`
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

/* ===== Render board ===== */
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

/* ===== Auth & boot ===== */
document.getElementById('signin').onclick = async ()=>{
  await supa.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: window.location.origin }});
};
document.getElementById('signout').onclick = async ()=>{
  await supa.auth.signOut();
  window.location.reload();
};

async function boot(){
  const { data:{ session } } = await supa.auth.getSession();
  user = session?.user || null;
  whoEl.textContent = user ? `Signed in: ${user.user_metadata?.full_name || user.email}` : 'Not signed in';
  debugEl.textContent = session ? JSON.stringify(session, null, 2) : '(none)';
  if (!user){ boardEl.innerHTML=''; claimBarEl.innerHTML=''; statsEl.textContent=''; return; }
  await ensureConsent(user.id);
  await renderBoard();
}
supa.auth.onAuthStateChange((_evt, sess)=>{
  const u = sess?.user || null;
  user = u;
  whoEl.textContent = user ? `Signed in: ${user.user_metadata?.full_name || user.email}` : 'Not signed in';
  debugEl.textContent = sess ? JSON.stringify(sess, null, 2) : '(none)';
  if (user){ ensureConsent(user.id).then(renderBoard); }
  else { boardEl.innerHTML=''; claimBarEl.innerHTML=''; statsEl.textContent=''; }
});
boot();

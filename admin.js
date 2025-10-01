// ===== Config
const SUPABASE_URL = 'https://YOUR-REF.supabase.co';
const SUPABASE_KEY = 'YOUR-ANON-PUBLISHABLE-KEY';
const BUCKET = 'bingo';

const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let user = null;

const whoEl = document.getElementById('who');
const debugEl = document.getElementById('debug');
const idEl = document.getElementById('contest_id');
const nameEl = document.getElementById('contest_name');
const activeEl = document.getElementById('is_active');
const tilesEl = document.getElementById('tiles');
const bingoEl = document.getElementById('prize_bingo');
const blackoutEl = document.getElementById('prize_blackout');
const bgFileEl = document.getElementById('bg_file');
const stampFileEl = document.getElementById('stamp_file');

function log(o){ debugEl.textContent = typeof o === 'string' ? o : JSON.stringify(o,null,2); }

async function isAdmin(email){
  const { data } = await supa.from('admin_emails').select('email').eq('email', email);
  return (data||[]).length > 0;
}

function parseTiles(text){
  return text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
}

function publicUrl(path){
  const { data } = supa.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

document.getElementById('signin').onclick = async ()=>{
  await supa.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: window.location.href }});
};
document.getElementById('signout').onclick = async ()=>{
  await supa.auth.signOut();
  window.location.reload();
};

async function boot(){
  const { data:{ session } } = await supa.auth.getSession();
  user = session?.user || null;
  whoEl.textContent = user ? `Signed in: ${user.email}` : 'Not signed in';

  if (!user){ return; }
  if (!(await isAdmin(user.email))){
    whoEl.textContent = `Signed in: ${user.email} (no admin access)`;
    alert('You are not an admin for LAPCo. Contact the studio.');
    return;
  }
}

document.getElementById('loadActive').onclick = async ()=>{
  const { data, error } = await supa.from('contests').select('*').eq('is_active', true).maybeSingle();
  if (error){ alert('Error loading active contest'); log(error); return; }
  if (!data){ alert('No active contest found'); return; }
  idEl.value = data.id || '';
  nameEl.value = data.name || '';
  activeEl.checked = !!data.is_active;
  tilesEl.value = Array.isArray(data.tiles) ? data.tiles.join('\n') : (data.tiles?.join?.('\n') || '');
  bingoEl.value = data.prizes?.bingo || '';
  blackoutEl.value = data.prizes?.blackout || '';
  log({ loaded: data });
};

document.getElementById('save').onclick = async ()=>{
  if (!user){ alert('Sign in first'); return; }
  if (!(await isAdmin(user.email))){ alert('Not an admin'); return; }

  const id = idEl.value.trim();
  const name = nameEl.value.trim();
  if (!id || !name){ alert('Contest ID and Name are required'); return; }

  // upload files if present
  let bgPath, stampPath;

  if (bgFileEl.files[0]){
    const ext = bgFileEl.files[0].name.split('.').pop().toLowerCase();
    bgPath = `${id}/background.${ext}`;
    const up = await supa.storage.from(BUCKET).upload(bgPath, bgFileEl.files[0], { upsert:true });
    if (up.error){ alert('BG upload failed'); log(up.error); return; }
  }
  if (stampFileEl.files[0]){
    const ext = stampFileEl.files[0].name.split('.').pop().toLowerCase();
    stampPath = `${id}/stamp.${ext}`;
    const up2 = await supa.storage.from(BUCKET).upload(stampPath, stampFileEl.files[0], { upsert:true });
    if (up2.error){ alert('Stamp upload failed'); log(up2.error); return; }
  }

  const tiles = parseTiles(tilesEl.value);
  if (tiles.length !== 25){
    alert(`You have ${tiles.length} tiles. You need exactly 25.`); return;
  }

  const prizes = {
    bingo: bingoEl.value.trim(),
    blackout: blackoutEl.value.trim()
  };

  const payload = {
    id,
    name,
    is_active: activeEl.checked,
    tiles,
    prizes
  };
  if (bgPath) payload.bg_image_path = bgPath;
  if (stampPath) payload.stamp_image_path = stampPath;

  // upsert contest
  const up = await supa.from('contests').upsert(payload).select().single();
  if (up.error){ alert('Save failed'); log(up.error); return; }

  // if set active, deactivate others
  if (payload.is_active){
    await supa.from('contests').update({ is_active:false }).neq('id', id);
  }

  log({ saved: up.data, bgPublicUrl: up.data.bg_image_path ? publicUrl(up.data.bg_image_path) : null,
                     stampPublicUrl: up.data.stamp_image_path ? publicUrl(up.data.stamp_image_path) : null });
  alert('Contest saved.');
};

boot();

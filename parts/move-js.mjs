// Page code for the roster-move buttons (joined into the page by fantasy.mjs)
export const MOVE_JS = String.raw`// Roster-move buttons: ask first, then send the move to ESPN through the Cloudflare worker
const WHY = {
  TRAN_LINEUP_LOCKED: "one of those players' games already started, so ESPN locked him",
  TRAN_ROSTER_LIMIT_EXCEEDED_ONE: "your roster is full",
  TRAN_PLAYER_NOT_FREEAGENT: "that player isn't available anymore",
  TRAN_PLAYER_NOT_AVAILABLE: "that player isn't available anymore",
  TRAN_PLAYER_NOT_ON_TEAM: "that player isn't on your team anymore",
  TRAN_NOT_FOUND: "that trade offer is no longer open",
  TRAN_INVALID_SCORINGPERIOD_NOT_CURRENT: "the site is a bit behind ESPN. Wait 2 minutes and try again",
  'Failed to fetch': "the site couldn't reach the move server",
  'Load failed': "the site couldn't reach the move server",
};
document.addEventListener('click', async ev => {
  const b = ev.target.closest('button.do');
  if (!b || b.disabled) return;
  const m = JSON.parse(b.dataset.move);
  if (!confirm(m.label + '?\n\nThis changes your real ESPN team.')) return;
  let key = null;
  try { key = localStorage.getItem('moveKey'); } catch {}
  if (!key) key = prompt('Move password (the KEY you set in Cloudflare). This phone remembers it.');
  if (!key) return;
  b.disabled = true; b.textContent = 'Sending to ESPN...';
  try {
    const r = await fetch('__URL__', { method: 'POST', headers: { 'content-type': 'application/json', 'x-key': key }, body: JSON.stringify(m) });
    const out = await r.json().catch(() => ({}));
    if (r.status === 401) { try { localStorage.removeItem('moveKey'); } catch {} throw new Error('Wrong password. Tap the button to try again'); }
    if (!r.ok) throw new Error(out.error || 'ESPN said ' + r.status);
    try { localStorage.setItem('moveKey', key); } catch {}
    b.textContent = m.type === 'TRADE_PROPOSAL' ? 'Trade offer sent on ESPN' : out.status === 'PENDING' ? 'Claim sent. It goes through when waivers run' : 'Done on ESPN. The site catches up in about 3 minutes';
    const pitch = m.sms && b.closest('.card') && b.closest('.card').querySelector('.pitch');
    if (pitch && confirm('Offer sent. Open Messages with the text to ' + m.sms + '? You still press send.')) {
      let num = '';
      try { num = localStorage.getItem('phone:' + m.other) || ''; } catch {}
      if (!num) { num = (prompt('Phone number for ' + m.sms + '? Saved on this phone only. Leave blank to pick them in Messages.') || '').replace(/[^0-9+]/g, ''); try { if (num) localStorage.setItem('phone:' + m.other, num); } catch {} }
      location.href = 'sms:' + num + '&body=' + encodeURIComponent(pitch.textContent);
    }
  } catch (err) {
    b.disabled = false; b.textContent = m.label;
    alert('ESPN did not make the move: ' + (WHY[err.message] || err.message) + '.');
  }
});`;

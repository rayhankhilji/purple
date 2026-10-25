const BASE = 'https://purple-wine.vercel.app';
const models = process.argv.slice(2);
async function one(m) {
  const body = { mode: 'engineer', llm: 'live', model: m, memory: true, ideas: 5, rounds: 20, team: 'redbull', seed: 21, variants: 600, confirm_k: 8, explore: 2 };
  const r = await fetch(BASE + '/api/concept/engine/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!j.ok) return console.log(m, 'POST', r.status, JSON.stringify(j.error));
  const t0 = Date.now(); const s = await fetch(BASE + j.data.stream); const txt = await s.text();
  const evs = txt.split('\n\n').map(b => ({ e: (/^event: (.*)$/m.exec(b) || [])[1], d: (/^data: (.*)$/m.exec(b) || [])[1] })).filter(x => x.e && x.d && x.e !== 'ping').map(x => { try { return { e: x.e, d: JSON.parse(x.d) }; } catch (er) { return { e: x.e, d: x.d }; } });
  const decs = evs.filter(x => x.e === 'decision').map(x => x.d.row);
  const fin = evs.find(x => x.e === 'final'), err = evs.find(x => x.e === 'error');
  console.log(`${m}: gens ${decs.filter(d=>d.by==='mubit').length}/${decs.length} · ${((Date.now()-t0)/1000).toFixed(0)} s · decisions ${decs.length} · by ${[...new Set(decs.map(d=>d.by))]} · models ${[...new Set(decs.map(d=>d.model))]} · ids ${decs.map(d=>(d.mubit_request_id||'-').slice(0,14)).join(',')} · fallback ${decs.filter(d=>d.fallback_reason).map(d=>d.fallback_reason).join('|')} · peak ${fin && fin.d.summary && fin.d.summary.peak_lap_s} · stop ${fin && fin.d.stop_reason} ${err ? 'ERROR ' + JSON.stringify(err.d).slice(0,200) : ''}`);
  if (decs[0]) console.log('   first idea:', String(decs[0].hypothesis || decs[0].proposal_change).slice(0, 140));
  if (!decs.length) console.log('   events:', evs.map(x=>x.e).join(','), txt.slice(0,300));
}
Promise.all(models.map(one)).then(() => process.exit(0));

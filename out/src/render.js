const {chromium}=require('playwright');const fs=require('fs');const {execSync}=require('child_process');const path=require('path');
const FPS=24, VODIR=process.env.VODIR||'vo';
const script=JSON.parse(fs.readFileSync('script.json'));
const dur=f=>parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${f}"`).toString());
const MIN=[0,16,18,16,18,18,13,13];
let sections=[{id:'note',start:0,dur:5.0}];let t=5.0;const subs=[];
script.forEach((s,i)=>{const vd=dur(`${VODIR}/${s.id}.mp3`);const d=Math.max(vd+1.6,MIN[i+1]);sections.push({id:s.id,start:t,dur:d,vo:t+0.5,voDur:vd});
  // subtitle chunks
  const w=s.text.split(' ');const chunks=[];let cur=[];w.forEach(x=>{cur.push(x);if(cur.join(' ').length>44||/[.?!:]$/.test(x)){chunks.push(cur.join(' '));cur=[]}});if(cur.length)chunks.push(cur.join(' '));
  const total=chunks.reduce((a,c)=>a+c.length,0);let ct=t+0.5;chunks.forEach(c=>{const cd=vd*c.length/total;subs.push({s:ct,e:ct+cd,text:c});ct+=cd});
  t+=d});
const TOTAL=t;const TL={sections,subs,total:TOTAL};fs.writeFileSync('timeline.json',JSON.stringify(TL,null,1));
const N=Math.ceil(TOTAL*FPS);console.log('total',TOTAL.toFixed(1),'frames',N);
(async()=>{const browser=await chromium.launch();const W=4;const start=Date.now();
 await Promise.all([...Array(W)].map(async(_,k)=>{const page=await browser.newPage({viewport:{width:1920,height:1080}});
  await page.goto('file://'+path.resolve('anim.html'));await page.evaluate(()=>document.fonts.ready);await page.evaluate(tl=>{window.TL=tl},TL);await page.waitForTimeout(500);
  for(let f=k;f<N;f+=W){await page.evaluate(t=>render(t),f/FPS);await page.screenshot({type:'jpeg',quality:90,path:`frames/f${String(f).padStart(5,'0')}.jpg`});if(f%240===0)console.log('frame',f,((Date.now()-start)/1000).toFixed(0)+'s')}
  await page.close()}));await browser.close();console.log('done',((Date.now()-start)/1000).toFixed(0)+'s')})();

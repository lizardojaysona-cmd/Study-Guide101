const $=s=>document.querySelector(s),esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const KEY='studyguide.v1',shuffle=a=>a.map(v=>[Math.random(),v]).sort((x,y)=>x[0]-y[0]).map(x=>x[1]);
let S=JSON.parse(localStorage.getItem(KEY)||'null')||{decks:{},stats:{},history:[]};
const save=()=>localStorage.setItem(KEY,JSON.stringify(S));
let view='upload',session=null,curDeck=null,msg='';
const STOP=new Set('about above after again also because before being between both could does doing during each from have having here into just more most other over same should some such than that their them then there these they this those through under until very were what when where which while will with would your'.split(' '));
const status=m=>{msg=m;const e=$('#status');if(e)e.textContent=m};

/* ---------- File extraction: returns {text, marks[]} (marks = highlighted/emphasised phrases) ---------- */
async function readFile(f){
  const ext=f.name.toLowerCase().split('.').pop();
  if(['txt','md','csv'].includes(ext))return{text:await f.text(),marks:[]};
  if(ext==='docx')return docx(f);
  if(ext==='pdf')return pdf(f);
  if(f.type.startsWith('image/'))return image(f);
  throw Error('Unsupported file type .'+ext+' (use PDF, DOCX, TXT, JPG, PNG)');
}
async function docx(f){
  const r=await mammoth.convertToHtml({arrayBuffer:await f.arrayBuffer()},{styleMap:['highlight => mark']});
  const d=new DOMParser().parseFromString(r.value,'text/html');
  return{text:[...d.querySelectorAll('p,li,h1,h2,h3,h4,td')].map(e=>e.textContent).join('\n'),
    marks:[...d.querySelectorAll('mark,strong,b,em,u')].map(e=>e.textContent)};
}
async function pdf(f){
  pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const doc=await pdfjsLib.getDocument({data:await f.arrayBuffer()}).promise;
  let text='',marks=[],pages=[];
  for(let p=1;p<=doc.numPages;p++){
    status(`Reading PDF page ${p}/${doc.numPages}…`);
    const pg=await doc.getPage(p),tc=await pg.getTextContent();pages.push(pg);
    tc.items.forEach(i=>text+=i.str+(i.hasEOL?'\n':' '));text+='\n';
    for(const a of await pg.getAnnotations()){           // real PDF highlight annotations
      if(a.subtype!=='Highlight'||!a.quadPoints)continue;
      let pts=a.quadPoints.flat();
      if(typeof pts[0]==='number')pts=pts.reduce((r,v,i)=>(i%2?r[r.length-1].y=v:r.push({x:v}),r),[]);
      let hit='';
      for(let i=0;i<pts.length;i+=4){const g=pts.slice(i,i+4),X=g.map(c=>c.x),Y=g.map(c=>c.y);
        tc.items.forEach(t=>{const x=t.transform[4],y=t.transform[5];
          if(x>=Math.min(...X)-1&&x<=Math.max(...X)&&y>=Math.min(...Y)-2&&y<=Math.max(...Y)+2)hit+=t.str+' '})}
      marks.push(hit);
    }
  }
  if(text.replace(/\s/g,'').length<80){                  // scanned PDF -> OCR
    text='';
    for(let p=0;p<pages.length;p++){const vp=pages[p].getViewport({scale:2}),cv=document.createElement('canvas');
      cv.width=vp.width;cv.height=vp.height;await pages[p].render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
      const r=await ocr(cv,`OCR page ${p+1}/${pages.length}`);text+=r.text+'\n';marks.push(...r.marks)}
  }
  return{text,marks};
}
async function image(f){
  const img=new Image();img.src=URL.createObjectURL(f);await img.decode();
  const cv=document.createElement('canvas');cv.width=img.width;cv.height=img.height;cv.getContext('2d').drawImage(img,0,0);
  return ocr(cv,'OCR');
}
async function ocr(cv,label){                             // text + colour-highlight detection
  const r=await Tesseract.recognize(cv,'eng',{logger:m=>m.status==='recognizing text'&&status(label+' '+Math.round(m.progress*100)+'%')});
  const cx=cv.getContext('2d'),marks=[];let run=[];
  const hl=w=>{const{x0,y0,x1,y1}=w.bbox,W=x1-x0,H=y1-y0;if(W<2||H<2)return false;
    const d=cx.getImageData(x0,y0,W,H).data;let c=0;
    for(let i=0;i<d.length;i+=4){const m=Math.max(d[i],d[i+1],d[i+2]),n=Math.min(d[i],d[i+1],d[i+2]);if(m>190&&m-n>50)c++}
    return c/(d.length/4)>.3};
  (r.data.words||[]).forEach(w=>{if(hl(w))run.push(w.text);else if(run.length){marks.push(run.join(' '));run=[]}});
  if(run.length)marks.push(run.join(' '));
  return{text:r.data.text,marks};
}

/* ---------- Card generation ---------- */
const rx=k=>k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function makeCards(text,rawMarks,deckId){
  const marks=[...new Set(rawMarks.map(m=>m.replace(/\s+/g,' ').trim()).filter(m=>m.length>=3&&m.length<=60))];
  const freq={};(text.toLowerCase().match(/[a-z][a-z-]{4,}/g)||[]).forEach(w=>!STOP.has(w)&&(freq[w]=(freq[w]||0)+1));
  const common=Object.entries(freq).filter(e=>e[1]>=3).sort((a,b)=>b[1]-a[1]).slice(0,marks.length>=8?8:25).map(e=>e[0]);
  const kws=[...marks.map(k=>({k,w:2})),...common.map(k=>({k,w:1}))].sort((a,b)=>b.w-a.w||b.k.length-a.k.length);
  const sents=text.split(/(?<=[.!?])\s+|\n+/).map(s=>s.replace(/\s+/g,' ').trim()).filter(s=>s.length>=25&&s.length<=320);
  const used={},seen=new Set(),cards=[];
  const add=(q,a,topic,type)=>{if(seen.has(q))return;seen.add(q);cards.push({id:deckId+'-'+cards.length,q,a,topic:topic.toLowerCase(),type})};
  for(const s of sents){
    const d=s.match(/^(.{3,60}?)\s+(?:is|are|refers to|means|is defined as)\s+(.{15,})$/i);
    if(d&&!/^(it|this|that|there|he|she|they)\b/i.test(d[1])){add(`What ${/\bare\b/i.test(s)?'are':'is'} ${d[1]}?`,d[2].replace(/\.$/,''),d[1],'def');continue}
    const k=kws.find(x=>(used[x.k]||0)<2&&new RegExp('\\b'+rx(x.k)+'\\b','i').test(s)&&s.length>x.k.length+15);
    if(k){used[k.k]=(used[k.k]||0)+1;add(s.replace(new RegExp('\\b'+rx(k.k)+'\\b','i'),'_____'),k.k,k.k,'cloze')}
  }
  return cards;
}

/* ---------- Stats & adaptive logic ---------- */
const allCards=()=>Object.values(S.decks).flatMap(d=>d.cards);
const prio=c=>{const s=S.stats[c.id];if(!s||!s.seen)return 1.2;
  return(s.wrong+1)/(s.seen+2)*(1+Math.min((Date.now()-s.last)/864e5,14)/7)/(1+s.streak*.5)};
function record(c,ok){const s=S.stats[c.id]||(S.stats[c.id]={seen:0,right:0,wrong:0,streak:0,last:0});
  s.seen++;s.last=Date.now();if(ok){s.right++;s.streak++}else{s.wrong++;s.streak=0}save()}
function topics(){const m={};
  for(const c of allCards()){const s=S.stats[c.id];if(!s||!s.seen)continue;
    const t=m[c.topic]||(m[c.topic]={t:c.topic,seen:0,right:0});t.seen+=s.seen;t.right+=s.right}
  return Object.values(m).map(t=>({...t,acc:t.right/t.seen})).sort((a,b)=>a.acc-b.acc)}
const weakTopics=()=>topics().filter(t=>t.seen>=2&&t.acc<.7);

/* ---------- Views ---------- */
function vUpload(){const ds=Object.values(S.decks);
  return`<h2>Upload study material</h2>
  <div class="drop" id="drop" onclick="$('#file').click()"><b>Drop files here or tap to choose</b><br><small>PDF · DOCX · JPG/PNG (OCR) · TXT/MD</small>
  <input id="file" type="file" multiple hidden accept=".pdf,.docx,.txt,.md,.csv,image/*" onchange="handleFiles(this.files)"></div>
  <p class="muted" id="status">${esc(msg)}</p>
  <details><summary>Or paste text</summary><textarea id="paste" rows="5" placeholder="Paste notes…"></textarea><div class="row"><button class="sec" onclick="handleText()">Generate cards</button></div></details>
  <p class="muted">Highlighted words (PDF highlights, Word highlight, coloured marker in images) and bold/italic/underlined text are treated as key terms; frequent terms fill the gaps.</p>
  <h3>Your decks</h3>${ds.length?ds.map(d=>`<div class="box deck"><div><b>${esc(d.name)}</b><br><small>${d.cards.length} cards · ${d.marks} highlighted terms</small></div>
  <div><button class="sec" onclick="go('flash','${d.id}')">Flashcards</button> <button class="sec" onclick="go('quiz','${d.id}')">Quiz</button> <button class="sec" onclick="del('${d.id}')">✕</button></div></div>`).join(''):'<p class="muted">No decks yet.</p>'}`}
function vStudy(){
  if(session&&session.kind===view)return session.i>=session.cards.length?vDone():view==='quiz'?vQ():vF();
  const ds=Object.values(S.decks);if(!ds.length)return'<p class="muted">Upload a file first.</p>';
  return`<h2>${view==='quiz'?'Quiz':'Flashcards'}</h2><div class="row">
  <label>Deck<select id="deck">${ds.map(d=>`<option value="${d.id}" ${d.id===curDeck?'selected':''}>${esc(d.name)} (${d.cards.length})`).join('')}<option value="all">All decks</option></select></label>
  <label>Cards<select id="n"><option>10<option>20<option>30</select></label>
  <label>Mode<select id="mode"><option value="smart">Smart mix (targets weak areas)<option value="weak">Weak spots only</select></label></div>
  <button class="pri" onclick="start()">Start</button>`}
const cur=()=>session.cards[session.i];
function vF(){const c=cur(),f=session.flip;
  return`<small>${session.i+1} / ${session.cards.length}</small><div class="card" onclick="flip()"><small>${f?'Answer':'Question'} · ${esc(c.topic)}</small><p>${esc(f?c.a:c.q)}</p>${f?'':'<small>tap to flip</small>'}</div>
  ${f?'<div class="row"><button class="bad" onclick="rate(0)">Missed it</button><button class="good" onclick="rate(1)">Got it</button></div>':''}`}
function opts(c){const all=allCards().filter(x=>x.id!==c.id&&x.a.toLowerCase()!==c.a.toLowerCase());
  let p=[...new Set(shuffle(all.filter(x=>x.type===c.type)).map(x=>x.a))];
  if(p.length<3)p=p.concat([...new Set(shuffle(all).map(x=>x.a))].filter(a=>!p.includes(a)));
  return shuffle([...p.slice(0,3),c.a])}
function vQ(){const c=cur();if(!session.o)session.o=opts(c);const a=session.ans;
  return`<small>${session.i+1} / ${session.cards.length} · score ${session.score}</small><div class="box"><p>${esc(c.q)}</p></div>
  ${session.o.map((o,i)=>`<button class="opt ${a!==null?(o===c.a?'ok':o===a?'no':''):''}" onclick="answer(${i})">${esc(o)}</button>`).join('')}
  ${a!==null?'<button class="pri" onclick="next()">Next →</button>':''}`}
function vDone(){const s=session,pct=Math.round(s.score/s.cards.length*100);
  if(!s.saved){s.saved=1;S.history.push({t:Date.now(),kind:s.kind,score:s.score,total:s.cards.length});save()}
  return`<h2>${pct}%</h2><p>${s.score} of ${s.cards.length} correct.</p>
  ${s.missed.length?`<h3>To review</h3>${s.missed.map(c=>`<div class="box"><small>${esc(c.q)}</small><br><b>${esc(c.a)}</b></div>`).join('')}<button class="pri" onclick="retry()">Retry missed</button> `:'<p>🎉 Perfect round!</p>'}
  <button class="sec" onclick="session=null;render()">Done</button>`}
function vProgress(){const h=S.history,t=topics(),weak=weakTopics(),seen=Object.values(S.stats).reduce((a,s)=>a+s.seen,0),right=Object.values(S.stats).reduce((a,s)=>a+s.right,0);
  const pct=x=>Math.round(x.score/x.total*100),last=h.slice(-12);
  const trend=h.length>=4?pct({score:h.slice(-2).reduce((a,x)=>a+x.score,0),total:h.slice(-2).reduce((a,x)=>a+x.total,0)})-pct({score:h.slice(-4,-2).reduce((a,x)=>a+x.score,0),total:h.slice(-4,-2).reduce((a,x)=>a+x.total,0)}):null;
  if(!seen)return'<h2>Progress</h2><p class="muted">Complete a quiz or flashcard round to see your stats.</p>';
  return`<h2>Progress</h2><div class="tiles"><div class="tile"><b>${Math.round(right/seen*100)}%</b>overall accuracy</div><div class="tile"><b>${seen}</b>answers given</div><div class="tile"><b>${h.length}</b>sessions</div>
  <div class="tile"><b>${trend===null?'–':(trend>=0?'+':'')+trend+'%'}</b>recent trend</div></div>
  <h3>Score history</h3><div class="box hist">${last.map(x=>`<div title="${pct(x)}%" style="height:${Math.max(pct(x),4)}%"></div>`).join('')}</div>
  <h3>Weak areas</h3>${weak.length?weak.slice(0,8).map(x=>`<div class="box"><div class="deck"><b>${esc(x.t)}</b><small>${Math.round(x.acc*100)}% · ${x.seen} tries</small></div><div class="bar w"><i style="width:${x.acc*100}%"></i></div></div>`).join('')+`<button class="pri" onclick="practiceWeak()">Practice weak spots</button>`:'<p class="muted">No weak spots detected yet — keep practising!</p>'}
  <h3>Strongest topics</h3>${t.filter(x=>x.acc>=.7).slice(-5).reverse().map(x=>`<div class="box"><div class="deck"><b>${esc(x.t)}</b><small>${Math.round(x.acc*100)}%</small></div><div class="bar"><i style="width:${x.acc*100}%"></i></div></div>`).join('')||'<p class="muted">—</p>'}
  <button class="sec" onclick="if(confirm('Reset all progress?')){S.stats={};S.history=[];save();render()}">Reset progress</button>`}

/* ---------- Actions ---------- */
function render(){document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('on',b.dataset.v===view));
  $('#app').innerHTML=({upload:vUpload,flash:vStudy,quiz:vStudy,progress:vProgress})[view]()}
const go=(v,d)=>{view=v;curDeck=d||curDeck;session=null;render()};
const del=id=>{if(confirm('Delete this deck?')){delete S.decks[id];save();render()}};
function addDeck(name,r){const id='d'+Date.now()+Math.random().toString(36).slice(2,5),cards=makeCards(r.text,r.marks,id);
  if(cards.length<2)return status(`⚠ ${name}: not enough usable text to build cards.`),false;
  S.decks[id]={id,name,cards,marks:new Set(r.marks.map(m=>m.trim()).filter(Boolean)).size};curDeck=id;save();return true}
async function handleFiles(files){let n=0;
  for(const f of files){try{status('Reading '+f.name+'…');if(addDeck(f.name,await readFile(f)))n++}catch(e){status('⚠ '+f.name+': '+e.message)}}
  if(n)msg=`✅ Created ${n} deck(s).`;render()}
function handleText(){const t=$('#paste').value;if(t.trim().length<50)return status('Paste a bit more text.');if(addDeck('Pasted notes '+new Date().toLocaleDateString(),{text:t,marks:[]}))msg='✅ Deck created.';render()}
function start(){const id=$('#deck').value,n=+$('#n').value,pool=id==='all'?allCards():S.decks[id].cards;
  if(view==='quiz'&&allCards().length<4)return alert('Need at least 4 cards in total for a quiz.');
  let c=pool.map(c=>({c,p:prio(c)*(.7+Math.random()*.6)})).sort((a,b)=>b.p-a.p).map(x=>x.c);
  if($('#mode').value==='weak'){const w=c.filter(x=>(S.stats[x.id]||{}).wrong);if(w.length)c=w}
  begin(c.slice(0,n))}
const begin=c=>{session={kind:view,cards:c,i:0,score:0,missed:[],flip:false,ans:null,o:null};render()};
const flip=()=>{session.flip=true;render()};
const rate=ok=>{const c=cur();record(c,ok);ok?session.score++:session.missed.push(c);session.i++;session.flip=false;render()};
function answer(i){if(session.ans!==null)return;const c=cur();session.ans=session.o[i];const ok=session.ans===c.a;record(c,ok);ok?session.score++:session.missed.push(c);render()}
const next=()=>{session.i++;session.ans=null;session.o=null;render()};
const retry=()=>begin(shuffle(session.missed));
function practiceWeak(){const w=new Set(weakTopics().map(t=>t.t));view='quiz';
  const c=allCards().filter(x=>w.has(x.topic)).sort((a,b)=>prio(b)-prio(a)).slice(0,15);
  if(allCards().length<4)return alert('Need at least 4 cards.');begin(shuffle(c))}

document.querySelector('nav').onclick=e=>{if(e.target.dataset.v)go(e.target.dataset.v)};
document.addEventListener('dragover',e=>{const d=e.target.closest('#drop');if(d){e.preventDefault();d.classList.add('over')}});
document.addEventListener('dragleave',e=>{const d=e.target.closest('#drop');d&&d.classList.remove('over')});
document.addEventListener('drop',e=>{if(e.target.closest('#drop')){e.preventDefault();handleFiles(e.dataTransfer.files)}});
render();

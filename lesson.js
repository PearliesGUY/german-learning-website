// Lesson player: lesson, Practice (skill day), Review (recall) and mock screens. One activity per screen.
// Contract: active/app-interfaces.md (GERMAN_PLAYER). Uses KLEIN_CORE for all answer logic.
// Scoring: K.status = first try (the score). K.live = what is on screen now ("Try again" and redo answers live in state.practice).
(function(){
  'use strict';
  const K=window.KLEIN_CORE;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pending={};          // build questions: token indices tapped but not yet checked
  const moreShown={};        // teaching cards: 'Explain it more simply' text open (not saved)
  const stepsShown={};       // teaching cards: how many lines of `steps` are revealed (not saved; starts at 1)
  let textCollapsed=false;   // reading text / listening panel folded away
  let keyHandler=null;       // one document keydown handler, replaced on every mount

  const pages=p=>Array.isArray(p)&&p.length?(p[0]===p[p.length-1]?String(p[0]):`${p[0]}–${p[p.length-1]}`):'';
  const answerText=q=>q.type==='choice'?q.options[q.answer]:q.type==='build'?q.answer.join(' '):(q.answers||[])[0];
  const SPK='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
  const speakBtn=(text,label)=>`<button type="button" class="lp-icon" data-act="speak" data-text="${esc(text)}" aria-label="${esc(label||'Listen: '+text)}">${SPK}</button>`;

  // ---------- shared question widget ----------
  // opt: {next: label for the next button, redo: true while replaying a finished lesson}
  // Study timer: counts only teaching screens (Start, Learn, Words), not drills/quiz/practice questions.
  // Stored per local date in its own key {"2026-11-20": seconds}; pauses when the tab is hidden or after 3 min with no input.
  const TIMER='german-study-time', LEARN_PHASES=new Set(['Start','Learn','Words']);
  const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const studySeconds=(day=today())=>{try{return (JSON.parse(localStorage.getItem(TIMER))||{})[day]||0;}catch{return 0;}};
  if(typeof document!=='undefined'){
    let lastInput=Date.now();
    ['pointerdown','keydown','scroll','wheel'].forEach(ev=>document.addEventListener(ev,()=>{lastInput=Date.now();},{passive:true,capture:true}));
    setInterval(()=>{
      if(document.visibilityState!=='visible'||Date.now()-lastInput>180000||!LEARN_PHASES.has(window.GERMAN_STUDY_PHASE)||!document.querySelector('.lp-main'))return;
      try{const all=JSON.parse(localStorage.getItem(TIMER))||{};all[today()]=(all[today()]||0)+5;localStorage.setItem(TIMER,JSON.stringify(all));}catch{}
      const t=document.querySelector('[data-study-timer]');if(t)t.textContent=`${Math.floor(studySeconds()/60)} min learning today`;
    },5000);
    window.addEventListener('hashchange',()=>{if(!/^#\/lesson\//.test(location.hash))window.GERMAN_STUDY_PHASE=null;});
  }
  // "Report it": flags kept in their own localStorage key (not in progress state); Settings downloads them for the next German check.
  const REPORTS='german-reports';
  const readReports=()=>{try{return JSON.parse(localStorage.getItem(REPORTS))||[];}catch{return [];}};
  const reported=key=>readReports().some(r=>r.key===key);
  if(typeof document!=='undefined')document.addEventListener('click',e=>{
    const b=e.target.closest('[data-report]');if(!b||b.disabled)return;
    const qel=b.closest('.lp-q'), list=readReports();
    list.push({key:b.dataset.report,prompt:qel?.querySelector('.lp-prompt')?.textContent||'',answer:qel?.querySelector('.lp-fb')?.textContent.replace('⚑ Looks wrong? Report it','').trim()||'',at:new Date().toISOString()});
    try{localStorage.setItem(REPORTS,JSON.stringify(list));b.textContent='⚑ Reported, thanks';b.disabled=true;}catch{b.textContent='Could not save the report';}
  });
  function renderQuestion(q,key,state,opt={}){
    const a=K.record(state,key); const st=K.live(state,key); const done=st!=='open'; const tries=a?a.tries:0;
    const practising=!!(state.practice&&state.practice[key]);
    let body='';
    if(q.type==='choice'){
      body=`<div class="lp-opts" role="group" aria-label="Options">${q.options.map((o,i)=>{
        const cls=done&&i===q.answer?' is-ok':!done&&a&&a.value===i?' is-bad':'';
        return `<button type="button" class="lp-opt${cls}" data-act="choose" data-v="${i}"${done?' disabled':''}><span class="lp-num" aria-hidden="true">${i+1}</span><span>${esc(o)}</span></button>`;}).join('')}</div>`;
    }else if(q.type==='build'){
      const sel=done?(st==='correct'&&Array.isArray(a.value)?a.value:q.answer.map(w=>q.tokens.indexOf(w))):(pending[key]||[]);
      body=`<div class="lp-row${done?' is-'+(st==='correct'?'ok':'rev'):''}" aria-label="Your answer">${sel.length?sel.map((t,p)=>`<button type="button" class="lp-tok" data-act="unpick" data-p="${p}"${done?' disabled':''}>${esc(q.tokens[t])}</button>`).join(''):'<span class="lp-row-empty">Tap the words below in order</span>'}</div>`+
        (done?'':`<div class="lp-bank">${q.tokens.map((t,i)=>`<button type="button" class="lp-tok" data-act="pick" data-i="${i}"${sel.includes(i)?' disabled':''}>${esc(t)}</button>`).join('')}</div>
        <div class="lp-actions"><button type="button" class="lp-btn" data-act="check"${sel.length?'':' disabled'}>Check</button></div>`);
    }else{
      const val=done?(st==='correct'?a.value:answerText(q)):(a&&typeof a.value==='string'?a.value:'');
      body=`<div class="lp-typewrap"><input class="lp-input${done?' is-'+(st==='correct'?'ok':'rev'):''}" type="text" value="${esc(val)}" autocomplete="off" autocapitalize="off" spellcheck="false" lang="de" aria-label="Your answer"${done?' disabled':''}>
        ${done?'':`<div class="lp-chars" aria-label="Special letters">${['ä','ö','ü','ß'].map(c=>`<button type="button" class="lp-char" data-act="char" data-c="${c}">${c}</button>`).join('')}</div>
        <div class="lp-actions"><button type="button" class="lp-btn" data-act="check">Check</button></div>`}</div>`;
    }
    let fb='';
    if(st==='correct')fb=`<p class="lp-fb-ok"><span class="lp-tick" aria-hidden="true">✓</span> Right!</p><p class="lp-expl">${esc(q.explanation)}</p>`;
    else if(st==='revealed')fb=`<p class="lp-fb-rev">Answer: <b lang="de">${esc(answerText(q))}</b></p><p class="lp-expl">${esc(q.explanation)}</p>${practising?'':'<p class="lp-later">This one comes back in a later Review.</p>'}`;
    else if(tries>0){
      fb=`<p class="lp-fb-bad">Not quite, try again. <span class="lp-tries">Tries: ${tries}</span></p>`;
      if(tries>=K.HINT_AFTER)fb+=`<div class="lp-hint"><b>Hint</b><p>${esc(q.hint)}</p></div><div class="lp-actions"><button type="button" class="lp-btn lp-ghost" data-act="reveal">Show answer</button></div>`;
    }
    if(done)fb+=`<div class="lp-actions"><button type="button" class="lp-btn lp-ghost" data-act="retry">Try again</button><button type="button" class="lp-btn lp-next" data-act="next">${esc(opt.next||'Next')} →</button></div>`+
      `<button type="button" class="lp-link lp-report" data-report="${esc(key)}"${reported(key)?' disabled':''}>${reported(key)?'⚑ Reported, thanks':'⚑ Looks wrong? Report it'}</button>`;
    const note=practising&&!opt.redo?'<p class="lp-practice">Practice try. Your first answer stays your score.</p>':'';
    return `<div class="lp-q" data-key="${esc(key)}" data-type="${q.type}">${note}<p class="lp-prompt" lang="de">${esc(q.prompt)}</p>${body}<div class="lp-fb" aria-live="polite">${fb}</div></div>`;
  }

  // ---------- engine: screens + header + events ----------
  // screen = {phase, title, html(), q?, key?, sub?(), canNext?(), onDone?(view), nextLabel?, final?}
  // cfg = {title, screens, start, onStep?, act?, input?, redo?() -> true while replaying, banner?() -> html}
  function engine(el,api,cfg){
    const state=()=>api.getState();
    const reduced=()=>!!state().settings?.reduced;
    const redo=()=>!!(cfg.redo&&cfg.redo());
    // In a redo every question must be answered again; otherwise a question is open until its first try is done.
    const isOpen=s=>!!s.q&&(redo()?K.live(state(),s.key):K.status(state(),s.key))==='open';
    let i=Math.max(0,Math.min(cfg.start||0,cfg.screens.length-1));
    let ask=null, notice='';   // ask: 'section' | 'all' while the in-page reset confirmation is open
    const tabs=cfg.kind==='lesson'||cfg.kind==='practice';   // step bar buttons (not in Review or Mock)
    const touched=r=>!!r&&r.keys.some(k=>K.status(state(),k)!=='open'||state().practice?.[k]);
    const confirmHtml=(s)=>`<div class="lp-confirm" role="alertdialog" aria-labelledby="lp-cq" aria-describedby="lp-cd">
      <p id="lp-cq" class="lp-confirm-q">${ask==='all'?`${esc(cfg.over.label)}?`:`Reset your answers in ${esc(s.reset.name)}?`}</p>
      <p id="lp-cd">${ask==='all'?'Every question here is cleared so you can do it all again.':'The questions come back fresh so you can do them again.'} Your first score stays saved.</p>
      <div class="lp-actions"><button type="button" class="lp-btn" data-act="reset-yes">Yes, clear them</button><button type="button" class="lp-btn lp-ghost" data-act="reset-cancel">Keep my answers</button></div></div>`;
    const phases=[...new Set(cfg.screens.map(s=>s.phase))];
    const nextName=k=>{const s=cfg.screens[k],n=cfg.screens[k+1];
      if(s.nextLabel)return s.nextLabel;if(!n)return 'Finish';if(n.phase!==s.phase)return `Next: ${n.phase}`;return s.q?'Next question':'Next';};
    function draw(focus=true){
      const s=cfg.screens[i], p=phases.indexOf(s.phase);
      if(typeof window!=='undefined')window.GERMAN_STUDY_PHASE=cfg.kind==='lesson'?s.phase:null;
      const pct=Math.round((i+1)/cfg.screens.length*100);
      const qhtml=s.q?renderQuestion(s.q,s.key,state(),{next:nextName(i),redo:redo()}):'';
      const open=isOpen(s);
      const nextOk=!s.q&&(!s.canNext||s.canNext());
      el.innerHTML=`<div class="lp${reduced()?' lp-reduced':''}">
        <header class="lp-top"><div class="lp-meta">
            <ol class="lp-phases" aria-label="Parts of this ${esc(cfg.kind||'lesson')}">${phases.map((ph,k)=>`<li class="${k<p?'is-done':k===p?'is-now':''}">${tabs?`<button type="button" class="lp-phase" data-act="phase" data-i="${cfg.screens.findIndex(x=>x.phase===ph)}"${k===p?' aria-current="step"':''}>${esc(ph)}</button>`:`<span${k===p?' aria-current="step"':''}>${esc(ph)}</span>`}</li>`).join('')}</ol>
            <span class="lp-tools">${cfg.kind==='lesson'?`<span class="lp-timer" data-study-timer>${Math.floor(studySeconds()/60)} min learning today</span>`:''}${cfg.over?`<button type="button" class="lp-pause lp-over" data-act="over-ask">${esc(cfg.over.label)}</button>`:''}<button type="button" class="lp-pause" data-act="pause">Save &amp; pause</button></span></div>
          <div class="lp-bar" role="progressbar" aria-label="${esc(cfg.title)} progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div></header>
        ${cfg.banner?cfg.banner():''}
        ${notice?`<p class="lp-notice" role="status">${esc(notice)}</p>`:''}${ask==='all'?confirmHtml(s):''}
        <main class="lp-screen${s.aside?' has-aside':''}">
          ${s.aside?`<aside class="lp-aside${textCollapsed?' is-collapsed':''}">${s.aside()}</aside>`:''}
          <section class="lp-main${s.wide?' is-wide':''}">
            <h2 class="lp-h" tabindex="-1">${esc(s.title)}</h2>${s.sub?`<p class="lp-sub" aria-live="polite">${s.sub()}</p>`:''}
            ${s.html?s.html():''}${qhtml}
            ${s.key&&s.q?(K.status(state(),s.key)!=='open'||state().practice?.[s.key]?`<div class="lp-reset"><button type="button" class="lp-link" data-act="reset-one">↺ Reset this question</button><span>Your first score stays saved</span></div>`:''):touched(s.reset)?(ask==='section'?confirmHtml(s):`<div class="lp-reset"><button type="button" class="lp-link" data-act="reset-ask">↺ Reset answers</button><span>Your first score stays saved</span></div>`):''}
          </section>
        </main>
        <nav class="lp-nav" aria-label="Lesson steps">${i>0?`<button type="button" class="lp-btn lp-ghost" data-act="back">← Back: ${esc(cfg.screens[i-1].phase===s.phase?'previous':cfg.screens[i-1].phase)}</button>`:'<span></span>'}
          ${s.q?(open?'<span class="lp-navnote">Answer to go on</span>':K.live(state(),s.key)==='open'?`<button type="button" class="lp-btn lp-ghost" data-act="next">Skip: ${esc(nextName(i))} →</button>`:''):s.final?'':nextOk?`<button type="button" class="lp-btn lp-next" data-act="next">${esc(nextName(i))} →</button>`:s.card!=null?'<button type="button" class="lp-btn lp-next" data-act="step">Show next step ↓</button>':`<button type="button" class="lp-btn lp-next" disabled>${esc(nextName(i))} →</button>`}</nav></div>`;
      notice='';
      if(ask){const c=el.querySelector('.lp-confirm [data-act="reset-cancel"]');c?.focus({preventScroll:true});c?.scrollIntoView?.({block:'center'});}
      else if(focus){window.scrollTo?.(0,0);el.querySelector('.lp-h').focus({preventScroll:true});}
    }
    function go(n){
      i=Math.max(0,Math.min(n,cfg.screens.length-1));ask=null;
      cfg.onStep&&cfg.onStep(i);api.save();draw();
    }
    function redrawQ(shake){
      const s=cfg.screens[i], box=el.querySelector('.lp-q'); if(!box)return;
      box.outerHTML=renderQuestion(s.q,s.key,state(),{next:nextName(i),redo:redo()});
      const nb=el.querySelector('.lp-q');
      if(shake&&!reduced()){nb.classList.add('lp-shake');}
      const inp=nb.querySelector('.lp-input:not([disabled])'); if(inp){inp.focus();inp.setSelectionRange(inp.value.length,inp.value.length);}
      else nb.querySelector('.lp-opt:not([disabled]),.lp-bank .lp-tok:not([disabled]),[data-act="check"]:not([disabled])')?.focus({preventScroll:true});
    }
    function submit(value){
      const s=cfg.screens[i], practising=!!state().practice?.[s.key]; const v=K.attempt(state(),s.key,s.q,value);
      delete pending[s.key];
      if(v.done){if(!practising)s.onDone&&s.onDone(v);api.save();draw(false);el.querySelector('.lp-next')?.focus();}
      else{api.save();redrawQ(true);}
    }
    el.onclick=e=>{
      const b=e.target.closest('[data-act]'); if(!b||!el.contains(b)||b.disabled)return;
      const act=b.dataset.act, s=cfg.screens[i];
      if(act==='pause'){api.save();if(cfg.onPause&&cfg.onPause())return;api.onExit&&api.onExit();return;}
      if(act==='back')return go(i-1);
      if(act==='phase')return go(Number(b.dataset.i));
      if(act==='reset-ask'||act==='over-ask'){ask=act==='over-ask'?'all':'section';return draw(false);}
      if(act==='reset-cancel'){ask=null;draw(false);el.querySelector('[data-act="reset-ask"],[data-act="over-ask"]')?.focus({preventScroll:true});return;}
      if(act==='reset-one'){K.resetKeys(state(),[s.key]);delete pending[s.key];notice='Question cleared. Your first score is still saved.';api.save();return draw(false);}
      if(act==='reset-yes'){
        const all=ask==='all', r=all?{keys:cfg.over.keys()}:s.reset;
        K.resetKeys(state(),r.keys);r.keys.forEach(k=>delete pending[k]);
        notice='Answers cleared. Your first score is still saved.';
        return go(all?0:Math.max(0,cfg.screens.findIndex(x=>x.reset&&x.reset.name===s.reset.name)));
      }
      if(act==='next'){if(isOpen(s))return;if(!s.q&&s.canNext&&!s.canNext())return;return i<cfg.screens.length-1?go(i+1):cfg.finish&&cfg.finish();}
      if(act==='speak')return api.speak&&api.speak(b.dataset.text,b.dataset.rate?Number(b.dataset.rate):undefined);
      if(act==='toggle-text'){textCollapsed=!textCollapsed;el.querySelector('.lp-aside')?.classList.toggle('is-collapsed',textCollapsed);b.setAttribute('aria-expanded',String(!textCollapsed));return;}
      if(act==='retry'&&s.q){
        if(K.retry(state(),s.key)){delete pending[s.key];api.save();draw(false);
          el.querySelector('.lp-q .lp-input:not([disabled]),.lp-q .lp-opt:not([disabled]),.lp-q .lp-bank .lp-tok:not([disabled])')?.focus();}
        return;
      }
      if(s.q&&K.live(state(),s.key)==='open'){
        if(act==='choose')return submit(Number(b.dataset.v));
        if(act==='pick'){(pending[s.key]=pending[s.key]||[]).push(Number(b.dataset.i));return redrawQ();}
        if(act==='unpick'){pending[s.key].splice(Number(b.dataset.p),1);return redrawQ();}
        if(act==='char'){const inp=el.querySelector('.lp-input');const a=inp.selectionStart??inp.value.length,z=inp.selectionEnd??a;inp.value=inp.value.slice(0,a)+b.dataset.c+inp.value.slice(z);inp.focus();inp.setSelectionRange(a+1,a+1);return;}
        if(act==='check'){if(s.q.type==='build')return pending[s.key]?.length&&submit(pending[s.key].slice());const val=el.querySelector('.lp-input').value;return val.trim()&&submit(val);}
        if(act==='reveal'){const practising=!!state().practice?.[s.key];
          if(K.reveal(state(),s.key)){const a=K.record(state(),s.key);if(!practising)s.onDone&&s.onDone({correct:false,revealed:true,tries:a.tries,done:true});api.save();draw(false);el.querySelector('.lp-next')?.focus();}return;}
      }
      cfg.act&&cfg.act(act,b,{redraw:()=>draw(false),go,index:()=>i});
    };
    el.oninput=e=>cfg.input&&cfg.input(e,{index:()=>i});
    if(keyHandler)document.removeEventListener('keydown',keyHandler);
    keyHandler=e=>{
      if(!el.isConnected){document.removeEventListener('keydown',keyHandler);return;}
      if(e.altKey||e.ctrlKey||e.metaKey)return;
      const t=e.target, inField=t.matches?.('input,textarea'), s=cfg.screens[i];
      if(e.key==='Enter'&&t.matches?.('.lp-input')){e.preventDefault();el.querySelector('[data-act="check"]')?.click();return;}
      if(inField)return;
      if(/^[1-4]$/.test(e.key)&&s.q?.type==='choice'){const o=el.querySelectorAll('.lp-opt:not([disabled])')[Number(e.key)-1];if(o){e.preventDefault();o.click();}return;}
      if(t.closest?.('button,a,summary'))return;   // buttons keep their native Enter/Space
      if(e.key==='Enter'){const n=el.querySelector('[data-act="step"]')||el.querySelector('.lp-next:not([disabled])');if(n){e.preventDefault();n.click();}}
    };
    document.addEventListener('keydown',keyHandler);
    draw();
    return {go,draw};
  }

  // First screen index whose question is still open (resume never skips past an unanswered question).
  const firstOpen=(screens,state)=>{const k=screens.findIndex(s=>s.q&&K.status(state,s.key)==='open');return k<0?screens.length:k;};

  const qScreens=(questions,owner,section,phase,label,extra={})=>questions.map((q,n)=>({phase,q,key:K.qkey(owner,section,n),reset:{name:phase,keys:questions.map((_,j)=>K.qkey(owner,section,j))},
    title:`${label} ${n+1} of ${questions.length}`,...(typeof extra==='function'?extra(n):extra)}));

  // ---------- teaching cards (v2.1: steps, parts, table; older cards: body, examples, table) ----------
  function videoHtml(key,res){
    const v=(res&&res.videos||{})[key]||{}; const id=v.yt||String(key).replace(/^yt:/,'');
    if(!/^[\w-]{11}$/.test(id))return '';
    const title=v.title||'Grammar video';
    return `<figure class="lp-video"><div class="lp-frame"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="${esc(title)}" loading="lazy" allowfullscreen allow="encrypted-media; picture-in-picture"></iframe></div>
      <figcaption><span>${esc(title)}${v.channel?` · ${esc(v.channel)}`:''}</span> <a href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener">Open on YouTube</a></figcaption></figure>`;
  }
  const ROLES={subject:'Subject',verb:'Verb',verb2:'Second verb part',object:'Object',dative:'Dative',article:'Article',noun:'Noun',adjective:'Adjective',ending:'Ending',question:'Question word',negation:'Negation',time:'Time',place:'Place',preposition:'Preposition',conjunction:'Joiner',other:'Other',verbend:'Verb at the end',genitive:'Genitive (whose)',reflexive:'Reflexive (myself…)',relative:'Relative (who, which)',konj2:'Wish form (würde, hätte)',zu:'zu + verb'};
  const roleOf=r=>Object.hasOwn(ROLES,r)?r:'other';
  const chipsHtml=parts=>parts.map(([t,r])=>`<span class="lp-chip r-${roleOf(r)}">${esc(t)}<span class="sr-only"> (${ROLES[roleOf(r)].toLowerCase()})</span></span>`).join('');
  const legendHtml=parts=>`<p class="lp-legend" aria-hidden="true">${[...new Set(parts.map(p=>roleOf(p[1])))].map(r=>`<span class="r-${r}">${ROLES[r]}</span>`).join('')}</p>`;
  const partsHtml=parts=>`<div class="lp-parts" lang="de">${chipsHtml(parts)}</div>${legendHtml(parts)}`;
  function stepsHtml(steps,shown){
    return `<ol class="lp-steps" aria-live="polite">${steps.slice(0,shown).map((x,k)=>`<li class="${k===shown-1&&k?'is-new':''}"><span class="lp-stepn" aria-hidden="true">${k+1}</span><span lang="de">${esc(x)}</span></li>`).join('')}</ol>
      ${shown<steps.length?`<div class="lp-actions"><button type="button" class="lp-btn" data-act="step">Next step (${shown+1} of ${steps.length})</button></div>`:''}`;
  }
  // cells: strings, or {t,g} with g = m|f|n|pl for gender colour
  const cell=(d,j)=>{const o=d&&typeof d==='object',t=o?d.t:d,g=o&&/^(m|f|n|pl)$/.test(d.g)?` class="g-${d.g}"`:'';
    return j?`<td lang="de"${g}>${esc(t)}</td>`:`<th scope="row"${g}>${esc(t)}</th>`;};
  const tableHtml=t=>t&&t.headers?`<div class="lp-tablewrap"><table class="lp-table"><thead><tr>${t.headers.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${(t.rows||[]).map(r=>`<tr>${r.map(cell).join('')}</tr>`).join('')}</tbody></table></div>`:'';
  const deeperHtml=d=>d&&d.text?`<div class="lp-deeper"><span class="lp-label">A bit deeper</span><p>${esc(d.text)}</p>${d.example&&d.example.de?`<div class="lp-deeper-ex">${Array.isArray(d.example.parts)&&d.example.parts.length?`<div class="lp-de lp-de-chips" lang="de"><span class="lp-parts lp-parts-sm">${chipsHtml(d.example.parts)}</span> ${speakBtn(d.example.de)}</div>`:`<p class="lp-de" lang="de">${esc(d.example.de)} ${speakBtn(d.example.de)}</p>`}<p class="lp-en">${esc(d.example.en||'')}</p></div>`:''}</div>`:'';
  function cardHtml(c,stepKey){
    const steps=Array.isArray(c.steps)?c.steps:[], parts=Array.isArray(c.parts)?c.parts:[];
    const shown=Math.min(steps.length,stepsShown[stepKey]||1);
    const visual=(parts.length?partsHtml(parts):'')+(steps.length?stepsHtml(steps,shown):'')+tableHtml(c.table);
    const exParts=(c.examples||[]).flatMap(x=>Array.isArray(x.parts)?x.parts:[]);
    const more=c.more?`<div class="lp-more"><button type="button" class="lp-btn lp-ghost lp-morebtn" data-act="more" aria-expanded="${!!moreShown[stepKey]}" aria-controls="lp-more-t">Explain it more simply</button>
      <p id="lp-more-t" class="lp-moretext"${moreShown[stepKey]?'':' hidden'}>${esc(c.more)}</p></div>`:'';
    const lead=c.lead&&!c.intro?`<div class="lp-lead"><span class="lp-label">What this card teaches</span><p>${esc(c.lead)}</p></div>`:'';
    return `${lead}${c.body?`<p class="lp-body">${esc(c.body)}</p>`:''}${more}
      ${visual?`<div class="lp-visual">${visual}</div>`:''}
      ${(c.examples||[]).length?`<ul class="lp-examples">${c.examples.map(x=>`<li>${Array.isArray(x.parts)&&x.parts.length?`<div class="lp-de lp-de-chips" lang="de"><span class="lp-parts lp-parts-sm">${chipsHtml(x.parts)}</span> ${speakBtn(x.de)}</div>`:`<p class="lp-de" lang="de">${esc(x.de)} ${speakBtn(x.de)}</p>`}<p class="lp-en">${esc(x.en)}</p>${x.why?`<p class="lp-why">${esc(x.why)}</p>`:''}</li>`).join('')}</ul>${exParts.length?legendHtml(exParts):''}`:''}${deeperHtml(c.deeper)}`;
  }
  const linkList=(keys,cat)=>(keys||[]).map(k=>cat&&cat[k]).filter(r=>r&&r.url).map(r=>`<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title||r.label||r.url)}</a></li>`).join('');
  // Every scored question key of a lesson (drills, the new sentence, the quiz). Used to start a redo.
  const lessonKeys=l=>[...(l.drills||[]).map((_,k)=>K.qkey(l.id,'drills',k)),...(l.blind?[K.qkey(l.id,'blind',0)]:[]),...(l.check||[]).map((_,k)=>K.qkey(l.id,'check',k))];

  // ---------- lesson ----------
  function mountLesson(el,lesson,api){
    const st=api.getState(), id=lesson.id, res=api.resources||api.data?.resources||{};
    const rec=st.lessons[id]||(st.lessons[id]={step:0,completedAt:null,completedOnDay:null,redo:false});
    const lvl=(api.data?.levels?.levels||[]).find(l=>l.id===lesson.level);
    const g=lesson.grammar||{}, cards=lesson.cards||[];
    const day=(api.plan?.days||[]).find(d=>d.n===api.dayN), pos=day&&day.lessonIds?day.lessonIds.indexOf(id)+1:0;
    const name=pos?`Lesson ${pos} of ${day.lessonIds.length}`:'Lesson';
    const redo=()=>!!api.getState().lessons[id]?.redo;
    const checkSub=()=>{const s=api.getState(),r=K.section(s,id,'check',lesson.check,redo());const n=lesson.check.filter((_,k)=>(redo()?K.live:K.status)(s,K.qkey(id,'check',k))!=='open').length;return `${redo()?'This time':'Score so far'}: ${r.right} of ${n}`;};
    const ready=()=>['drills','check'].every(s=>K.section(api.getState(),id,s,lesson[s]).done)&&K.status(api.getState(),K.qkey(id,'blind',0))!=='open';
    const mistake=g.mistake?`<div class="lp-mistake"><span class="lp-label">Common mistake</span><p class="lp-wrong" lang="de"><span aria-hidden="true">✗</span> <s>${esc(g.mistake.wrong)}</s></p><p class="lp-right" lang="de"><span aria-hidden="true">✓</span> ${esc(g.mistake.right)}</p><p class="lp-why">${esc(g.mistake.why)}</p></div>`:'';
    const terms=(lesson.terms||[]).length?`<dl class="lp-terms"><span class="lp-label">Words about grammar</span>${lesson.terms.map(t=>`<div><dt>${esc(t.term)}</dt><dd>${esc(t.meaning)}</dd></div>`).join('')}</dl>`:'';
    const gtabs=(api.data?.grammarTables||[]).filter(t=>(t.lessons||[]).includes(id)).map(t=>`<p class="lp-gtab"><a href="#/grammar/${encodeURIComponent(t.id)}">📘 Grammar table: ${esc(t.title)} →</a></p>`).join('');
    const screens=[
      {phase:'Start',title:lesson.title,html:()=>`<p class="lp-goal">${esc(lesson.goal)}</p>
        <div class="lp-oneline"><span class="lp-label">Today's idea</span><p>${esc(g.oneLine||g.point)}</p></div>
        ${gtabs}
        <p class="lp-muted">${lesson.minutes?`About ${lesson.minutes} minutes. `:''}${lesson.printedPages?`Your book: ${esc(lvl?.book||String(lesson.level||'').toUpperCase())}, page ${pages(lesson.printedPages)}. `:''}You can pause any time.</p>`,
        nextLabel:cards.length?'Start learning':'Next: Drills'},
      ...cards.map((c,n)=>{const sk=`${id}#${n}`, steps=Array.isArray(c.steps)?c.steps.length:0, off=cards[0]&&cards[0].intro?1:0;
        return {phase:'Learn',card:n,title:c.title||`Idea ${n+1}`,wide:true,sub:()=>c.intro?'Introduction':`Card ${n+1-off} of ${cards.length-off}`,
          canNext:()=>Math.min(steps,stepsShown[sk]||1)>=steps,
          html:()=>cardHtml(c,sk)+(n===off&&gtabs?`<div class="lp-gtabs">${gtabs}</div>`:'')+(n===off?(lesson.media?.grammarVideos||[]).map(k=>videoHtml(k,res)).join(''):'')+(n===0?terms:'')+(n===cards.length-1&&n>0?mistake:'')};}),
      ...qScreens(lesson.drills||[],id,'drills','Drills','Drill'),
      ...(lesson.blind?[{phase:'New sentence',title:'New sentence on your own',q:lesson.blind,key:K.qkey(id,'blind',0),reset:{name:'New sentence',keys:[K.qkey(id,'blind',0)]},sub:()=>'You have not seen this one before. Use what you just learned.'}]:[]),
      ...qScreens(lesson.check||[],id,'check','Quiz','Question',{sub:checkSub}),
      {phase:'Speak',title:'Say it out loud',html:()=>`<ol class="lp-prompts">${(lesson.speaking?.prompts||[]).map(p=>`<li>${esc(p)}</li>`).join('')}</ol>
        ${(lesson.speaking?.examples||[]).length?`<span class="lp-label">Model answers</span><ul class="lp-models">${lesson.speaking.examples.map(x=>`<li><span lang="de">${esc(x)}</span> ${speakBtn(x)}</li>`).join('')}</ul>`:''}
        <div class="lp-actions"><button type="button" class="lp-btn lp-ghost" data-act="said" aria-pressed="false">I said it out loud</button></div>
        <p class="lp-muted">Speaking is self-checked. The app cannot hear you.</p>`},
      {phase:'Words',title:'New words',html:()=>`<ul class="lp-vocab">${(lesson.vocabulary||[]).map(w=>`<li class="lp-word${w.article?' art-'+esc(w.article):''}">
        <p class="lp-de" lang="de">${w.article?`<span class="lp-art">${esc(w.article)}</span> `:''}${esc(w.de)} ${speakBtn((w.article?w.article+' ':'')+w.de)}</p>
        <p class="lp-en">${esc(w.en)}</p>${w.plural?`<p class="lp-why">Plural: <span lang="de">${esc(w.plural)}</span></p>`:''}${w.forms?`<p class="lp-why">Forms: <span lang="de">${esc(w.forms)}</span></p>`:''}
        ${(w.examples||[]).slice(0,1).map(x=>`<p class="lp-ex" lang="de">${esc(x.de)} ${speakBtn(x.de)}</p><p class="lp-why">${esc(x.en)}</p>`).join('')}</li>`).join('')}</ul>
        <p class="lp-muted">Colour hint: <span class="art-der">der</span> · <span class="art-die">die</span> · <span class="art-das">das</span></p>`,nextLabel:'Next: Summary'},
      {phase:'Done',title:'Lesson summary',final:true,html:()=>{
        const s=api.getState(), r=K.section(s,id,'check',lesson.check), done=!!s.lessons[id]?.completedAt;
        const nw=linkList(lesson.media?.nicosWeg,res.nicosWeg), pr=linkList(lesson.media?.practice,res.links);
        const again=redo()?K.section(s,id,'check',lesson.check,true):null;
        return `<p class="lp-score"><b>${r.right}</b> of ${r.total} right in the quiz${done?' (your first try)':''}</p>
          ${again?`<p class="lp-score lp-again"><b>${again.right}</b> of ${again.total} right this time</p>`:''}
          <p class="lp-muted">A good quiz score shows the rule is starting to stick. Saying it in real conversations is the next step.</p>
          ${nw||pr?`<div class="lp-extra"><span class="lp-label">Extra mile (optional)</span>${nw?`<p>Nicos Weg</p><ul>${nw}</ul>`:''}${pr?`<p>More practice</p><ul>${pr}</ul>`:''}</div>`:''}
          ${ready()?'':'<p class="lp-fb-bad">Some questions are still open. Go back and answer them first.</p>'}
          <div class="lp-actions"><button type="button" class="lp-btn lp-next" data-act="pause"${ready()?'':' disabled'}>${redo()?'Finish redo':done?'Back to the day':'Save &amp; pause'} →</button>
            ${ready()?'':'<button type="button" class="lp-btn lp-ghost" data-act="first-open">Go to open question</button>'}
            ${done&&!redo()?'<button type="button" class="lp-btn lp-ghost" data-act="redo">Redo lesson</button>':''}</div>`;}}
    ];
    engine(el,api,{title:lesson.title,kind:'lesson',screens,redo,over:{label:'Start lesson over',keys:()=>lessonKeys(lesson)},start:redo()?rec.step:Math.min(rec.step,firstOpen(screens,st)),
      banner:()=>redo()?'<p class="lp-banner">Redo. Your first score stays saved; this run is practice.</p>':'',
      onStep:n=>{api.getState().lessons[id].step=n;},
      // the lesson is completed only by Save & pause, once every question is answered (user's rule)
      onPause:()=>{if(!ready())return false;const s=api.getState(),r=K.section(s,id,'check',lesson.check);api.onDone({kind:'lesson',id,right:r.right,total:r.total,redo:redo()});return true;},
      act:(act,b,ctx)=>{
        if(act==='step'){const sk=`${id}#${screens[ctx.index()].card}`;stepsShown[sk]=(stepsShown[sk]||1)+1;ctx.redraw();el.querySelector('.lp-steps li:last-child')?.scrollIntoView?.({block:'nearest'});(el.querySelector('[data-act="step"]')||el.querySelector('.lp-next:not([disabled])'))?.focus();}
        if(act==='more'){const sk=`${id}#${screens[ctx.index()].card}`,o=!moreShown[sk];moreShown[sk]=o;b.setAttribute('aria-expanded',String(o));el.querySelector('#lp-more-t').hidden=!o;}
        if(act==='said'){b.setAttribute('aria-pressed','true');b.textContent='✓ Well done';}
        if(act==='first-open')ctx.go(firstOpen(screens,api.getState()));
        if(act==='redo'){if(K.startRedo(api.getState(),id,lessonKeys(lesson))){Object.keys(pending).forEach(k=>delete pending[k]);api.save();ctx.go(0);}}
      }});
  }


  // ---------- skill day ----------
  function glossText(text,glossary){
    const terms=(glossary||[]).filter(x=>x.de).sort((a,b)=>b.de.length-a.de.length);
    let html=esc(text);
    if(!terms.length)return html;
    const map=new Map(terms.map(t=>[esc(t.de).toLocaleLowerCase('de'),t.en]));
    const re=new RegExp(`(?<![\\p{L}])(${terms.map(t=>esc(t.de).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')})(?![\\p{L}])`,'giu');
    return html.replace(re,m=>`<button type="button" class="lp-gl" data-act="gloss" data-en="${esc(map.get(m.toLocaleLowerCase('de'))||'')}" data-de="${m}">${m}</button>`);
  }
  const paras=html=>html.split(/\n{2,}/).map(p=>`<p>${p.replace(/\n/g,'<br>')}</p>`).join('');
  const scriptLines=script=>String(script||'').split(/\n+/).map(l=>l.trim()).filter(Boolean).map(l=>{const m=l.match(/^([\p{L} .]{1,30}):\s*(.+)$/u);return m?{who:m[1],text:m[2]}:{who:'',text:l};});
  const speakable=script=>scriptLines(script).map(l=>l.text).join('\n');
  function playerHtml(script){
    const t=esc(speakable(script));
    return `<div class="lp-player" role="group" aria-label="Audio"><button type="button" class="lp-btn" data-act="speak" data-text="${t}">▶ Play</button>
      <button type="button" class="lp-btn lp-ghost" data-act="speak" data-text="${t}" data-rate="0.7">Slow 0.7×</button>
      <button type="button" class="lp-btn lp-ghost" data-act="speak" data-text="${t}">↻ Replay</button></div>`;
  }
  const scriptHtml=script=>`<ol class="lp-script">${scriptLines(script).map((l,n)=>`<li class="${n%2?'alt':''}">${l.who?`<b>${esc(l.who)}:</b> `:''}<span lang="de">${esc(l.text)}</span> ${speakBtn(l.text)}</li>`).join('')}</ol>`;
  const textAside=(title,inner)=>`<button type="button" class="lp-fold" data-act="toggle-text" aria-expanded="${!textCollapsed}">${esc(title)} <span aria-hidden="true">▾</span></button><div class="lp-asidebody">${inner}</div>`;

  function mountSkillDay(el,day,api){
    const st=api.getState(), id=day.id;
    const rec=st.skillDays[id]||(st.skillDays[id]={step:0,doneAt:null});
    const R=day.reading||{}, L=day.listening||{}, W=day.writing||{}, F=W.free;
    const dkey=`${id}|free`;
    const sec=n=>K.section(api.getState(),id,n,(day[n]||{})[n==='writing'?'items':'questions']||[]);
    const listenDone=()=>sec('listening').done;
    const readAside=()=>textAside(R.title||'Text',`<div class="lp-reading" lang="de">${paras(glossText(R.text,R.glossary))}</div><p class="lp-glossout" aria-live="polite"></p>`);
    const listenAside=()=>textAside('Audio',playerHtml(L.script));
    const ready=()=>['reading','listening','writing'].every(n=>sec(n).done);
    let modelShown=false;
    const chips=()=>{const f=K.writingFeedback(F,api.getState().drafts[dkey]||'');
      return `<p class="lp-count">${f.words} / ${F.minWords||0} words${f.enough?' ✓':''}</p><ul class="lp-chips">${f.checks.map(c=>`<li class="${c.passed?'is-ok':'is-bad'}">${c.passed?'✓':'✗'} ${esc(c.label)}</li>`).join('')}</ul>`;};
    const screens=[
      {phase:'Reading',title:R.title||'Reading',html:()=>`<p class="lp-muted">Read the text. Tap a dotted word to see the English.</p><div class="lp-reading lp-card" lang="de">${paras(glossText(R.text,R.glossary))}</div><p class="lp-glossout" aria-live="polite"></p>`,nextLabel:'Start questions'},
      ...qScreens(R.questions||[],id,'reading','Reading','Question',{aside:readAside}),
      {phase:'Listening',title:L.title||'Listening',html:()=>`<p class="lp-muted">Listen first. The script stays hidden until you have answered all 10 questions.</p>${playerHtml(L.script)}`,nextLabel:'Start questions'},
      ...qScreens(L.questions||[],id,'listening','Listening','Question',{aside:listenAside}),
      {phase:'Listening',title:'The script',canNext:listenDone,html:()=>listenDone()?`<details class="lp-details"><summary class="lp-btn lp-ghost">Show script</summary>${scriptHtml(L.script)}</details>`:'<p class="lp-muted">Answer all listening questions first.</p>'},
      ...qScreens(W.items||[],id,'writing','Writing','Writing task'),
      ...(F?[{phase:'Writing',title:'Write it yourself',html:()=>`<p class="lp-prompt">${esc(F.prompt)}</p>
        <label class="lp-label" for="lp-free">Your text (at least ${F.minWords||0} words)</label>
        <textarea id="lp-free" class="lp-textarea" rows="6" lang="de" spellcheck="false">${esc(api.getState().drafts[dkey]||'')}</textarea>
        <div class="lp-feedback" aria-live="polite">${chips()}</div>
        <div class="lp-actions"><button type="button" class="lp-btn lp-ghost" data-act="model" aria-expanded="${modelShown}">Compare with model</button></div>
        <div class="lp-model"${modelShown?'':' hidden'}><span class="lp-label">Model answer</span><p lang="de">${esc(F.model)}</p></div>
        <p class="lp-muted">Your text is saved as you type.</p>`}]:[]),
      {phase:'Done',title:'Practice done',final:true,html:()=>{
        const r=['reading','listening','writing'].map(sec); const right=r.reduce((a,x)=>a+x.right,0), total=r.reduce((a,x)=>a+x.total,0);
        return `<table class="lp-table lp-scores"><tbody>${['Reading','Listening','Writing'].map((n,k)=>`<tr><th scope="row">${n}</th><td>${r[k].right} / ${r[k].total}</td></tr>`).join('')}</tbody></table>
          <p class="lp-score"><b>${right}</b> of ${total} right</p>
          ${ready()?'':'<p class="lp-fb-bad">Some questions are still open. Go back and answer them first.</p>'}
          <div class="lp-actions"><button type="button" class="lp-btn lp-next" data-act="finish"${ready()?'':' disabled'}>Finish Practice →</button>${ready()?'':'<button type="button" class="lp-btn lp-ghost" data-act="first-open">Go to open question</button>'}</div>`;}}
    ];
    engine(el,api,{title:'Practice',kind:'practice',screens,over:{label:'Start practice over',keys:()=>['reading','listening','writing'].flatMap(n=>((day[n]||{})[n==='writing'?'items':'questions']||[]).map((_,j)=>K.qkey(id,n,j)))},start:Math.min(rec.step,firstOpen(screens,st)),
      onStep:n=>{api.getState().skillDays[id].step=n;},
      act:(act,b,ctx)=>{
        if(act==='gloss'){const o=el.querySelector('.lp-glossout');if(o)o.innerHTML=`<b lang="de">${esc(b.dataset.de)}</b> = ${esc(b.dataset.en)}`;}
        if(act==='model'){modelShown=!modelShown;el.querySelector('.lp-model').hidden=!modelShown;b.setAttribute('aria-expanded',String(modelShown));}
        if(act==='first-open')ctx.go(firstOpen(screens,api.getState()));
        if(act==='finish'&&ready()){const r=['reading','listening','writing'].map(sec);api.onDone({kind:'skills',id,right:r.reduce((a,x)=>a+x.right,0),total:r.reduce((a,x)=>a+x.total,0)});}
      },
      input:e=>{if(e.target.id!=='lp-free')return;api.getState().drafts[dkey]=e.target.value.slice(0,5000);api.save();el.querySelector('.lp-feedback').innerHTML=chips();}});
  }

  // ---------- recall / review ----------
  function mountRecall(el,items,api){
    const list=(items||[]).filter(x=>x&&x.question);
    const akey=it=>String(it.key).includes('@')?K.qkey('recall',it.key,0):it.key;
    const tally=()=>list.reduce((a,it)=>{const s=K.status(api.getState(),akey(it));if(s==='correct')a.right++;return a;},{right:0});
    const screens=list.map((it,n)=>({phase:'Review',title:`Question ${n+1} of ${list.length}`,q:it.question,key:akey(it),
      sub:()=>it.from||it.lessonId?'From an earlier lesson. Try before you look anything up.':'',
      onDone:v=>{if(String(it.key).includes('@'))window.GERMAN_PLAN?.markRecall?.(api.getState(),it.key,!!v.correct,!!v.revealed,new Date());
        else if(v.correct&&it.from)delete api.getState().notYet[it.from];}}));   // core only clears notYet under the review key
    screens.push({phase:'Done',title:'Review done',final:true,html:()=>`<p class="lp-score"><b>${tally().right}</b> of ${list.length} remembered</p>
      <p class="lp-muted">Anything you revealed comes back later. That is how it sticks.</p>
      <div class="lp-actions"><button type="button" class="lp-btn lp-next" data-act="finish">Back to the day →</button></div>`});
    const done=()=>firstOpen(screens,api.getState())>=list.length;
    engine(el,api,{title:'Review',kind:'review',screens,start:firstOpen(screens,api.getState()),
      act:act=>{if(act==='finish'&&done())api.onDone({kind:'recall',right:tally().right,total:list.length});}});
  }

  // ---------- mock ----------
  const SKILL={reading:'Reading',listening:'Listening',writing:'Writing',grammar:'Grammar'};
  const TIP={reading:'Re-read one skill-day text a day and answer its questions again.',listening:'Replay a listening script at 0.7× and shadow it line by line.',
    writing:'Do one free-writing task a day and compare with the model.',grammar:'Redo the check questions of the lessons you revealed most.'};
  function mountMock(el,mock,api){
    const id=mock.id, S=mock.sections||[];
    const rows=()=>S.map((s,k)=>({skill:s.skill,...K.section(api.getState(),id,`mock-${k}`,s.questions||[])}));
    const screens=[{phase:'Intro',title:mock.title||'Practice mock',html:()=>`<p class="lp-goal">Practice mock in the Goethe style. Passing it is a good sign, not a certificate.</p>
      <ul class="lp-prompts">${S.map(s=>`<li>${esc(SKILL[s.skill]||s.skill)}: ${(s.questions||[]).length} questions</li>`).join('')}</ul>
      <p class="lp-muted">No hints from books or apps. Hints inside the mock still appear after 2 wrong tries, but revealed answers count as wrong.</p>`,nextLabel:'Start'}];
    S.forEach((s,k)=>{
      const name=SKILL[s.skill]||s.skill;
      const aside=s.skill==='listening'?()=>textAside('Audio',playerHtml(s.text)):s.text?()=>textAside('Text',`<div class="lp-reading" lang="de">${paras(esc(s.text))}</div>`):null;
      screens.push({phase:name,title:`${name}`,html:()=>`<p>${esc(s.instructions)}</p>${s.skill==='listening'?playerHtml(s.text):s.text?`<div class="lp-reading lp-card" lang="de">${paras(esc(s.text))}</div>`:''}`,nextLabel:'Start questions'});
      screens.push(...qScreens(s.questions||[],id,`mock-${k}`,name,`${name}: question`,aside?{aside}:{}));
    });
    screens.push({phase:'Result',title:'Your mock result',final:true,html:()=>{
      const r=rows(); const right=r.reduce((a,x)=>a+x.right,0), total=r.reduce((a,x)=>a+x.total,0);
      const weak=r.filter(x=>x.total).sort((a,b)=>a.right/a.total-b.right/b.total)[0];
      return `<table class="lp-table lp-scores"><thead><tr><th scope="col">Section</th><th scope="col">Right</th><th scope="col">%</th></tr></thead><tbody>${r.map(x=>`<tr${x===weak?' class="is-weak"':''}><th scope="row">${esc(SKILL[x.skill]||x.skill)}</th><td>${x.right} / ${x.total}</td><td>${x.total?Math.round(x.right/x.total*100):0}%</td></tr>`).join('')}</tbody></table>
        <p class="lp-score"><b>${right}</b> of ${total} · ${total?Math.round(right/total*100):0}%</p>
        <p class="lp-muted">${total&&right/total>=0.6?'Practice mock passed (60% or more). A good sign, not a certificate.':'Not passed yet (under 60%). That is useful information, not a verdict.'}</p>
        ${weak?`<div class="lp-hint"><b>Weakest: ${esc(SKILL[weak.skill]||weak.skill)}</b><p>${esc(TIP[weak.skill]||'Practise this section again.')}</p></div>`:''}
        <div class="lp-actions"><button type="button" class="lp-btn lp-next" data-act="finish">Finish practice mock →</button></div>`;}});
    const open=()=>firstOpen(screens,api.getState());
    const started=Object.keys(api.getState().answers).some(k=>k.startsWith(id+'|'));
    const o0=open();
    engine(el,api,{title:'Mock',kind:'practice mock',screens,start:!started?0:o0>=screens.length?screens.length-1:Math.max(0,o0-((screens[o0-1]&&!screens[o0-1].q)?1:0)),
      act:(act,b,ctx)=>{if(act!=='finish')return;const o=open();if(o<screens.length)return ctx.go(o);api.onDone({kind:'mock',id,sections:rows().map(({skill,right,total})=>({skill,right,total}))});}});
  }

  window.GERMAN_PLAYER={mountLesson,mountSkillDay,mountRecall,mountMock,renderQuestion,videoHtml,lessonKeys};
})();

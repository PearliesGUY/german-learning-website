// GERMAN_MOTIVATION: gentle timed reminders while studying, and the "wow" overlay after a lesson, day, week or level.
(function(root){
  'use strict';
  let api=null, timer=null, elapsed=0, since=0, lastTick=0, startCorrect=0, startAnswered=0, bag=[], lastMsg=-1;
  const TICK=10000;

  // c = {right, answered, streak, minutes}: numbers from this sitting. Never guilt, never pressure.
  const MESSAGES=[
    c=>c.right>0?`${c.right} right so far. That is real progress.`:`You are here and working. That is the hard part.`,
    c=>`${c.minutes} minutes of German. Your brain is busy building new paths.`,
    ()=>`Every day you show up counts. This is one of them.`,
    ()=>`Small steps add up. You are taking one right now.`,
    ()=>`Mistakes are how the rule sticks. Keep them coming.`,
    ()=>`Take a breath. You are doing better than you think.`,
    ()=>`Say the next sentence out loud. Your mouth learns too.`,
    c=>c.answered>0?`${c.answered} answers given. Each one trains your memory.`:`Ready when you are. One question at a time.`,
    ()=>`Want a stretch? Stand up for ten seconds, then carry on.`,
    ()=>`Sip some water. Brains like it.`,
    ()=>`Not sure? Guess. A guess teaches more than a skip.`,
    ()=>`You do not need to be fast. You only need to keep going.`,
    ()=>`Hints are tools, not failures. Use them freely.`,
    c=>c.right>=10?`${c.right} correct answers. That is a full check quiz worth.`:`Each right answer is a little deposit in your German bank.`,
    ()=>`Focus drifting? That is normal. Come back to the next question.`,
    ()=>`German word order feels odd at first. It gets familiar.`,
    ()=>`You can pause any time. Your place is saved.`,
    ()=>`Read the example once more. Patterns jump out the second time.`,
    c=>`${c.minutes} focused minutes. Nicely done.`,
    ()=>`Gut gemacht! That means: well done.`,
    ()=>`Weiter so! That means: keep it up.`,
    ()=>`Remember: one thing at a time. Just this question.`,
    ()=>`Your future self, chatting in German, says thanks.`,
    ()=>`Curious about a word? Say it slowly. Sounds stick better than spelling.`,
    c=>c.answered>=20?`${c.answered} answers in one sitting. Strong focus.`:`Steady beats speedy. You are steady.`,
    ()=>`If this feels hard, it means you are learning, not failing.`,
    ()=>`You already know more German than when you opened this page.`,
    ()=>`Halfway feelings are normal. The finish line is closer than it looks.`,
    ()=>`Shoulders down, jaw loose. Then the next one.`,
    ()=>`Toll! That means: great. Because you are doing great.`,
    ()=>`Coming back is the whole secret. You keep coming back.`,
    ()=>`A short break after this part is a fine idea.`,
    ()=>`Proud of you for sitting down to do this.`,
  ];

  const settings=()=>{try{return api&&api.getState().settings||{};}catch{return {};}};
  const reducedMotion=()=>!!settings().reduced||(root.matchMedia&&root.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Shuffle bag: every message is used once before any repeats, and never the same one twice in a row.
  function nextMessage(){
    if(!bag.length){
      bag=MESSAGES.map((_,i)=>i).sort(()=>Math.random()-.5);
      if(bag[bag.length-1]===lastMsg)bag.unshift(bag.pop());
    }
    const i=bag.pop();lastMsg=i;
    const st=api.getState();
    return MESSAGES[i]({right:Math.max(0,st.stats.correct-startCorrect),answered:Math.max(0,st.stats.answered-startAnswered),
      streak:st.streak.count,minutes:Math.max(1,Math.round(elapsed/6e4))});
  }

  function tick(){
    const now=Date.now(), dt=now-lastTick; lastTick=now;
    const s=settings();
    if(!s.reminders)return;
    const hidden=document.hidden;
    const canNotify=hidden&&'Notification' in root&&Notification.permission==='granted';
    if(hidden&&!canNotify)return; // paused while the tab is hidden
    elapsed+=dt;since+=dt;
    if(since>=(s.interval||5)*6e4){
      since=0;
      const msg=nextMessage();
      if(canNotify){try{new Notification('German',{body:msg,tag:'german-reminder'});}catch{api.toast(msg);}}
      else api.toast(msg);
    }
  }

  function connect(a){if(a&&typeof a.getState==='function')api=a;}

  function start(a){
    connect(a);if(!api)return;
    stop();
    const st=api.getState();
    startCorrect=st.stats.correct;startAnswered=st.stats.answered;elapsed=0;since=0;lastTick=Date.now();
    timer=setInterval(tick,TICK);
  }
  function stop(){if(timer)clearInterval(timer);timer=null;}

  function chime(){
    try{
      const C=root.AudioContext||root.webkitAudioContext;if(!C)return;
      const ctx=new C(), t=ctx.currentTime;
      [659.25,987.77].forEach((f,i)=>{
        const o=ctx.createOscillator(), g=ctx.createGain();
        o.type='sine';o.frequency.value=f;
        g.gain.setValueAtTime(0,t+i*.12);g.gain.linearRampToValueAtTime(.08,t+i*.12+.02);g.gain.exponentialRampToValueAtTime(.0001,t+i*.12+.6);
        o.connect(g).connect(ctx.destination);o.start(t+i*.12);o.stop(t+i*.12+.65);
      });
      setTimeout(()=>ctx.close(),1200);
    }catch{}
  }

  function confetti(host){
    const c=document.createElement('canvas');host.prepend(c);
    const dpr=Math.min(2,root.devicePixelRatio||1), w=c.width=host.clientWidth*dpr, h=c.height=host.clientHeight*dpr;
    const g=c.getContext('2d');if(!g)return;
    const colors=['#f2f2f2','#5fd38d','#ffc857','#a8a8a8'];
    const parts=Array.from({length:110},()=>({x:w/2+(Math.random()-.5)*w*.2,y:h*.42,vx:(Math.random()-.5)*14*dpr,vy:(-Math.random()*14-4)*dpr,
      s:(4+Math.random()*5)*dpr,r:Math.random()*6,vr:(Math.random()-.5)*.4,c:colors[Math.random()*colors.length|0]}));
    const t0=performance.now(), DUR=1400;
    (function frame(now){
      const p=(now-t0)/DUR;
      g.clearRect(0,0,w,h);
      if(p>=1||!c.isConnected){c.remove();return;}
      g.globalAlpha=Math.min(1,(1-p)*2.5);
      for(const q of parts){q.vy+=.45*dpr;q.vx*=.99;q.x+=q.vx;q.y+=q.vy;q.r+=q.vr;
        g.save();g.translate(q.x,q.y);g.rotate(q.r);g.fillStyle=q.c;g.fillRect(-q.s/2,-q.s/4,q.s,q.s/2);g.restore();}
      requestAnimationFrame(frame);
    })(t0);
  }

  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const HEAD={lesson:'Lesson complete',day:'Day complete',week:'Week complete',level:'Level complete'};
  const CHEER={lesson:['Wunderbar!','Super gemacht!','Klasse!'],day:['Fantastisch!','Ein ganzer Tag!','Stark!'],
    week:['Eine ganze Woche!','Unglaublich!'],level:['Geschafft!','Bravo!']};

  // Returns a Promise resolved when the overlay closes (or at once if celebrations are off).
  function celebrate(kind,info){
    info=info||{};
    const s=settings();
    if(s.celebrate===false)return Promise.resolve();
    return new Promise(resolve=>{
      const prev=document.activeElement;
      const total=Number(info.total)||0, right=Math.max(0,Math.min(total,Number(info.right)||0));
      const pct=total?Math.round(right/total*100):100;
      const C=2*Math.PI*64;
      const cheer=(CHEER[kind]||CHEER.lesson);
      const centre=total?`${right}<small>of ${total}</small>`:kind==='level'?esc(info.level||'✓'):'✓';
      const learned=info.learned||info.title;
      const el=document.createElement('div');
      el.className='wow';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-labelledby','wow-h');
      el.innerHTML=`<div class="wow-card">
        <p class="wow-kind">${esc(HEAD[kind]||'Well done')}</p>
        <div class="ring" aria-hidden="true"><svg viewBox="0 0 148 148"><circle class="trk" cx="74" cy="74" r="64"/>
          <circle class="val" cx="74" cy="74" r="64" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg><b>${centre}</b></div>
        <h2 id="wow-h">${esc(cheer[Math.random()*cheer.length|0])}</h2>
        ${total?`<p class="sr-only">${right} of ${total} right.</p>`:''}
        ${learned?`<p class="learned">You just learned: ${esc(learned)}</p>`:''}
        ${info.streak?`<p class="wstreak">🔥 ${Number(info.streak)}-day streak</p>`:''}
        <button type="button" class="btn primary big" data-close>Continue</button></div>`;
      document.body.appendChild(el);
      const val=el.querySelector('.val');
      requestAnimationFrame(()=>requestAnimationFrame(()=>{val.style.strokeDashoffset=String(C*(1-pct/100));}));
      if(!reducedMotion())confetti(el);
      if(s.sound)chime();
      const btn=el.querySelector('[data-close]');btn.focus();
      let closed=false;
      const close=()=>{if(closed)return;closed=true;document.removeEventListener('keydown',key,true);el.remove();
        if(prev&&prev.focus&&prev.isConnected)prev.focus();resolve();};
      const key=e=>{if(e.key==='Escape'||e.key==='Enter'){e.preventDefault();e.stopPropagation();close();}
        else if(e.key==='Tab'){e.preventDefault();btn.focus();}};
      document.addEventListener('keydown',key,true);
      el.addEventListener('click',close);
    });
  }

  root.GERMAN_MOTIVATION={start,stop,celebrate,connect,messages:MESSAGES.length};
})(window);

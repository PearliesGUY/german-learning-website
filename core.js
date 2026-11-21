// Saved state, migration and answer checking. Pure logic: no DOM, no localStorage (app.js does storage).
(function(root){
  'use strict';
  const VERSION=2;
  const HINT_AFTER=2; // wrong tries before the hint shows and "Show answer" unlocks

  const normalise=s=>String(s??'').normalize('NFC').toLocaleLowerCase('de').replace(/ß/g,'ss')
    .replace(/[.,!?;:„“”"'’‚‘«»()\-–—]/g,' ').replace(/\s+/g,' ').trim();

  const defaults=planId=>({version:VERSION,planId:planId||null,
    position:{day:1},          // furthest unlocked plan day the learner is on
    days:{},                   // "<n>": {startedAt, doneAt}
    lessons:{},                // "<lessonId>": {step, completedAt, completedOnDay, redo}  redo: replaying a finished lesson
    practice:{},               // "<qkey>": {tries, correct, revealed, value}  "Try again" / redo answers; never scored
    skillDays:{},              // "<skillDayId>": {step, doneAt}
    answers:{},                // "<qkey>": {tries, correct, revealed, value}
    notYet:{},                 // "<qkey>": true  -> revealed answers come back in recall
    recall:{},                 // "<lessonId>@<rung>": {passed, revealed, doneAt}
    words:{},                  // "<wordId>": {level, due}
    drafts:{},                 // "<key>": free-writing text
    streak:{count:0,last:null},
    stats:{correct:0,answered:0},
    settings:{reminders:true,interval:5,celebrate:true,sound:false,reduced:false,speed:0.85}});

  const isObj=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
  const isDate=v=>typeof v==='string'&&!Number.isNaN(Date.parse(v));
  const int=(v,min,max,d)=>{const n=Math.trunc(Number(v));return Number.isFinite(n)?Math.max(min,Math.min(max,n)):d;};
  const KEY=/^[\w@|:.-]{1,120}$/;
  const pick=(obj,fn)=>Object.fromEntries(Object.entries(isObj(obj)?obj:{}).filter(([k])=>KEY.test(k)).map(([k,v])=>[k,fn(v)]).filter(([,v])=>v!==undefined));

  // Shape-checks a v2 state. Unknown keys are dropped; nothing throws.
  function clean(input,planId){
    const s=defaults(planId);
    if(!isObj(input))return s;
    s.planId=typeof input.planId==='string'?input.planId:s.planId;
    s.position={day:int(input.position?.day,1,999,1)};
    s.days=pick(input.days,v=>isObj(v)?{startedAt:isDate(v.startedAt)?v.startedAt:null,doneAt:isDate(v.doneAt)?v.doneAt:null}:undefined);
    s.lessons=pick(input.lessons,v=>isObj(v)?{step:int(v.step,0,999,0),completedAt:isDate(v.completedAt)?v.completedAt:null,completedOnDay:v.completedOnDay==null?null:int(v.completedOnDay,1,999,null),redo:!!v.redo&&isDate(v.completedAt)}:undefined);
    s.skillDays=pick(input.skillDays,v=>isObj(v)?{step:int(v.step,0,999,0),doneAt:isDate(v.doneAt)?v.doneAt:null}:undefined);
    const ans=v=>isObj(v)?{tries:int(v.tries,0,999,0),correct:!!v.correct,revealed:!!v.revealed,value:typeof v.value==='string'?v.value.slice(0,2000):Array.isArray(v.value)?v.value.filter(Number.isInteger).slice(0,60):Number.isInteger(v.value)?v.value:null}:undefined;
    s.answers=pick(input.answers,ans);
    s.practice=pick(input.practice,ans);
    s.notYet=pick(input.notYet,v=>v===true?true:undefined);
    s.recall=pick(input.recall,v=>isObj(v)?{passed:!!v.passed,revealed:!!v.revealed,doneAt:isDate(v.doneAt)?v.doneAt:null}:undefined);
    s.words=pick(input.words,v=>isObj(v)&&Number.isFinite(v.due)?{level:int(v.level,0,5,0),due:v.due}:undefined);
    s.drafts=pick(input.drafts,v=>typeof v==='string'?v.slice(0,5000):undefined);
    s.streak={count:int(input.streak?.count,0,9999,0),last:/^\d{4}-\d{2}-\d{2}$/.test(input.streak?.last||'')?input.streak.last:null};
    s.stats={correct:int(input.stats?.correct,0,1e7,0),answered:int(input.stats?.answered,0,1e7,0)};
    const st=input.settings||{};
    s.settings={reminders:st.reminders!==false,interval:[3,5,10].includes(st.interval)?st.interval:5,celebrate:st.celebrate!==false,
      sound:!!st.sound,reduced:!!st.reduced,openAll:!!st.openAll,theme:['gold','fiery','deepsea','classic','lapis'].includes(st.theme)?st.theme:'gold',speed:[0.7,0.85,1].includes(st.speed)?st.speed:0.85};
    return s;
  }

  // Any stored value -> {state, backup}. backup is the old raw value when it is not v2 (caller saves it once).
  // Idempotent: migrate(JSON of migrate(x).state) gives the same state.
  function migrate(raw,planId){
    let data=raw;
    if(typeof raw==='string'){try{data=JSON.parse(raw);}catch{data=null;}}
    if(isObj(data)&&data.version===VERSION)return {state:clean(data,planId),backup:null};
    return {state:defaults(planId),backup:data==null?null:raw};
  }

  const qkey=(owner,section,i)=>`${owner}|${section}|${i}`;

  function isCorrect(q,value){
    if(!q)return false;
    if(q.type==='choice')return value!=null&&value!==''&&Number(value)===q.answer;
    if(q.type==='build'){
      const text=Array.isArray(value)?value.map(i=>q.tokens[i]).join(' '):value;
      return normalise(text)===normalise(q.answer.join(' '));
    }
    return (q.answers||[]).some(a=>normalise(value)===normalise(a));
  }

  const st=a=>!a?'open':a.correct?'correct':a.revealed?'revealed':'open';
  // status = the first try (this is the score). live = what the learner sees now (a practice retry if one exists).
  const status=(state,key)=>st(state.answers[key]);
  const record=(state,key)=>(state.practice&&state.practice[key])||state.answers[key]||null;
  const live=(state,key)=>st(record(state,key));
  const fresh=()=>({tries:0,correct:false,revealed:false,value:null});

  // One try. Returns what the UI should show next. Practice tries (after "Try again" or in a redo) never touch answers or stats.
  function attempt(state,key,q,value){
    const p=state.practice&&state.practice[key];
    if(p){if(p.correct||p.revealed)return view(p);p.tries++;p.value=value;if(isCorrect(q,value))p.correct=true;return view(p);}
    const a=state.answers[key]||(state.answers[key]=fresh());
    if(a.correct||a.revealed)return view(a);
    const ok=isCorrect(q,value);
    a.tries++;a.value=value;
    state.stats.answered++;
    if(ok){a.correct=true;state.stats.correct++;delete state.notYet[key];}
    return view(a);
  }
  // "Try again": only once the question is answered or revealed. Clears the visible answer; the first try stays the score.
  function retry(state,key){
    if(live(state,key)==='open')return false;
    (state.practice||(state.practice={}))[key]=fresh();return true;
  }
  // Redo a finished lesson from the start. keys = every question key of the lesson. completedAt/completedOnDay and answers stay.
  function startRedo(state,lessonId,keys){
    const rec=state.lessons[lessonId];if(!rec||!rec.completedAt)return false;
    rec.redo=true;rec.step=0;
    const p=state.practice||(state.practice={});keys.forEach(k=>{p[k]=fresh();});return true;
  }
  // "Reset answers": show these questions fresh again. Only questions whose first try is finished (or already practising) get a
  // practice entry; an unanswered one keeps counting as the first try. answers, stats, completedAt, completedOnDay never change.
  function resetKeys(state,keys){
    const p=state.practice||(state.practice={});let n=0;
    keys.forEach(k=>{if(p[k]||status(state,k)!=='open'){p[k]=fresh();n++;}});return n;
  }
  function endRedo(state,lessonId){
    const rec=state.lessons[lessonId];if(rec)rec.redo=false;
    for(const k of Object.keys(state.practice||{}))if(k.startsWith(lessonId+'|'))delete state.practice[k];
  }
  const view=a=>({correct:a.correct,revealed:a.revealed,tries:a.tries,showHint:!a.correct&&!a.revealed&&a.tries>=HINT_AFTER,
    canReveal:!a.correct&&!a.revealed&&a.tries>=HINT_AFTER,done:a.correct||a.revealed});

  function reveal(state,key){
    const p=state.practice&&state.practice[key];
    if(p){if(p.correct||p.revealed||p.tries<HINT_AFTER)return false;p.revealed=true;return true;}
    const a=state.answers[key];
    if(!a||a.correct||a.revealed||a.tries<HINT_AFTER)return false;
    a.revealed=true;state.notYet[key]=true;return true;
  }

  // questions: array; returns {done, right, total} for a section owned by `owner`. First tries only, unless useLive (redo score).
  function section(state,owner,name,questions,useLive){
    let right=0,done=0;
    questions.forEach((_,i)=>{const s=(useLive?live:status)(state,qkey(owner,name,i));if(s!=='open')done++;if(s==='correct')right++;});
    return {done:done===questions.length,right,total:questions.length};
  }

  function writingFeedback(free,text){
    const words=String(text||'').trim().split(/\s+/).filter(Boolean).length;
    const norm=normalise(text);
    const checks=(free.checks||[]).map(c=>{let passed=false;try{passed=new RegExp(c.pattern,'iu').test(norm);}catch{}return {label:c.label,passed};});
    return {words,enough:words>=(free.minWords||0),checks,passed:words>=(free.minWords||0)&&checks.every(c=>c.passed)};
  }

  const dateKey=(d=new Date())=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  function touchStreak(state,now=new Date()){
    const today=dateKey(now);if(state.streak.last===today)return state.streak.count;
    const y=new Date(now);y.setDate(y.getDate()-1);
    state.streak.count=state.streak.last===dateKey(y)?state.streak.count+1:1;state.streak.last=today;return state.streak.count;
  }

  // Word review ladder in calendar days (vocabulary only; lesson recall uses plan days, see plan.js).
  function reviewWord(state,id,remembered,now=Date.now()){
    const cur=state.words[id]||{level:0};
    const level=remembered?Math.min(5,cur.level+1):0;
    state.words[id]={level,due:remembered?now+[0,1,3,7,14,30][level]*864e5:now+10*6e4};
  }

  root.KLEIN_CORE={VERSION,HINT_AFTER,normalise,defaults,clean,migrate,qkey,isCorrect,status,live,record,attempt,retry,resetKeys,startRedo,endRedo,reveal,section,writingFeedback,dateKey,touchStreak,reviewWord};
})(typeof window==='undefined'?globalThis:window);

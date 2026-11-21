// Day-by-day plan built from GERMAN_FULL_DATA, plus progress rules. Pure logic: no DOM, no storage.
(function(root){
  'use strict';
  const pad=n=>String(n).padStart(2,'0');
  const iso=now=>new Date(now??Date.now()).toISOString();
  const core=()=>root.KLEIN_CORE;

  function build(data){
    const L=data.levels, perDay=L.lessonsPerLearnDay||3, block=(L.week&&L.week.learn)||5;
    const lessonById=new Map(data.lessons.map(x=>[x.id,x]));
    const skillDayById=new Map(data.skillDays.map(x=>[x.id,x]));
    const mockById=new Map(data.mocks.map(x=>[x.id,x]));
    const dayOfLesson=new Map(), days=[];
    const plattAfter=new Set(L.plattformAfterChapters||[]);
    let chunk=[];
    const base=(lv,kind,extra)=>{const n=days.length+1;return {n,week:Math.ceil(n/(block+1)),dayInWeek:(n-1)%(block+1)+1,level:lv,kind,minutes:L.minutesPerDay,plattform:false,...extra};};
    const push=(lv,kind,extra)=>{
      const d=base(lv,kind,extra);days.push(d);chunk.push(d);
      (d.lessonIds||[]).forEach(id=>dayOfLesson.set(id,d.n));
      if(chunk.length===block){
        const reviewOf=chunk.flatMap(c=>c.lessonIds||[]);
        const r=base(lv,'review',{reviewOf,available:reviewOf.every(id=>lessonById.has(id))});
        r.title=`Week ${r.week} review`;
        r.plattform=chunk.some(c=>c.endsChapter&&plattAfter.has(c.chapter));
        chunk.forEach(c=>delete c.endsChapter);
        days.push(r);chunk=[];
      }
    };
    for(const lv of L.levels){
      const T=lv.title||lv.id.toUpperCase();
      const chapters=Object.keys(lv.chapterDays).map(Number).sort((a,b)=>a-b);
      for(const ch of chapters){
        const cd=lv.chapterDays[ch];
        for(let k=0;k<cd;k++){
          const lessonIds=Array.from({length:perDay},(_,i)=>`${lv.id}-c${pad(ch)}-${pad(k*perDay+i+1)}`);
          const skillDayId=`${lv.id}-c${pad(ch)}-d${k+1}`;
          const name=lessonById.get(lessonIds[0])?.chapterTitle;
          push(lv.id,'learn',{chapter:ch,lessonIds,skillDayId,endsChapter:k===cd-1,
            title:`${T} · Ch ${ch}${name?' · '+name:''} (day ${k+1} of ${cd})`,
            available:lessonIds.every(id=>lessonById.has(id))&&skillDayById.has(skillDayId)});
        }
      }
      // shortcut: a buffer day reviews the whole level (reviewSet caps it at 40), make it targeted if learners ask
      const levelLessons=days.filter(d=>d.level===lv.id&&d.kind==='learn').flatMap(d=>d.lessonIds);
      for(let i=1;i<=(lv.bufferDays||0);i++)push(lv.id,'buffer',{reviewOf:levelLessons,title:`${T} catch-up day ${i}`,available:true});
      for(let i=1;i<=(lv.mockDays||0);i++){const mockId=`${lv.id}-mock-${i}`;push(lv.id,'mock',{mockId,title:`${T} practice mock ${i}`,available:mockById.has(mockId)});}
    }
    return {days,lessonById,skillDayById,mockById,dayOfLesson,ladder:L.reviewLadder||[1,3,7,21]};
  }

  const day=(plan,n)=>plan.days[n-1];

  function dueRecall(plan,state,n){
    const out=[];
    for(const [id,rec] of Object.entries(state.lessons)){
      const lesson=plan.lessonById.get(id);
      if(!lesson||!rec||rec.completedOnDay==null)continue;
      plan.ladder.forEach((gap,rung)=>{
        const key=`${id}@${rung}`, question=(lesson.retrieval||[])[rung];
        if(question&&rec.completedOnDay+gap<=n&&!state.recall[key]?.passed)out.push({key,lessonId:id,rung,question});
      });
    }
    return out;
  }

  function reviewSet(plan,state,n){
    const d=day(plan,n);if(!d||!d.reviewOf)return [];
    const C=core(), picked=[], seen=new Set();
    const add=(from,question)=>{if(question&&!seen.has(from)){seen.add(from);picked.push({from,question});}};
    for(const id of d.reviewOf){
      const l=plan.lessonById.get(id);if(!l)continue;
      for(const k of Object.keys(state.notYet)){
        const [owner,sec,i]=k.split('|');
        if(owner===id)add(k,sec==='blind'?l.blind:(l[sec]||[])[+i]);
      }
      const ch=l.check||[];
      for(let j=0;j<Math.min(2,ch.length);j++){const i=(n*2+j)%ch.length;add(C.qkey(id,'check',i),ch[i]);}
    }
    // stable: grammar first, notYet stay ahead of fresh checks inside each group
    const items=picked.map((x,i)=>({...x,i,g:x.question.grammar===true?0:1})).sort((a,b)=>a.g-b.g||a.i-b.i).slice(0,40);
    return items.map((x,i)=>({key:C.qkey(`day-${n}`,'review',i),question:x.question,from:x.from}));
  }

  function dayParts(plan,state,n){
    const d=day(plan,n);if(!d)return [];
    const C=core(), parts=[];
    const due=dueRecall(plan,state,n);
    // shortcut: a revealed recall counts as done on later days too (core state keeps no day per recall)
    if(due.length)parts.push({kind:'recall',id:`recall-${n}`,title:'Quick recall',done:due.every(x=>state.recall[x.key])});
    if(d.kind==='learn'){
      d.lessonIds.forEach(id=>parts.push({kind:'lesson',id,title:plan.lessonById.get(id)?.title||'Lesson not written yet',done:!!state.lessons[id]?.completedAt}));
      parts.push({kind:'skills',id:d.skillDayId,title:'Reading, listening, writing',done:!!state.skillDays[d.skillDayId]?.doneAt});
    }else if(d.kind==='mock'){
      const m=plan.mockById.get(d.mockId);
      parts.push({kind:'mock',id:d.mockId,title:m?.title||d.title,done:!!m&&m.sections.every((s,i)=>C.section(state,d.mockId,`mock-${i}`,s.questions).done)});
    }else{
      const qs=reviewSet(plan,state,n).map(x=>x.question);
      parts.push({kind:'review',id:`review-${n}`,title:d.title,done:C.section(state,`day-${n}`,'review',qs).done});
    }
    return parts;
  }

  const dayDone=(plan,state,n)=>{const d=day(plan,n);return !!d&&d.available!==false&&dayParts(plan,state,n).every(p=>p.done);};

  function completeLesson(plan,state,lessonId,now){
    const l=plan.lessonById.get(lessonId);if(!l)return false;
    const C=core();
    const ok=['drills','check'].every(s=>C.section(state,lessonId,s,l[s]||[]).done)&&C.section(state,lessonId,'blind',[l.blind]).done;
    if(!ok)return false;
    const rec=state.lessons[lessonId]||(state.lessons[lessonId]={step:0,completedAt:null,completedOnDay:null});
    if(!rec.completedAt){rec.completedAt=iso(now);rec.completedOnDay=state.position.day;}
    return true;
  }

  function finishDay(plan,state,n,now){
    if(!dayDone(plan,state,n))return false;
    const rec=state.days[n]||(state.days[n]={startedAt:null,doneAt:null});
    if(!rec.doneAt)rec.doneAt=iso(now);
    if(n===state.position.day)state.position.day=n+1; // a day opened early (Settings → Open every day) never moves you forward
    return true;
  }

  function markRecall(state,key,passed,revealed,now){
    const prev=state.recall[key]||{};
    state.recall[key]={passed:!!passed||!!prev.passed,revealed:!!revealed||!!prev.revealed,doneAt:iso(now)};
  }

  function stats(plan,state){
    const byLevel={};
    for(const d of plan.days){const b=byLevel[d.level]||(byLevel[d.level]={done:0,total:0});b.total++;if(state.days[d.n]?.doneAt)b.done++;}
    const cur=day(plan,Math.min(state.position.day,plan.days.length));
    return {daysDone:plan.days.filter(d=>state.days[d.n]?.doneAt).length,
      lessonsDone:Object.entries(state.lessons).filter(([id,r])=>r.completedAt&&plan.lessonById.has(id)).length,
      wordsSeen:Object.keys(state.words).length,
      accuracy:state.stats.answered?state.stats.correct/state.stats.answered:0,
      byLevel,week:cur?cur.week:1};
  }

  root.GERMAN_PLAN={build,dueRecall,reviewSet,dayParts,dayDone,completeLesson,finishDay,markRecall,stats};
})(typeof window==='undefined'?globalThis:window);

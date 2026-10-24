/* Proof Journey: progressive, read-only visual storytelling.
   No network, storage, wallet, SDK or transaction access. */
(()=>{
  'use strict';
  const root=document.documentElement;
  const chapters=[...document.querySelectorAll('.pj-chapter')];
  const nodes=[...document.querySelectorAll('.pj-node')];
  const title=document.getElementById('pj-read-title');
  const desc=document.getElementById('pj-read-desc');
  const signal=document.getElementById('pj-read-signal');
  const scene=document.getElementById('pj-scene');
  if(!chapters.length||!scene)return;
  const scenes=[
    ['Define the evidence','The funder defines public checks before the milestone begins.','CRITERIA REGISTERED'],
    ['Evidence becomes inspectable','The builder publishes a release, file, live site, or claim that the validators can inspect.','PUBLIC SOURCE LINKED'],
    ['Independent verification','GenLayer validators evaluate the public sources; unavailable evidence remains ERROR, not FAIL.','ASSESSMENT IN PROGRESS'],
    ['A decision on record','After the challenge window, finalization reassesses the evidence and records the application verdict.','APPLICATION FINALIZED']
  ];
  let active=-1;
  function select(index){
    if(index===active)return;
    active=index;
    chapters.forEach((el,i)=>{el.dataset.active=String(i===index)});
    nodes.forEach((el,i)=>{el.dataset.lit=String(i<=index);const button=el.querySelector('[data-pj-step]');if(button)button.setAttribute('aria-pressed',String(i===index))});
    title.textContent=scenes[index][0];desc.textContent=scenes[index][1];signal.textContent=scenes[index][2];
    scene.dataset.scene=String(index+1);
  }
  select(0);
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Both chapter cards and diagram nodes are direct, keyboard-accessible navigation.
  // Scroll the target chapter into the stage viewport so subsequent scroll tracking
  // continues naturally rather than immediately reverting the selected step.
  function goToStep(index){
    if(!Number.isInteger(index)||index<0||index>=chapters.length)return;
    select(index);
    chapters[index].scrollIntoView({behavior:reduced?'auto':'smooth',block:'center'});
  }
  chapters.forEach((el,index)=>{
    el.addEventListener('click',()=>goToStep(index));
    el.addEventListener('keydown',event=>{
      if(event.key==='Enter'||event.key===' '){
        event.preventDefault();
        goToStep(index);
      }
    });
  });
  nodes.forEach((el,index)=>{
    const button=el.querySelector('[data-pj-step]');
    if(button)button.addEventListener('click',()=>goToStep(index));
  });
  if(!reduced&&'IntersectionObserver'in window){
    root.classList.add('pj-motion');
    const reveals=[...document.querySelectorAll('.pj-reveal')];
    const show=new IntersectionObserver(entries=>{
      entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('pj-in');show.unobserve(entry.target)}});
    },{threshold:.12});
    reveals.forEach(el=>show.observe(el));
  }
  const scrollUpdate=()=>{
    const max=Math.max(1,document.documentElement.scrollHeight-innerHeight);
    root.style.setProperty('--pj-scroll',((scrollY/max)*100).toFixed(2)+'%');
    const center=innerHeight*.5;
    let best=0,score=Infinity;
    chapters.forEach((el,i)=>{const rect=el.getBoundingClientRect();const d=Math.abs((rect.top+rect.bottom)/2-center);if(d<score){score=d;best=i}});
    const box=document.querySelector('.pj-journey').getBoundingClientRect();
    if(box.top<innerHeight*.85&&box.bottom>innerHeight*.15)select(best);
  };
  let scheduled=false;
  addEventListener('scroll',()=>{if(!scheduled){scheduled=true;requestAnimationFrame(()=>{scheduled=false;scrollUpdate()})}},{passive:true});
  addEventListener('resize',scrollUpdate,{passive:true});scrollUpdate();
  if(!reduced&&matchMedia('(hover:hover) and (pointer:fine)').matches){
    const glow=document.querySelector('.pj-ambient');
    if(glow){
      root.classList.add('pj-pointer');
      let pending=false,x=-600,y=-600;
      addEventListener('pointermove',ev=>{
        if(ev.pointerType!=='mouse')return;
        x=ev.clientX-260;y=ev.clientY-260;
        if(!pending){pending=true;requestAnimationFrame(()=>{pending=false;glow.style.setProperty('--pj-x',x+'px');glow.style.setProperty('--pj-y',y+'px')})}
      },{passive:true});
      addEventListener('pointerleave',()=>{glow.style.opacity='0'},{passive:true});
      addEventListener('pointerenter',()=>{glow.style.opacity='1'},{passive:true});
      const slip=document.getElementById('slip');
      if(slip){
        slip.addEventListener('pointermove',ev=>{
          const r=slip.getBoundingClientRect();const dx=(ev.clientX-r.left)/r.width-.5;const dy=(ev.clientY-r.top)/r.height-.5;
          slip.style.transform='perspective(900px) rotateY('+Math.max(-3,Math.min(3,dx*6)).toFixed(2)+'deg) rotateX('+Math.max(-3,Math.min(3,-dy*6)).toFixed(2)+'deg)';
        },{passive:true});
        slip.addEventListener('pointerleave',()=>{slip.style.transform='rotate(.25deg)'},{passive:true});
      }
    }
  }
})();

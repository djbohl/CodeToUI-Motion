// The demo renderer page: given a prototype model + a demo document, it plays the demo
// on a clock. Screens mount in same-origin srcdoc iframes (so their own CSS/JS run);
// transitions and captions are computed as a function of time so a `seek(t)` fully
// determines the visual state (deterministic for export). It exposes `window.__demo`:
//   duration() · time() · playing() · seek(ms) · play() · pause()
//
// Used two ways: live in the editor (an <iframe> the editor drives + polls for the
// playhead) and headless for export (Puppeteer steps it frame by frame — see captureDemo).

import { COMPOSE_SCREEN_FN } from "./compose-screen.js";

const RUNTIME = `
(function(){
  var DATA = window.__DEMO_DATA;
  var SCREENS=DATA.screens, GLOBAL=DATA.global, RT=DATA.rt, CLIPS=DATA.clips;
  var front, back, cap;
  var frontClip=null, backClip=null;
  var total=0, _t=0, _playing=false, _raf=null, _last=0;

  (function(){ var t=0; CLIPS.forEach(function(c){ c._start=t; t+=c.duration; c._end=t; }); total=t; })();

  function srcFor(c){
    return c.type==='screen'
      ? composeScreenSrcdoc(SCREENS, GLOBAL, RT, c.screen)
      : '<!doctype html><html><body style="margin:0;background:#fff"></body></html>';
  }
  function mountFront(c){ if(frontClip!==c.id){ front.srcdoc=srcFor(c); frontClip=c.id; } }
  function mountBack(c){ if(backClip!==c.id){ back.srcdoc=srcFor(c); backClip=c.id; } }

  function activeIndex(t){
    if(t<=0) return 0;
    for(var i=0;i<CLIPS.length;i++){ if(t<CLIPS[i]._end) return i; }
    return CLIPS.length-1;
  }
  function recompute(){ var t=0; CLIPS.forEach(function(c){ c._start=t; t+=c.duration; c._end=t; }); total=t; }
  // Incoming layer transform at progress p (0..1).
  function setTransform(el, type, p){
    var inv=1-p; el.style.opacity='1'; el.style.transform='none';
    if(type==='dissolve') el.style.opacity=String(p);
    else if(type==='slide-up') el.style.transform='translateY('+(inv*100)+'%)';
    else if(type==='slide-down') el.style.transform='translateY('+(-inv*100)+'%)';
    else if(type==='slide-left') el.style.transform='translateX('+(inv*100)+'%)';
    else if(type==='slide-right') el.style.transform='translateX('+(-inv*100)+'%)';
  }
  function renderCaptions(c, localT){
    var txt=''; (c.captions||[]).forEach(function(k){ if(localT>=k.at && localT<k.at+k['for']) txt=k.text; });
    if(txt){ cap.textContent=txt; cap.style.display='block'; } else { cap.style.display='none'; cap.textContent=''; }
  }
  function applyAt(t){
    if(!CLIPS.length){ front.removeAttribute('srcdoc'); back.style.display='none'; cap.style.display='none'; _t=0; return; }
    t=Math.max(0, Math.min(t, total)); _t=t;
    var i=activeIndex(t), c=CLIPS[i], localT=t-c._start;
    mountFront(c);
    var tr=c.transitionIn||{type:'instant',duration:0};
    var inTransition = i>0 && tr.duration>0 && tr.type!=='instant' && localT < tr.duration;
    if(inTransition){
      mountBack(CLIPS[i-1]);
      back.style.display='block'; back.style.opacity='1'; back.style.transform='none'; back.style.zIndex='1';
      front.style.zIndex='2';
      setTransform(front, tr.type, localT/tr.duration);
    } else {
      back.style.display='none';
      front.style.zIndex='2'; front.style.opacity='1'; front.style.transform='none';
    }
    renderCaptions(c, localT);
  }
  function tick(now){
    if(!_playing) return;
    _t += now-_last; _last=now;
    if(_t>=total){ applyAt(total); _playing=false; return; }
    applyAt(_t); _raf=requestAnimationFrame(tick);
  }
  function play(){ if(_playing) return; if(_t>=total) _t=0; _playing=true; _last=performance.now(); _raf=requestAnimationFrame(tick); }
  function pause(){ _playing=false; if(_raf) cancelAnimationFrame(_raf); }

  function init(){
    front=document.getElementById('front'); back=document.getElementById('back'); cap=document.getElementById('cap');
    window.__demo={
      duration:function(){return total;},
      time:function(){return _t;},
      playing:function(){return _playing;},
      seek:function(t){ pause(); applyAt(t); },
      play:play, pause:pause,
      // Live-update from the editor: swap in edited clips (and optionally resize the stage)
      // without reloading the page, then re-apply at the (clamped) current time.
      load:function(clips, size){
        pause(); CLIPS=clips||[]; recompute(); frontClip=null; backClip=null;
        if(size){ var st=document.querySelector('.stage'); st.style.width=size.width+'px'; st.style.height=size.height+'px'; }
        applyAt(Math.min(_t, total));
      }
    };
    applyAt(0);
  }
  if(document.readyState!=='loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
`;

/**
 * @param {import('./load-project.js').PrototypeModel} model
 * @param {import('./demo.js')} demo  a normalized demo document
 */
export function buildDemoHtml(model, demo) {
  const data = {
    screens: model.screens,
    global: model.global || "",
    rt: model.rt || null,
    clips: demo.clips,
    size: demo.size,
  };
  const dataJson = JSON.stringify(data).replace(/<\//g, "<\\/");
  const w = demo.size.width, h = demo.size.height;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Demo</title>
<style>
  html,body{margin:0;background:#0b0d11}
  .stage{position:relative;width:${w}px;height:${h}px;overflow:hidden;background:#fff}
  .stage iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff}
  #cap{position:absolute;left:50%;bottom:6%;transform:translateX(-50%);z-index:10;pointer-events:none;
    max-width:84%;padding:10px 16px;border-radius:8px;background:rgba(10,12,18,.82);color:#fff;
    font:500 16px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center;display:none}
</style></head><body>
<div class="stage">
  <iframe id="back"></iframe>
  <iframe id="front"></iframe>
  <div id="cap"></div>
</div>
<script>
window.__DEMO_DATA = ${dataJson};
${COMPOSE_SCREEN_FN}
${RUNTIME}
</script>
</body></html>`;
}

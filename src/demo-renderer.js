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
  var pickOn=false;
  var audioEls={}; // id -> { el:HTMLAudioElement, track, url }

  (function(){ var t=0; CLIPS.forEach(function(c){ c._start=t; t+=c.duration; c._end=t; }); total=t; })();

  function hEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function composeCanvasSrcdoc(clip){
    var body='', css='', seen={};
    // Inject each source screen's global + screen CSS once, so copied elements keep their
    // styling; then neutralize the body box so absolute positioning stays predictable.
    (clip.elements||[]).forEach(function(e){
      if(e.kind==='screenEl' && e.sourceScreen && !seen[e.sourceScreen]){
        seen[e.sourceScreen]=1; var sc=SCREENS[e.sourceScreen]||{};
        css+='<style>'+GLOBAL+'</style><style>'+(sc.css||'')+'</style>';
      }
    });
    css+='<style>html,body{margin:0!important;padding:0!important;background:#fff}</style>';
    (clip.elements||[]).forEach(function(e){
      var common='position:absolute;left:0;top:0;transform-origin:center center;';
      if(e.kind==='box'){
        body+='<div data-proto-id="'+e.elementId+'" style="'+common+'width:'+e.w+'px;height:'+e.h+'px;background:'+e.bg+';border-radius:'+e.radius+'px"></div>';
      } else if(e.kind==='screenEl'){
        body+='<div data-proto-id="'+e.elementId+'" style="'+common+'">'+(e.html||'')+'</div>';
      } else {
        body+='<div data-proto-id="'+e.elementId+'" style="'+common+'font:600 '+e.fontSize+'px/1.2 system-ui,sans-serif;color:'+e.color+';white-space:pre">'+hEsc(e.text)+'</div>';
      }
    });
    return '<!doctype html><html><head><meta charset="utf-8">'+css+'</head><body>'+body+'</body></html>';
  }
  function srcFor(c){
    return c.type==='canvas' ? composeCanvasSrcdoc(c) : composeScreenSrcdoc(SCREENS, GLOBAL, RT, c.screen);
  }
  function ovList(clip){ return (clip.type==='canvas' ? clip.elements : clip.overrides) || []; }
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

  // --- element overrides (M2a) ----------------------------------------------
  function ease(p, e){
    if(e==='linear') return p;
    if(e==='ease-in') return p*p;
    if(e==='ease-in-out') return p<0.5 ? 2*p*p : 1-Math.pow(-2*p+2,2)/2;
    return 1-(1-p)*(1-p); // ease-out (default)
  }
  // Rest transform + a time-parameterized entrance animation (deterministic for export).
  function ovStyle(o, localT){
    var base='translate('+o.x+'px,'+o.y+'px) scale('+o.scale+') rotate('+o.rotate+'deg)';
    var opacity='';
    if(o.animation){
      var a=o.animation, p;
      if(localT < a.delay) p=0; else if(localT < a.delay+a.duration) p=(localT-a.delay)/a.duration; else p=1;
      p=ease(p, a.easing);
      var pr=a.preset;
      if(pr==='fade') opacity=String(p);
      else if(pr==='pop'){ base+=' scale('+(0.6+0.4*p)+')'; opacity=String(p); }
      else if(pr==='scale') base+=' scale('+p+')';
      else if(pr==='slide-up') base+=' translateY('+((1-p)*48)+'px)';
      else if(pr==='slide-down') base+=' translateY('+(-(1-p)*48)+'px)';
      else if(pr==='slide-left') base+=' translateX('+((1-p)*48)+'px)';
      else if(pr==='slide-right') base+=' translateX('+(-(1-p)*48)+'px)';
    }
    return { transform: base, opacity: opacity };
  }
  // One-time per mount: inject custom CSS + run custom JS for a clip's overrides.
  function prep(iframe, clip){
    var doc; try{ doc=iframe.contentDocument; }catch(e){ return false; }
    if(!doc || !doc.body) return false;
    if(iframe.__c2pPrepped===clip.id) return true;
    iframe.__c2pPrepped=clip.id;
    var list=ovList(clip);
    var css=''; list.forEach(function(o){ if(o.css) css+='\\n'+o.css; });
    if(css){ var st=doc.createElement('style'); st.textContent=css; doc.head.appendChild(st); }
    list.forEach(function(o){
      if(!o.js) return;
      var el=doc.querySelector('[data-proto-id="'+o.elementId+'"]');
      try{ (new Function('el','document', o.js))(el, doc); }catch(e){}
    });
    return true;
  }
  // Element pick mode: when on, clicking an element in the active screen reports its
  // data-proto-id to the editor (same-origin) via window.__demoPickCb.
  function onPickClick(ev){
    if(!pickOn) return;
    var el=ev.target.closest && ev.target.closest('[data-proto-id]');
    if(el){ ev.preventDefault(); ev.stopPropagation(); if(window.__demoPickCb) window.__demoPickCb(el.getAttribute('data-proto-id')); }
  }
  function attachPick(iframe){
    var doc; try{ doc=iframe.contentDocument; }catch(e){ return; }
    if(!doc || !doc.body) return;
    if(!doc.__c2pPick){ doc.__c2pPick=true; doc.addEventListener('click', onPickClick, true); }
    doc.body.style.cursor = pickOn ? 'crosshair' : '';
  }
  function applyOverrides(iframe, clip, localT){
    if(!clip) return;
    var list=ovList(clip);
    if(!list.length) return;
    if(!prep(iframe, clip)) return;
    var doc=iframe.contentDocument;
    list.forEach(function(o){
      var el=doc.querySelector('[data-proto-id="'+o.elementId+'"]'); if(!el) return;
      if(o.hidden){ el.style.setProperty('display','none','important'); return; }
      el.style.removeProperty('display'); // un-hide: clear any display:none we set earlier
      var s=ovStyle(o, localT);
      el.style.setProperty('transform', s.transform, 'important');
      el.style.setProperty('transform-origin','center center');
      if(s.opacity!=='') el.style.setProperty('opacity', s.opacity, 'important');
    });
  }
  function applyAt(t){
    if(!CLIPS.length){ front.removeAttribute('srcdoc'); back.style.display='none'; cap.style.display='none'; _t=0; return; }
    t=Math.max(0, Math.min(t, total)); _t=t;
    var i=activeIndex(t), c=CLIPS[i], localT=t-c._start;
    mountFront(c);
    var tr=c.transitionIn||{type:'instant',duration:0};
    var inTransition = i>0 && tr.duration>0 && tr.type!=='instant' && localT < tr.duration;
    if(inTransition){
      var prev=CLIPS[i-1];
      mountBack(prev);
      back.style.display='block'; back.style.opacity='1'; back.style.transform='none'; back.style.zIndex='1';
      front.style.zIndex='2';
      setTransform(front, tr.type, localT/tr.duration);
      applyOverrides(back, prev, prev.duration); // outgoing clip settled at its end state
    } else {
      back.style.display='none';
      front.style.zIndex='2'; front.style.opacity='1'; front.style.transform='none';
    }
    applyOverrides(front, c, localT);
    attachPick(front);
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
      // Re-apply overrides at the current time WITHOUT remounting (the editor shares the
      // same clip objects by reference, so mutating x/y/scale/anim shows up immediately).
      refresh:function(){ applyAt(_t); },
      // Audio preview: tracks = [{id,url,start,volume,trimStart,trimEnd}]. Reuses existing
      // <audio> elements by url so edits don't re-fetch.
      setAudio:function(tracks){
        var next={};
        (tracks||[]).forEach(function(t){
          var o=audioEls[t.id];
          if(o && o.url===t.url){ o.track=t; next[t.id]=o; }
          else { if(o) o.el.pause(); var a=new Audio(t.url); a.preload='auto'; next[t.id]={el:a,track:t,url:t.url}; }
        });
        Object.keys(audioEls).forEach(function(k){ if(!next[k]) audioEls[k].el.pause(); });
        audioEls=next;
      },
      // Called every frame by the editor; only toggles play/pause at window boundaries so
      // it doesn't thrash currentTime mid-play.
      audioTick:function(t, playing){
        Object.keys(audioEls).forEach(function(k){
          var o=audioEls[k], tr=o.track, a=o.el;
          var local=t - tr.start;
          var srcLen = (a.duration && isFinite(a.duration)) ? a.duration*1000 : 1e9;
          var winLen = tr.trimEnd!=null ? (tr.trimEnd - tr.trimStart) : (srcLen - tr.trimStart);
          var inWin = local>=0 && local < winLen;
          a.volume = tr.volume!=null ? tr.volume : 1;
          if(playing && inWin){ if(a.paused){ try{ a.currentTime=(tr.trimStart+local)/1000; }catch(e){} var p=a.play(); if(p&&p.catch) p.catch(function(){}); } }
          else if(!a.paused){ a.pause(); }
        });
      },
      setPick:function(on){ pickOn=!!on; try{ if(front&&front.contentDocument&&front.contentDocument.body) front.contentDocument.body.style.cursor = pickOn?'crosshair':''; }catch(e){} },
      // Bounding box of an element in stage coordinates (the front iframe fills the
      // stage at 0,0), so the editor can draw a selection overlay over it.
      elementRect:function(id){
        try{ var doc=front.contentDocument; if(!doc) return null; var el=doc.querySelector('[data-proto-id="'+id+'"]'); if(!el) return null;
          var r=el.getBoundingClientRect(); return { x:r.left, y:r.top, w:r.width, h:r.height }; }catch(e){ return null; }
      },
      // Outer HTML of an element on the active screen (for copying it onto a canvas clip).
      elementHtml:function(id){
        try{ var doc=front.contentDocument; if(!doc) return null; var el=doc.querySelector('[data-proto-id="'+id+'"]'); return el?el.outerHTML:null; }catch(e){ return null; }
      },
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

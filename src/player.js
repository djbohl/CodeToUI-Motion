// The prototype player page we drive in Puppeteer.
//
// The navigation engine (STANDALONE_PLAYER) is adapted from CodeToUI Playground's
// src/export.js: same-origin iframes per screen, click wiring on
// [data-proto-id]/[data-goto], navigate/overlay modes, 180ms transitions, a
// history back-stack, and $back/$home sentinels. Two additions for capture:
//   1. a synthetic cursor + click-ripple + caption overlay in the top document;
//   2. a `window.__proto` driver hook so the capture loop can locate elements,
//      fire faithful clicks, place the cursor per frame, and know when a freshly
//      navigated screen has loaded.

const STANDALONE_PLAYER = `
(function(){
  var SCREENS=DATA.screens, GLOBAL=DATA.global, LINKS=DATA.links, START=DATA.start;
  var frame=document.getElementById('frame');
  var base=null, history=[], overlays=[];
  var loadSeq=0;

  // --- synthetic cursor / ripple / caption overlays (top document) ----------
  var cursor=document.createElement('div'); cursor.id='proto-cursor'; cursor.style.display='none';
  var ripple=document.createElement('div'); ripple.id='proto-ripple'; ripple.style.display='none';
  var caption=document.createElement('div'); caption.id='proto-caption'; caption.style.display='none';
  document.body.appendChild(cursor); document.body.appendChild(ripple); document.body.appendChild(caption);

  function mapFor(name){
    var m={};
    LINKS.forEach(function(l){ if(l.screen===name){ m[l.elementId]={target:l.target,mode:l.mode||'navigate',transition:l.transition||'instant'}; } });
    return m;
  }
  function esc(x){ return String(x||'').replace(/<\\/script/gi,'<\\\\/script'); }
  function srcdoc(name){
    var s=SCREENS[name]||{html:'',css:'',js:''};
    if(s.framework==='react' && DATA.rt){
      return '<!doctype html><html><head><meta charset="utf-8"><style>'+GLOBAL+'</style><style>'+(s.css||'')+'</style></head><body><div id="root"></div>'
        +'<scr'+'ipt>'+esc(DATA.rt.react)+'</scr'+'ipt><scr'+'ipt>'+esc(DATA.rt.reactDom)+'</scr'+'ipt><scr'+'ipt>'+esc(DATA.rt.babel)+'</scr'+'ipt>'
        +'<scr'+'ipt type="text/babel" data-presets="react">'+esc(s.jsx)+';(function(){var r=document.getElementById("root");try{if(typeof App!=="undefined")ReactDOM.createRoot(r).render(React.createElement(App));}catch(e){r.textContent=String(e);}})();</scr'+'ipt>'
        +'</body></html>';
    }
    var jsTag = s.js ? '<scr'+'ipt>'+esc(s.js)+'</scr'+'ipt>' : '';
    return '<!doctype html><html><head><meta charset="utf-8"><style>'+GLOBAL+'</style><style>'+(s.css||'')+'</style></head><body>'+s.html+jsTag+'</body></html>';
  }
  function startStyle(tr){
    if(tr==='dissolve') return {opacity:'0',transform:'none'};
    if(tr==='slide-left') return {opacity:'0',transform:'translateX(48px)'};
    if(tr==='slide-right') return {opacity:'0',transform:'translateX(-48px)'};
    if(tr==='slide-up') return {opacity:'0',transform:'translateY(48px)'};
    if(tr==='slide-down') return {opacity:'0',transform:'translateY(-48px)'};
    return {opacity:'1',transform:'none'};
  }
  function animateIn(f, tr){
    var s=startStyle(tr);
    f.style.transition='none'; f.style.opacity=s.opacity; f.style.transform=s.transform;
    f.addEventListener('load', function(){
      f.style.transition='opacity 180ms ease, transform 180ms ease';
      f.style.opacity='1'; f.style.transform='none';
    }, {once:true});
  }
  function wire(doc, name){
    var map=mapFor(name);
    Object.keys(map).forEach(function(id){
      var el=doc.querySelector('[data-proto-id="'+id+'"]'); if(el) el.style.cursor='pointer';
    });
    doc.querySelectorAll('[data-goto]').forEach(function(el){ el.style.cursor='pointer'; });
    doc.addEventListener('click', function(ev){
      var g=ev.target.closest?ev.target.closest('[data-goto]'):null;
      if(g){ ev.preventDefault(); nav(g.getAttribute('data-goto'), g.getAttribute('data-goto-mode')||'navigate', g.getAttribute('data-goto-transition')||'instant'); return; }
      var el=ev.target.closest?ev.target.closest('[data-proto-id]'):null;
      while(el){
        var id=el.getAttribute('data-proto-id');
        if(map[id]){ ev.preventDefault(); nav(map[id].target, map[id].mode, map[id].transition); return; }
        el=el.parentElement&&el.parentElement.closest?el.parentElement.closest('[data-proto-id]'):null;
      }
    }, true);
  }
  function renderBase(name, tr){
    base=name;
    frame.onload=function(){ loadSeq++; try{ wire(frame.contentDocument, name); }catch(e){} };
    animateIn(frame, tr||'instant');
    frame.srcdoc=srcdoc(name);
  }
  function openOverlay(name, tr){
    var ov=document.createElement('div'); ov.className='proto-ov';
    var f=document.createElement('iframe'); ov.appendChild(f);
    ov.addEventListener('click', function(e){ if(e.target===ov) closeTop(); });
    f.onload=function(){ loadSeq++; try{ wire(f.contentDocument, name); }catch(e){} };
    animateIn(f, (tr && tr!=='instant') ? tr : 'dissolve');
    document.body.appendChild(ov); overlays.push(ov); f.srcdoc=srcdoc(name);
  }
  function closeTop(){ var o=overlays.pop(); if(o) o.remove(); }
  function closeAll(){ overlays.forEach(function(o){ o.remove(); }); overlays=[]; }
  function nav(target, mode, tr){
    if(target==='$back'){ if(overlays.length) closeTop(); else if(history.length) renderBase(history.pop(),'dissolve'); return; }
    if(target==='$home'){ closeAll(); if(base&&base!==START) history.push(base); renderBase(START, tr); return; }
    if(mode==='overlay'){ openOverlay(target, tr); return; }
    closeAll(); if(base) history.push(base); renderBase(target, tr);
  }

  // --- driver hook: everything the capture loop needs, computed in-page ------
  function activeFrame(){ return overlays.length ? overlays[overlays.length-1].querySelector('iframe') : frame; }
  function activeDoc(){ try{ return activeFrame().contentDocument; }catch(e){ return null; } }
  function findEl(doc, id){ return doc.querySelector('[data-proto-id="'+id+'"]') || doc.querySelector('[data-goto="'+id+'"]'); }
  window.__proto={
    loadSeq:function(){ return loadSeq; },
    state:function(){ return { base:base, overlays:overlays.length, history:history.length }; },
    // Center point of a clickable element, in top-page coordinates, or null.
    rectFor:function(id){
      var doc=activeDoc(); if(!doc) return null;
      var el=findEl(doc,id); if(!el) return null;
      var fr=activeFrame().getBoundingClientRect(), r=el.getBoundingClientRect();
      return { x:fr.left+r.left+r.width/2, y:fr.top+r.top+r.height/2, w:r.width, h:r.height };
    },
    // Fire a real click so the player's own listener runs nav(). true if found.
    click:function(id){ var doc=activeDoc(); if(!doc) return false; var el=findEl(doc,id); if(!el) return false; el.click(); return true; },
    nav:nav,
    cursor:function(x,y,visible){
      if(visible===false){ cursor.style.display='none'; return; }
      cursor.style.display='block'; cursor.style.transform='translate('+x+'px,'+y+'px)';
    },
    // progress 0..1 draws an expanding, fading ring at x,y; <0 hides it.
    ripple:function(x,y,progress){
      if(progress==null||progress<0){ ripple.style.display='none'; return; }
      var size=10+progress*34;
      ripple.style.display='block';
      ripple.style.left=(x-size/2)+'px'; ripple.style.top=(y-size/2)+'px';
      ripple.style.width=size+'px'; ripple.style.height=size+'px';
      ripple.style.opacity=String(Math.max(0,0.5*(1-progress)));
    },
    caption:function(text){
      if(text==null||text===''){ caption.style.display='none'; caption.textContent=''; return; }
      caption.textContent=text; caption.style.display='block';
    }
  };

  renderBase(START, 'instant');
})();
`;

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/**
 * Build the player HTML page for a model.
 * @param {import('./load-project.js').PrototypeModel} model
 * @param {{ title?: string }} [opts]
 */
export function buildPlayerHtml(model, opts = {}) {
  const title = opts.title || "Prototype";
  const data = {
    screens: model.screens,
    global: model.global || "",
    links: model.links || [],
    start: model.start,
    rt: model.rt || null,
  };
  // Prevent any embedded "</..." from closing our <script>.
  const dataJson = JSON.stringify(data).replace(/<\//g, "<\\/");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  html,body{margin:0;height:100%;background:#0b0d11}
  #frame{border:0;width:100%;height:100%;display:block;background:#fff}
  .proto-ov{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);z-index:10}
  .proto-ov iframe{border:2px solid #333;width:90%;height:90%;max-width:1200px;background:#fff}
  #proto-cursor{position:fixed;left:0;top:0;width:22px;height:22px;z-index:9999;pointer-events:none;will-change:transform;
    background:no-repeat center/contain;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45));
    background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M4 2 L4 19 L9 14 L12.5 21 L15 20 L11.5 13 L18 13 Z' fill='white' stroke='black' stroke-width='1.3' stroke-linejoin='round'/></svg>")}
  #proto-ripple{position:fixed;z-index:9998;pointer-events:none;border-radius:50%;background:rgba(40,120,255,.35);box-shadow:0 0 0 2px rgba(40,120,255,.5)}
  #proto-caption{position:fixed;left:50%;bottom:6%;transform:translateX(-50%);z-index:9997;pointer-events:none;
    max-width:80%;padding:10px 16px;border-radius:10px;background:rgba(10,12,18,.82);color:#fff;
    font:500 16px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center}
</style></head><body>
<iframe id="frame" title="${escapeHtml(title)}"></iframe>
<script>
var DATA = ${dataJson};
${STANDALONE_PLAYER}
</script>
</body></html>`;
}

export { STANDALONE_PLAYER };

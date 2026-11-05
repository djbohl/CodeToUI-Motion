// Shared screen → srcdoc composer, as a string of browser JS that both the demo
// renderer (and, if it keeps its own copy, the player) inline into their embedded
// <script>. It composes one screen into a full self-contained document: global CSS +
// screen CSS + the screen's HTML and JS, or the React runtime + Babel mounting `App`.
// This mirrors CodeToUI's standalone-player `srcdoc()` so a screen renders the same
// way here as it does in CodeToUI. Because screens run in a same-origin srcdoc iframe,
// their own CSS animations and JS execute — that's what lets authored motion "just play".

export const COMPOSE_SCREEN_FN = `
function __esc(x){ return String(x||'').replace(/<\\/script/gi,'<\\\\/script'); }
function composeScreenSrcdoc(SCREENS, GLOBAL, RT, name){
  var s = SCREENS[name] || {html:'',css:'',js:''};
  if(s.framework==='react' && RT){
    return '<!doctype html><html><head><meta charset="utf-8"><style>'+GLOBAL+'</style><style>'+(s.css||'')+'</style></head><body><div id="root"></div>'
      +'<scr'+'ipt>'+__esc(RT.react)+'</scr'+'ipt><scr'+'ipt>'+__esc(RT.reactDom)+'</scr'+'ipt><scr'+'ipt>'+__esc(RT.babel)+'</scr'+'ipt>'
      +'<scr'+'ipt type="text/babel" data-presets="react">'+__esc(s.jsx)+';(function(){var r=document.getElementById("root");try{if(typeof App!=="undefined")ReactDOM.createRoot(r).render(React.createElement(App));}catch(e){r.textContent=String(e);}})();</scr'+'ipt>'
      +'</body></html>';
  }
  var jsTag = s.js ? '<scr'+'ipt>'+__esc(s.js)+'</scr'+'ipt>' : '';
  return '<!doctype html><html><head><meta charset="utf-8"><style>'+GLOBAL+'</style><style>'+(s.css||'')+'</style></head><body>'+s.html+jsTag+'</body></html>';
}
`;

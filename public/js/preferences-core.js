/* Shared by the browser and API: bounded, account-only workspace preferences. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KlyoPreferences = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const NAV = ['overview','pipeline','companies','deals','quotes','products','clients','tasks','calendar','reminders','files','history','team'];
  const COLUMNS = ['name','contact','company','theme','stage','owner','tags'];
  const WIDGETS = ['metrics','stages','losses'];
  const PRESETS = {
    day: { name:'Day', background:'#edf1f7', surface:'#ffffff', accent:'#2563eb', sidebar:'#172238' },
    graphite: { name:'Graphite', background:'#141923', surface:'#1d2532', accent:'#6b9cff', sidebar:'#0f141d' },
    midnight: { name:'Midnight', background:'#0c0d10', surface:'#17191f', accent:'#c7baff', sidebar:'#0c0d10' },
    ocean: { name:'Ocean', background:'#081d27', surface:'#102e3b', accent:'#4cdbcf', sidebar:'#071720' },
    forest: { name:'Forest', background:'#101e19', surface:'#1b3027', accent:'#85e5ac', sidebar:'#0b1712' },
    contrast: { name:'Contrast', background:'#000000', surface:'#101010', accent:'#ffff00', sidebar:'#000000' },
  };
  const LEGACY = {blanc:'day',office:'day',pearl:'day',sand:'day',dawn:'day',noir:'midnight',signal:'graphite',slate:'graphite',cobalt:'graphite',arctic:'ocean',meadow:'forest',forest:'forest',midnight:'midnight',nebula:'midnight',ember:'midnight'};
  const clone = value => JSON.parse(JSON.stringify(value));
  function defaults(theme) {
    return {version:1,palette:{preset:(PRESETS[theme]||theme==='custom')?theme:LEGACY[theme]||'graphite',custom:{background:'#141923',surface:'#1d2532',accent:'#6b9cff',sidebar:'#0f141d',text:'#f4f7fc'},text_mode:'auto',high_contrast:false},layout:{density:'compact',sidebar:'left',collapsed:false,start_view:'pipeline',nav_order:[...NAV],hidden_nav:[],contact_columns:[...COLUMNS],hidden_columns:[],summary_visible:true,summary_position:'above',overview_order:[...WIDGETS],hidden_widgets:[],overview_layout:'split'}};
  }
  function normalize(input, strict = false, legacyTheme) {
    const fail = message => { if(strict)throw Object.assign(new Error(message),{status:400}); };
    if(input == null)input={};
    if(typeof input!=='object'||Array.isArray(input)){fail('Invalid workspace preferences.');input={};}
    if(JSON.stringify(input).length>20000)throw Object.assign(new Error('Workspace preferences are too large.'),{status:400});
    const out=defaults(legacyTheme);
    const object=(value,name)=>{if(value==null)return{};if(typeof value!=='object'||Array.isArray(value)){fail(`Invalid ${name}.`);return{};}return value;};
    const palette=object(input.palette,'palette'),layout=object(input.layout,'layout'),custom=object(palette.custom,'custom colors');
    const choice=(value,values,fallback,name)=>{if(value===undefined)return fallback;if(values.includes(value))return value;fail(`Invalid ${name}.`);return fallback;};
    const bool=(value,fallback,name)=>{if(value===undefined)return fallback;if(typeof value==='boolean')return value;fail(`Invalid ${name}.`);return fallback;};
    const list=(value,allowed,fallback,name,complete)=>{
      if(value===undefined)return [...fallback];
      if(!Array.isArray(value)||value.length>allowed.length||value.some(v=>!allowed.includes(v))||new Set(value).size!==value.length){fail(`Invalid ${name}.`);return [...fallback];}
      return complete?[...value,...allowed.filter(v=>!value.includes(v))]:[...value];
    };
    out.palette.preset=choice(palette.preset,[...Object.keys(PRESETS),'custom'],out.palette.preset,'color preset');
    out.palette.text_mode=choice(palette.text_mode,['auto','manual'],'auto','text color mode');
    out.palette.high_contrast=bool(palette.high_contrast,false,'contrast');
    for(const key of Object.keys(out.palette.custom))if(custom[key]!==undefined){if(typeof custom[key]==='string'&&/^#[a-f\d]{6}$/i.test(custom[key]))out.palette.custom[key]=custom[key].toLowerCase();else fail(`Invalid ${key} color.`);}
    out.layout.density=choice(layout.density,['compact','standard','comfortable'],'compact','density');
    out.layout.sidebar=choice(layout.sidebar,['left','right'],'left','sidebar position');
    out.layout.collapsed=bool(layout.collapsed,false,'sidebar width');
    out.layout.start_view=choice(layout.start_view,NAV,'pipeline','start page');
    out.layout.nav_order=list(layout.nav_order,NAV,NAV,'menu order',true);
    out.layout.hidden_nav=list(layout.hidden_nav,NAV,[],'hidden menu items',false);
    if(out.layout.hidden_nav.length===NAV.length){fail('Keep at least one menu item visible.');out.layout.hidden_nav=[];}
    if(out.layout.hidden_nav.includes(out.layout.start_view))out.layout.start_view=out.layout.nav_order.find(key=>!out.layout.hidden_nav.includes(key));
    out.layout.contact_columns=list(layout.contact_columns,COLUMNS,COLUMNS,'contact columns',true);
    out.layout.hidden_columns=list(layout.hidden_columns,COLUMNS.filter(k=>k!=='name'),[],'hidden columns',false);
    out.layout.summary_visible=bool(layout.summary_visible,true,'contact summary');
    out.layout.summary_position=choice(layout.summary_position,['above','below'],'above','summary position');
    out.layout.overview_order=list(layout.overview_order,WIDGETS,WIDGETS,'overview order',true);
    out.layout.hidden_widgets=list(layout.hidden_widgets,WIDGETS,[],'hidden widgets',false);
    if(out.layout.hidden_widgets.length===WIDGETS.length){fail('Keep at least one overview widget visible.');out.layout.hidden_widgets=[];}
    out.layout.overview_layout=choice(layout.overview_layout,['split','stacked'],'split','overview layout');
    return out;
  }
  const rgb = hex => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
  const luminance = hex => rgb(hex).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  const foreground=background=>{const preferred=contrast(background,'#f7f9fc')>=contrast(background,'#111827')?'#f7f9fc':'#111827';return contrast(background,preferred)>=4.5?preferred:(contrast(background,'#ffffff')>=contrast(background,'#000000')?'#ffffff':'#000000');};
  const mix=(a,b,amount)=>{const x=rgb(a),y=rgb(b);return '#'+x.map((v,i)=>Math.round(v*(1-amount)+y[i]*amount).toString(16).padStart(2,'0')).join('');};
  function tokens(palette) {
    const p=palette.preset==='custom'?palette.custom:PRESETS[palette.preset]||PRESETS.graphite;
    const text=palette.text_mode==='manual'?palette.custom.text:foreground(p.background), panelText=palette.text_mode==='manual'?palette.custom.text:foreground(p.surface), navText=foreground(p.sidebar);
    const amount=palette.high_contrast ? .08 : .23;
    const dark=luminance(p.surface)<.25;
    return {'--bg':p.background,'--bg-glow':p.background,'--bg-soft':mix(p.surface,panelText,.045),'--surface':p.surface,'--surface-2':mix(p.surface,panelText,.08),'--topbar-bg':p.surface,'--text':text,'--text-dim':mix(text,p.background,amount),'--text-faint':mix(text,p.background,amount+.06),'--panel-text':panelText,'--panel-dim':mix(panelText,p.surface,amount),'--panel-muted':mix(panelText,p.surface,amount+.06),'--border':mix(p.surface,panelText,palette.high_contrast ? .55 : .23),'--border-soft':mix(p.surface,panelText,palette.high_contrast ? .35 : .12),'--accent-1':p.accent,'--accent-2':p.accent,'--signal':p.accent,'--on-accent':foreground(p.accent),'--nav-bg':p.sidebar,'--nav-text':navText,'--nav-muted':mix(navText,p.sidebar,.30),'--nav-active':mix(p.sidebar,navText,.13),'--nav-border':mix(p.sidebar,navText,.18),'--lead':dark?'#93b4ff':'#2c559b','--contacted':mix(panelText,p.surface,.15),'--negotiating':dark?'#f5c56a':'#865900','--customer':dark?'#82e3ad':'#1b7049','--lost':dark?'#ff9cab':'#a82843','--danger':dark?'#ff9cab':'#a82843'};
  }
  return {NAV,COLUMNS,WIDGETS,PRESETS,LEGACY,clone,defaults,normalize,tokens,contrast,foreground,mix};
});

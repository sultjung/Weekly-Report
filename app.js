(()=>{
  const S={articles:[],filtered:[],selected:new Map(),filter:'all'};
  const $=id=>document.getElementById(id);
  const KEY='weekly-report-selected-v3';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const score=a=>Number(a.relevanceScore??a.importanceScore??a.score??0);
  const key=a=>a.id||a.url||`${a.titleKo||a.title}-${a.publishedAt}`;
  const text=a=>[a.titleKo,a.title,a.translatedTitle,a.summaryKo,a.translatedBody,a.fullTranslation,a.description,a.source,a.weeklyReportReason,a.category1,a.category2,a.category3,a.queryGroup,a.collectionLane].filter(Boolean).join(' ');
  const body=a=>a.translatedBody||a.fullTranslation||a.translationKo||a.summaryKo||a.description||'';
  const title=a=>a.translatedTitle||a.titleKo||a.title||'제목 없음';
  const date=a=>{
    const d=new Date(a.publishedAt||a.date||0);
    return isNaN(d)?'-':new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(d);
  };

  function isDomesticMedia(a){
    return String(a.queryGroup||'')==='korean_domestic_media';
  }

  function categoryOf(a){
    if(isDomesticMedia(a))return'domestic';
    const c=String(a.category3||a.forcedCategory3||'').toLowerCase();
    if(c==='politics')return'politics';
    if(c==='oil_economy'||c==='economy')return'economy';
    if(c==='terror_security'||c==='security')return'security';
    if(c==='regional'||c==='international')return'international';

    const t=text(a).toLowerCase();
    if(/테러|치안|안보|군사|군대|미사일|드론|폭발|공습|민병대|isis|is\b|security|terror|military|أمن|ارهاب|إرهاب|جيش|قصف|ميليشيا/.test(t))return'security';
    if(/경제|석유|원유|유가|가스|예산|투자|무역|환율|재정|은행|oil|economy|gas|budget|trade|investment|نفط|اقتصاد|غاز|موازنة|استثمار/.test(t))return'economy';
    if(/총리|내각|장관|의회|정부|정당|선거|정국|법안|prime minister|cabinet|minister|parliament|government|election|رئيس الوزراء|مجلس الوزراء|وزير|البرلمان|الحكومة|انتخابات/.test(t))return'politics';
    return'international';
  }

  function loadSel(){
    try{for(const a of JSON.parse(localStorage.getItem(KEY)||'[]'))S.selected.set(key(a),a)}catch{}
  }
  function save(){localStorage.setItem(KEY,JSON.stringify([...S.selected.values()]));stats()}
  function payload(){
    return{selectionVersion:'2026-07-v1',generatedAt:new Date().toISOString(),purpose:'iraq-weekly-report-selected-news',count:S.selected.size,articles:[...S.selected.values()].sort((a,b)=>new Date(a.publishedAt||0)-new Date(b.publishedAt||0))};
  }
  function stats(){
    const A=S.articles;
    $('statTotal').textContent=A.length;
    $('statDomestic').textContent=A.filter(a=>categoryOf(a)==='domestic').length;
    $('statPolitics').textContent=A.filter(a=>categoryOf(a)==='politics').length;
    $('statEconomy').textContent=A.filter(a=>categoryOf(a)==='economy').length;
    $('statSecurity').textContent=A.filter(a=>categoryOf(a)==='security').length;
    $('statInternational').textContent=A.filter(a=>categoryOf(a)==='international').length;
    $('statSelected').textContent=S.selected.size;
  }
  function apply(){
    const days=$('periodFilter').value,min=+$('scoreFilter').value,q=$('searchInput').value.trim().toLowerCase();
    const cutoff=new Date();
    if(days!=='all')cutoff.setDate(cutoff.getDate()-Number(days));
    S.filtered=S.articles.filter(a=>{
      const d=new Date(a.publishedAt||0);
      if(days!=='all'&&!isNaN(d)&&d<cutoff)return false;
      if(score(a)<min)return false;
      if(q&&!text(a).toLowerCase().includes(q))return false;
      if(['domestic','politics','economy','security','international'].includes(S.filter)&&categoryOf(a)!==S.filter)return false;
      if(S.filter==='selected'&&!S.selected.has(key(a)))return false;
      return true;
    }).sort((a,b)=>$('sortFilter').value==='latest'?new Date(b.publishedAt||0)-new Date(a.publishedAt||0):score(b)-score(a));
    render();
  }
  function scoreClass(n){return n>=90?'s90':n>=80?'s80':n>=70?'s70':''}
  function categoryLabel(c){return{domestic:'국내 언론',politics:'정치',economy:'경제',security:'안보',international:'국제사회'}[c]||'검토'}
  function render(){
    const n=$('newsList');
    $('visibleCount').textContent=`${S.filtered.length}건 표시`;
    if(!S.filtered.length){n.className='news-list empty';n.textContent='조건에 맞는 기사가 없습니다.';return}
    n.className='news-list';
    n.innerHTML=S.filtered.map(a=>{
      const k=key(a),sel=S.selected.has(k),b=body(a),reason=a.relevanceReason||a.weeklyReportReason||a.scoreReason||'',category=categoryOf(a);
      return `<article class="news-card ${sel?'selected':''}" data-key="${esc(k)}"><div class="news-top"><div class="meta"><span>${esc(a.source||'-')}</span><span>${esc(date(a))}</span><span class="score ${scoreClass(score(a))}">관련성 ${score(a)}점</span></div><button class="select-btn ${sel?'on':''}" data-action="select">${sel?'선택됨':'보고서에 선택'}</button></div><h3>${esc(title(a))}</h3><p class="preview">${esc(b)}</p>${b?`<div class="fulltext">${esc(b)}</div>`:''}<div class="tags"><span class="tag category-${category}">${categoryLabel(category)}</span>${a.category3?`<span class="tag">${esc(a.category3)}</span>`:''}</div>${reason?`<p class="hint"><b>점수 근거</b> ${esc(reason)}</p>`:''}<div class="card-actions">${b?'<button data-action="expand">전체 번역 보기</button>':''}${a.url?`<a href="${esc(a.url)}" target="_blank" rel="noopener">원문 보기</a>`:''}</div></article>`;
    }).join('');
  }
  async function init(){
    loadSel();
    try{
      const r=await fetch(`./data/news.json?v=${Date.now()}`,{cache:'no-store'});
      const d=await r.json();
      S.articles=Array.isArray(d)?d:(d.articles||d.items||[]);
      stats();apply();
    }catch(e){
      $('newsList').className='news-list empty';
      $('newsList').textContent=`뉴스 데이터를 불러오지 못했습니다: ${e.message}`;
    }
  }
  document.addEventListener('click',e=>{
    const card=e.target.closest('.news-card');
    if(e.target.closest('.stat-card')){
      S.filter=e.target.closest('.stat-card').dataset.statFilter;
      document.querySelectorAll('.stat-card').forEach(x=>x.classList.toggle('active',x.dataset.statFilter===S.filter));
      apply();return;
    }
    if(card&&e.target.dataset.action==='expand'){
      card.classList.toggle('open');
      e.target.textContent=card.classList.contains('open')?'번역 접기':'전체 번역 보기';
    }
    if(card&&e.target.dataset.action==='select'){
      const a=S.articles.find(x=>key(x)===card.dataset.key);
      if(!a)return;
      S.selected.has(card.dataset.key)?S.selected.delete(card.dataset.key):S.selected.set(card.dataset.key,{...a,selected:true});
      save();apply();
    }
  });
  ['periodFilter','scoreFilter','sortFilter'].forEach(id=>$(id).addEventListener('change',apply));
  $('searchInput').addEventListener('input',apply);
  $('resetFilters').onclick=()=>{
    $('periodFilter').value='7';$('scoreFilter').value='70';$('sortFilter').value='score';$('searchInput').value='';S.filter='all';
    document.querySelectorAll('.stat-card').forEach(x=>x.classList.toggle('active',x.dataset.statFilter==='all'));apply();
  };
  $('clearSelection').onclick=()=>{if(confirm('선택 기사를 모두 초기화할까요?')){S.selected.clear();save();apply()}};
  $('downloadSelection').onclick=()=>{
    if(!S.selected.size)return alert('먼저 기사를 선택해주세요.');
    const blob=new Blob([JSON.stringify(payload(),null,2)],{type:'application/json'}),a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download='selected-news.json';a.click();URL.revokeObjectURL(a.href);
  };
  $('generateReport').onclick=()=>{
    if(!S.selected.size)return alert('먼저 기사를 선택하고 JSON을 저장해주세요.');
    window.open('https://github.com/sultjung/Weekly-Report/actions/workflows/generate-weekly-report.yml','_blank','noopener');
  };
  init();
})();
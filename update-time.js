(()=>{
  const target=document.getElementById('updatedAt');
  if(!target)return;

  let correctText='-';

  const formatKst=value=>{
    const parsed=new Date(value);
    if(Number.isNaN(parsed.getTime()))return '-';
    return new Intl.DateTimeFormat('ko-KR',{
      timeZone:'Asia/Seoul',
      year:'numeric',
      month:'2-digit',
      day:'2-digit',
      hour:'2-digit',
      minute:'2-digit',
      hour12:false
    }).format(parsed);
  };

  const enforceCorrectTime=()=>{
    if(correctText!=='-'&&target.textContent!==correctText){
      target.textContent=correctText;
    }
  };

  const observer=new MutationObserver(enforceCorrectTime);
  observer.observe(target,{childList:true,characterData:true,subtree:true});

  fetch(`./data/news.json?v=${Date.now()}`,{cache:'no-store'})
    .then(response=>{
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(data=>{
      const updatedAt=data.updatedAt||data.generatedAt;
      correctText=updatedAt?formatKst(updatedAt):'-';
      enforceCorrectTime();
    })
    .catch(()=>{
      correctText='-';
      target.textContent='-';
    });
})();
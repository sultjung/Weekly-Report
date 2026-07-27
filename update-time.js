(()=>{
  const target=document.getElementById('updatedAt');
  if(!target)return;

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

  fetch(`./data/news.json?v=${Date.now()}`,{cache:'no-store'})
    .then(response=>{
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(data=>{
      const updatedAt=data.updatedAt||data.generatedAt;
      target.textContent=updatedAt?formatKst(updatedAt):'-';
    })
    .catch(()=>{
      target.textContent='-';
    });
})();

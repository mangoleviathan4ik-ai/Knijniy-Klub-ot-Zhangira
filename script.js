(function(){
  // ---------------------------------------------------------------
  // Personal storage: tries Claude's storage API (works when this
  // page runs inside a Claude artifact), falls back to localStorage
  // so nickname / device id / "my vote" still survive closing the
  // tab when the site is opened as plain files.
  // ---------------------------------------------------------------
  const hasCloudStorage = (typeof window.storage !== 'undefined') && !!window.storage;

  function lsKey(key){ return 'anella:personal:' + key; }

  async function storeGet(key){
    if(hasCloudStorage){
      try{
        const res = await window.storage.get(key, false);
        return (res && typeof res.value !== 'undefined') ? res.value : null;
      }catch(err){ return null; }
    }
    try{ return localStorage.getItem(lsKey(key)); }catch(err){ return null; }
  }

  async function storeSet(key, value){
    if(hasCloudStorage){
      try{ await window.storage.set(key, value, false); return true; }
      catch(err){ console.error('Ошибка облачного хранилища:', err); }
    }
    try{ localStorage.setItem(lsKey(key), value); return true; }
    catch(err){ console.error('Ошибка локального хранилища:', err); return false; }
  }

  // ---------------------------------------------------------------
  // Shared cloud data for THIS club lives in the same JSONBin used by
  // the other project, but nested under its own "anella" key so the
  // two clubs' books/votes/ratings never mix.
  // ---------------------------------------------------------------
  const JSONBIN_ID = '6a6ef762da38895dfeaeed5f';
  const JSONBIN_KEY = '$2a$10$.um2lc2kHdWRX5UfCxDtj.egJaqqOB4rniH4eGh.0AApsyxuYJnp2';
  const JSONBIN_BASE = 'https://api.jsonbin.io/v3/b/' + JSONBIN_ID;

  function emptyClubData(){
    return { books: [], bookRatings: {}, extraRatingBooks: [] };
  }

  async function jsonbinReadClub(){
    try{
      const resp = await fetch(JSONBIN_BASE + '/latest', {
        method:'GET',
        headers:{ 'X-Master-Key': JSONBIN_KEY }
      });
      if(!resp.ok) throw new Error('jsonbin read failed: ' + resp.status);
      const data = await resp.json();
      const record = (data && data.record) ? data.record : {};
      const club = (record.anella && typeof record.anella === 'object') ? record.anella : {};
      return {
        books: Array.isArray(club.books) ? club.books : [],
        bookRatings: (club.bookRatings && typeof club.bookRatings === 'object') ? club.bookRatings : {},
        extraRatingBooks: Array.isArray(club.extraRatingBooks) ? club.extraRatingBooks : []
      };
    }catch(err){
      console.error('Не удалось прочитать данные клуба:', err);
      return emptyClubData();
    }
  }

  // Reads the FULL bin (both clubs), replaces only the "anella" branch,
  // and writes the whole thing back so the other club's data survives.
  async function jsonbinWriteClub(clubData){
    try{
      const getResp = await fetch(JSONBIN_BASE + '/latest', {
        method:'GET',
        headers:{ 'X-Master-Key': JSONBIN_KEY }
      });
      let fullRecord = {};
      if(getResp.ok){
        const data = await getResp.json();
        fullRecord = (data && data.record) ? data.record : {};
      }
      fullRecord.anella = clubData;
      const putResp = await fetch(JSONBIN_BASE, {
        method:'PUT',
        headers:{ 'Content-Type':'application/json', 'X-Master-Key': JSONBIN_KEY },
        body: JSON.stringify(fullRecord)
      });
      if(!putResp.ok) throw new Error('jsonbin write failed: ' + putResp.status);
      return true;
    }catch(err){
      console.error('Не удалось сохранить данные клуба:', err);
      return false;
    }
  }

  // ---------------------------------------------------------------

  const stormHero = document.getElementById('stormHero');
  const stormParticles = document.getElementById('stormParticles');
  const hall = document.getElementById('hall');
  const nameModal = document.getElementById('nameModal');
  const nameInput = document.getElementById('nameInput');
  const saveNameBtn = document.getElementById('saveNameBtn');
  const greetingCard = document.getElementById('greetingCard');
  const greetName = document.getElementById('greetName');
  const changeNameBtn = document.getElementById('changeNameBtn');

  const bookInput = document.getElementById('bookInput');
  const searchBtn = document.getElementById('searchBtn');
  const skipBtn = document.getElementById('skipBtn');
  const searchStatus = document.getElementById('searchStatus');
  const bookResult = document.getElementById('bookResult');
  const bookCover = document.getElementById('bookCover');
  const bookTitle = document.getElementById('bookTitle');
  const bookAuthor = document.getElementById('bookAuthor');
  const bookYear = document.getElementById('bookYear');
  const addRow = document.getElementById('addRow');
  const addToVoteBtn = document.getElementById('addToVoteBtn');

  const votingSummary = document.getElementById('votingSummary');
  const openVotingBtn = document.getElementById('openVotingBtn');
  const votingModal = document.getElementById('votingModal');
  const closeVotingBtn = document.getElementById('closeVotingBtn');
  const bookList = document.getElementById('bookList');
  const emptyNote = document.getElementById('emptyNote');
  const declareBtn = document.getElementById('declareBtn');
  const winnerCard = document.getElementById('winnerCard');
  const winnerCover = document.getElementById('winnerCover');
  const winnerTitle = document.getElementById('winnerTitle');
  const winnerVotes = document.getElementById('winnerVotes');
  const storageNote = document.getElementById('storageNote');

  const ratingList = document.getElementById('ratingList');
  const newRatingBookInput = document.getElementById('newRatingBookInput');
  const addRatingBookBtn = document.getElementById('addRatingBookBtn');

  let currentFoundBook = null;
  let myVoteId = null;
  let myUserId = null;
  let votingBusy = false;

  storageNote.textContent = 'Список книг, голоса и оценки хранятся в общем облаке и видны всем участникам клуба на любых устройствах.';

  const STATIC_BOOKS = [
    { id:'ab01', title:'Дюна' },
    { id:'ab02', title:'Белые флаги' },
    { id:'ab03', title:'Правда о деле Гарри Квеберта' },
    { id:'ab04', title:'Шёпот теней' },
    { id:'ab05', title:'В ожидании Кайроса' },
    { id:'ab06', title:'Две жизни' },
    { id:'ab07', title:'Море споёт колыбельную' },
    { id:'ab08', title:'Дозоры' },
    { id:'ab09', title:'Пикник на обочине' }
  ];

  // ---------- Desert scene: stars + day/night cycle every 20 minutes ----------
  function scatterStars(){
    const starsWrap = document.getElementById('stars');
    const count = 70;
    for(let i=0;i<count;i++){
      const s = document.createElement('div');
      s.className = 'star';
      s.style.left = (Math.random()*100) + '%';
      s.style.top = (Math.random()*85) + '%';
      s.style.animationDelay = (Math.random()*3) + 's';
      starsWrap.appendChild(s);
    }
  }
  scatterStars();

  function toggleDayNight(){
    document.body.classList.toggle('night-mode');
  }
  setInterval(toggleDayNight, 20 * 60 * 1000); // every 20 minutes

  // ---------- Sandstorm intro ----------
  function spawnStormParticles(){
    const count = 46;
    for(let i=0;i<count;i++){
      const p = document.createElement('div');
      p.className = 'sand-particle';
      const startX = Math.random()*100;
      const startY = Math.random()*100;
      const angle = Math.random()*Math.PI*2;
      const dist = 300 + Math.random()*500;
      const tx = Math.cos(angle)*dist;
      const ty = Math.sin(angle)*dist - 120;
      p.style.left = startX + '%';
      p.style.top = startY + '%';
      p.style.setProperty('--tx', tx + 'px');
      p.style.setProperty('--ty', ty + 'px');
      p.style.setProperty('--rot', (Math.random()*540 - 270) + 'deg');
      p.style.animationDelay = (Math.random()*0.25) + 's';
      stormParticles.appendChild(p);
    }
  }
  spawnStormParticles();

  function dispelStorm(){
    if(stormHero.classList.contains('dispersing')) return;
    stormHero.classList.add('dispersing');
    setTimeout(()=>{
      stormHero.classList.add('hidden');
      hall.classList.add('visible');
      initAfterEntry();
    }, 1350);
  }
  stormHero.addEventListener('click', dispelStorm);

  async function initAfterEntry(){
    try{ await loadNickname(); }catch(e){ console.error(e); }
    try{ await getMyUserId(); }catch(e){ console.error(e); }
    try{ await loadMyVote(); }catch(e){ console.error(e); }
    try{ await refreshVotingUI(); }catch(e){ console.error(e); }
    try{ await renderRatingsFull(); }catch(e){ console.error(e); }

    setInterval(()=> refreshVotingUI().catch(()=>{}), 7000);
    setInterval(()=> renderRatingsFull().catch(()=>{}), 7000);
  }

  // ---------- Stable identity ----------
  async function getMyUserId(){
    if(myUserId) return myUserId;
    const existing = await storeGet('user_id');
    if(existing){
      myUserId = existing;
    } else {
      myUserId = 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,10);
      await storeSet('user_id', myUserId);
    }
    return myUserId;
  }

  // ---------- Nickname ----------
  async function loadNickname(){
    const name = await storeGet('nickname');
    if(name){
      showGreeting(name);
    } else {
      nameModal.classList.add('show');
    }
  }

  function showGreeting(name){
    greetName.textContent = name;
    greetingCard.style.display = 'block';
    nameModal.classList.remove('show');
  }

  saveNameBtn.addEventListener('click', async ()=>{
    const val = nameInput.value.trim();
    if(!val) return;
    await storeSet('nickname', val);
    showGreeting(val);
  });
  nameInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') saveNameBtn.click(); });

  changeNameBtn.addEventListener('click', ()=>{
    nameInput.value = '';
    nameModal.classList.add('show');
  });

  // ---------- Book search (Open Library) ----------
  searchBtn.addEventListener('click', doSearch);
  bookInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') doSearch(); });
  skipBtn.addEventListener('click', ()=>{
    bookInput.value='';
    bookResult.style.display='none';
    addRow.style.display='none';
    searchStatus.style.display='block';
    searchStatus.textContent = 'Ты пропустил этот шаг.';
  });

  async function doSearch(){
    const q = bookInput.value.trim();
    if(!q) return;
    searchStatus.style.display='block';
    searchStatus.textContent = 'Идёт поиск в каталогах...';
    bookResult.style.display='none';
    addRow.style.display='none';
    currentFoundBook = null;

    try{
      const resp = await fetch('https://openlibrary.org/search.json?title=' + encodeURIComponent(q) + '&limit=1');
      if(!resp.ok) throw new Error('network');
      const data = await resp.json();
      const doc = data.docs && data.docs[0];
      if(!doc){
        searchStatus.textContent = 'Такая книга не нашлась. Попробуй иначе или пропусти шаг.';
        return;
      }
      const title = doc.title || q;
      const author = (doc.author_name && doc.author_name.join(', ')) || 'автор неизвестен';
      const year = doc.first_publish_year ? ('первое издание: ' + doc.first_publish_year) : '';
      const cover = doc.cover_i ? ('https://covers.openlibrary.org/b/id/' + doc.cover_i + '-M.jpg') : '';

      currentFoundBook = { title, author, year, cover };
      searchStatus.style.display='none';
      bookTitle.textContent = title;
      bookAuthor.textContent = author;
      bookYear.textContent = year;
      bookCover.src = cover || '';
      bookCover.style.display = cover ? 'block' : 'none';
      bookResult.style.display = 'flex';
      addRow.style.display = 'flex';
      addToVoteBtn.disabled = false;
      addToVoteBtn.textContent = 'Внести в список голосования';
    }catch(err){
      searchStatus.textContent = 'Каталог сейчас недоступен. Впиши книгу от руки — она всё равно попадёт в список.';
      currentFoundBook = { title: q, author: '', year: '', cover: '' };
      addRow.style.display = 'flex';
      addToVoteBtn.disabled = false;
      addToVoteBtn.textContent = 'Внести в список голосования';
    }
  }

  // ---------- Shared voting ----------
  addToVoteBtn.addEventListener('click', async ()=>{
    if(!currentFoundBook || addToVoteBtn.disabled) return;
    addToVoteBtn.disabled = true;
    const club = await jsonbinReadClub();
    const exists = club.books.find(b => b.title.trim().toLowerCase() === currentFoundBook.title.trim().toLowerCase());
    if(!exists){
      club.books.push({
        id: 'b_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
        title: currentFoundBook.title,
        author: currentFoundBook.author,
        cover: currentFoundBook.cover,
        votes: 0,
        voters: []
      });
      await jsonbinWriteClub(club);
    }
    addToVoteBtn.textContent = 'Уже внесена в список';
    await refreshVotingUI();
  });

  async function castVote(bookId){
    if(votingBusy) return;
    votingBusy = true;
    setVoteButtonsDisabled(true);
    try{
      const uid = await getMyUserId();
      const club = await jsonbinReadClub();

      club.books.forEach(b=>{
        if(!Array.isArray(b.voters)) b.voters = [];
        b.voters = b.voters.filter(v => v !== uid);
      });

      const alreadyHadThisVote = (myVoteId === bookId);
      if(!alreadyHadThisVote){
        const target = club.books.find(b => b.id === bookId);
        if(target) target.voters.push(uid);
        myVoteId = bookId;
      } else {
        myVoteId = null;
      }

      club.books.forEach(b=>{ b.votes = b.voters.length; });

      await jsonbinWriteClub(club);
      await storeSet('myVote', myVoteId || '');
      await refreshVotingUI();
    } finally {
      votingBusy = false;
      setVoteButtonsDisabled(false);
    }
  }

  async function removeBook(bookId){
    if(votingBusy) return;
    votingBusy = true;
    setVoteButtonsDisabled(true);
    try{
      const club = await jsonbinReadClub();
      club.books = club.books.filter(b => b.id !== bookId);
      await jsonbinWriteClub(club);
      if(myVoteId === bookId){
        myVoteId = null;
        await storeSet('myVote', '');
      }
      await refreshVotingUI();
    } finally {
      votingBusy = false;
      setVoteButtonsDisabled(false);
    }
  }

  function setVoteButtonsDisabled(disabled){
    bookList.querySelectorAll('button').forEach(b => b.disabled = disabled);
  }

  async function loadMyVote(){
    myVoteId = await storeGet('myVote');
  }

  async function refreshVotingUI(){
    const club = await jsonbinReadClub();
    let needsNormalize = false;
    club.books.forEach(b=>{
      if(!Array.isArray(b.voters)){ b.voters = []; needsNormalize = true; }
      if(b.votes !== b.voters.length){ b.votes = b.voters.length; needsNormalize = true; }
    });
    if(needsNormalize) await jsonbinWriteClub(club);

    renderVotingSummary(club.books);
    renderVotingModalList(club.books);
  }

  function renderVotingSummary(list){
    if(list.length === 0){
      votingSummary.innerHTML = '<p class="empty-note">Список пуст. Внеси книгу выше — станешь первым.</p>';
      return;
    }
    const sorted = [...list].sort((a,b)=> (b.votes||0) - (a.votes||0));
    const leader = sorted[0];
    votingSummary.innerHTML = `
      <p class="leader-line"><span class="crown">&#128081;</span>${escapeHtml(leader.title)}</p>
      <p class="leader-count">лидирует с ${leader.votes||0} голос(ами) · книг в списке: ${list.length}</p>
    `;
  }

  function renderVotingModalList(list){
    bookList.innerHTML = '';
    if(list.length === 0){
      emptyNote.style.display = 'block';
      return;
    }
    emptyNote.style.display = 'none';
    const sorted = [...list].sort((a,b) => (b.votes||0) - (a.votes||0));
    const topVotes = sorted[0] ? (sorted[0].votes||0) : 0;

    sorted.forEach((b, idx)=>{
      const li = document.createElement('li');
      li.className = 'book-item' + ((b.votes||0) === topVotes && topVotes > 0 ? ' leading' : '');
      const isMine = b.id === myVoteId;
      li.innerHTML = `
        <span class="rank">${idx+1}</span>
        ${b.cover ? `<img class="cover-mini" src="${b.cover}" alt="">` : `<div class="cover-mini"></div>`}
        <div class="meta">
          <div class="title">${(b.votes||0) === topVotes && topVotes > 0 ? '<span class="crown">&#128081;</span>' : ''}${escapeHtml(b.title)}${isMine ? '<span class="voted-tag">твой голос</span>' : ''}</div>
          <div class="author">${escapeHtml(b.author || '')}</div>
        </div>
        <div class="votes">${b.votes||0} голос(ов)</div>
      `;
      const voteBtn = document.createElement('button');
      voteBtn.className = 'ghost';
      voteBtn.textContent = isMine ? 'Забрать голос' : 'Голосовать';
      voteBtn.addEventListener('click', ()=> castVote(b.id));
      li.appendChild(voteBtn);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'ghost danger';
      removeBtn.textContent = 'Убрать';
      removeBtn.addEventListener('click', ()=> removeBook(b.id));
      li.appendChild(removeBtn);

      bookList.appendChild(li);
    });
  }

  function escapeHtml(str){
    return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  }

  openVotingBtn.addEventListener('click', async ()=>{
    await refreshVotingUI();
    votingModal.classList.add('show');
  });
  closeVotingBtn.addEventListener('click', ()=>{
    votingModal.classList.remove('show');
  });
  votingModal.addEventListener('click', (e)=>{
    if(e.target === votingModal) votingModal.classList.remove('show');
  });

  declareBtn.addEventListener('click', async ()=>{
    const club = await jsonbinReadClub();
    if(club.books.length === 0) return;
    const sorted = [...club.books].sort((a,b) => (b.votes||0) - (a.votes||0));
    const winner = sorted[0];
    winnerCover.src = winner.cover || '';
    winnerCover.style.display = winner.cover ? 'block' : 'none';
    winnerTitle.textContent = winner.title + (winner.author ? (' — ' + winner.author) : '');
    winnerVotes.textContent = 'Голосов за неё: ' + (winner.votes||0);
    winnerCard.style.display = 'block';
    votingModal.classList.remove('show');

    club.books = [];
    await jsonbinWriteClub(club);
    myVoteId = null;
    await storeSet('myVote', '');
    await refreshVotingUI();

    winnerCard.scrollIntoView({behavior:'smooth', block:'center'});
  });

  // ---------- Ratings hall ----------
  async function addRatingBook(title){
    const club = await jsonbinReadClub();
    const clean = title.trim();
    const takenTitles = STATIC_BOOKS.map(b=>b.title.toLowerCase())
      .concat(club.extraRatingBooks.map(b=>b.title.toLowerCase()));
    if(takenTitles.includes(clean.toLowerCase())) return false;
    club.extraRatingBooks.push({
      id: 'abx_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
      title: clean
    });
    await jsonbinWriteClub(club);
    return true;
  }

  addRatingBookBtn.addEventListener('click', async ()=>{
    const val = newRatingBookInput.value.trim();
    if(!val) return;
    addRatingBookBtn.disabled = true;
    await addRatingBook(val);
    newRatingBookInput.value = '';
    addRatingBookBtn.disabled = false;
    await renderRatingsFull();
  });
  newRatingBookInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') addRatingBookBtn.click(); });

  async function rateBook(bookId, score, btnEl){
    if(btnEl) btnEl.disabled = true;
    try{
      const uid = await getMyUserId();
      const club = await jsonbinReadClub();
      if(!club.bookRatings[bookId]) club.bookRatings[bookId] = {};
      club.bookRatings[bookId][uid] = score;
      await jsonbinWriteClub(club);
      await renderRatingsFull();
    } finally {
      if(btnEl) btnEl.disabled = false;
    }
  }

  async function renderRatingsFull(){
    const uid = await getMyUserId();
    const club = await jsonbinReadClub();
    const allBooks = STATIC_BOOKS.concat(club.extraRatingBooks);
    const ratings = club.bookRatings;

    ratingList.innerHTML = '';
    allBooks.forEach(book=>{
      const li = document.createElement('li');
      li.className = 'rating-item';
      li.dataset.bookId = book.id;

      const scores = ratings[book.id] ? Object.values(ratings[book.id]) : [];
      const count = scores.length;
      const avg = count > 0 ? (scores.reduce((a,b)=>a+b,0) / count) : null;
      const myScore = ratings[book.id] ? ratings[book.id][uid] : undefined;

      const seals = Array.from({length:10}, (_,i)=> i+1).map(n =>
        `<button type="button" class="seal-btn${myScore===n ? ' active' : ''}" data-score="${n}">${n}</button>`
      ).join('');

      li.innerHTML = `
        <div class="r-title">${escapeHtml(book.title)}</div>
        <div class="r-row">
          <div class="seal-row">${seals}</div>
          <div class="avg-wrap">
            <span class="avg-badge">${(avg !== null ? avg.toFixed(1) : '—')} / 10</span>
            <span class="avg-count">${count === 0 ? 'пока нет оценок' : ('оценок: ' + count)}</span>
          </div>
        </div>
      `;
      ratingList.appendChild(li);

      li.querySelectorAll('.seal-btn').forEach(btn=>{
        btn.addEventListener('click', ()=> rateBook(book.id, parseInt(btn.dataset.score, 10), btn));
      });
    });
  }

})();

(function(){
  // ---------------------------------------------------------------
  // Storage layer: uses Claude's shared/personal storage when the
  // page runs inside a Claude artifact (real cross-visitor sharing).
  // When that API is not present — e.g. the page was downloaded and
  // opened as a normal website — everything falls back to
  // localStorage, so buttons keep working and data survives reloads
  // and closing the tab. The fallback is per-browser only: it cannot
  // make votes/ratings visible to other people's devices, since a
  // static HTML/CSS/JS site has no server to share data through.
  // ---------------------------------------------------------------
  const hasCloudStorage = (typeof window.storage !== 'undefined') && !!window.storage;

  function lsKey(key, shared){
    return 'citadel:' + (shared ? 'shared:' : 'personal:') + key;
  }

  async function storeGet(key, shared){
    if(hasCloudStorage){
      try{
        const res = await window.storage.get(key, !!shared);
        return (res && typeof res.value !== 'undefined') ? res.value : null;
      }catch(err){
        return null; // key not found or storage error
      }
    }
    try{
      return localStorage.getItem(lsKey(key, shared));
    }catch(err){
      return null;
    }
  }

  async function storeSet(key, value, shared){
    if(hasCloudStorage){
      try{
        await window.storage.set(key, value, !!shared);
        return true;
      }catch(err){
        console.error('Ошибка облачного хранилища:', err);
      }
    }
    try{
      localStorage.setItem(lsKey(key, shared), value);
      return true;
    }catch(err){
      console.error('Ошибка локального хранилища:', err);
      return false;
    }
  }

  // ---------------------------------------------------------------
  // Real cross-device shared storage via JSONBin.io. This is what
  // makes votes, submitted books, and ratings visible to every guest
  // on every device — not just on the browser that made the change.
  // All shared data (books + ratings) lives in one JSON bin, so every
  // write re-reads the bin first and merges in, to avoid one field
  // (say, books) wiping out the other (say, bookRatings).
  // ---------------------------------------------------------------
  const JSONBIN_ID = '6a6ef762da38895dfeaeed5f';
  const JSONBIN_KEY = '$2a$10$.um2lc2kHdWRX5UfCxDtj.egJaqqOB4rniH4eGh.0AApsyxuYJnp2';
  const JSONBIN_BASE = 'https://api.jsonbin.io/v3/b/' + JSONBIN_ID;

  async function jsonbinRead(){
    try{
      const resp = await fetch(JSONBIN_BASE + '/latest', {
        method: 'GET',
        headers: { 'X-Master-Key': JSONBIN_KEY }
      });
      if(!resp.ok) throw new Error('jsonbin read failed: ' + resp.status);
      const data = await resp.json();
      const record = (data && data.record) ? data.record : {};
      return {
        books: Array.isArray(record.books) ? record.books : [],
        bookRatings: (record.bookRatings && typeof record.bookRatings === 'object') ? record.bookRatings : {}
      };
    }catch(err){
      console.error('Не удалось прочитать общий свиток:', err);
      return { books: [], bookRatings: {} };
    }
  }

  async function jsonbinWrite(fullData){
    try{
      const resp = await fetch(JSONBIN_BASE, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': JSONBIN_KEY
        },
        body: JSON.stringify(fullData)
      });
      if(!resp.ok) throw new Error('jsonbin write failed: ' + resp.status);
      return true;
    }catch(err){
      console.error('Не удалось сохранить в общий свиток:', err);
      return false;
    }
  }

  // ---------------------------------------------------------------

  const hero = document.getElementById('hero');
  const hall = document.getElementById('hall');
  const doorLeft = document.getElementById('doorLeft');
  const doorRight = document.getElementById('doorRight');
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

  let currentFoundBook = null;
  let myVoteId = null;
  let myUserId = null;
  let votingBusy = false;

  storageNote.textContent = 'Список книг, голоса и оценки хранятся в общем облаке и видны всем гостям цитадели на любых устройствах.';

  // Fixed catalogue for the 1-10 ratings hall
  const STATIC_BOOKS = [
    { id:'rb01', title:'Остров пропавших деревьев' },
    { id:'rb02', title:'Игра реальностей Дрейка' },
    { id:'rb03', title:'Страна чудес без тормозов' },
    { id:'rb04', title:'Конклав' },
    { id:'rb05', title:'Большая маленькая ложь' },
    { id:'rb06', title:'Город женщин' },
    { id:'rb07', title:'Там, где раки поют' },
    { id:'rb08', title:'Руководство по истреблению вампиров' },
    { id:'rb09', title:'Бабушка велела кланяться и передать, что просит прощения' },
    { id:'rb10', title:'Рождество Эркюля Пуаро' },
    { id:'rb11', title:'Черновик' },
    { id:'rb12', title:'Мемуары гейши' },
    { id:'rb13', title:'Я её любил, я его любила' },
    { id:'rb14', title:'Маленькие женщины' },
    { id:'rb15', title:'Правда о деле Гарри Квеберта' },
    { id:'rb16', title:'Творцы совпадений' }
  ];

  function openDoors(){
    hero.classList.add('opened');
    setTimeout(()=>{
      hall.classList.add('visible');
      initAfterEntry();
    }, 900);
  }
  doorLeft.addEventListener('click', openDoors);
  doorRight.addEventListener('click', openDoors);

  // ---------- Atmospheric rain window (purely decorative) ----------
  function initRainWindow(){
    const rainLayer = document.getElementById('rainLayer');
    if(!rainLayer) return;
    const dropCount = 26;
    for(let i=0;i<dropCount;i++){
      const drop = document.createElement('div');
      drop.className = 'raindrop';
      drop.style.left = (Math.random()*100) + '%';
      drop.style.animationDuration = (0.5 + Math.random()*0.5) + 's';
      drop.style.animationDelay = (Math.random()*2) + 's';
      rainLayer.appendChild(drop);
    }
    scheduleLightning();
  }

  function scheduleLightning(){
    const wait = 4000 + Math.random()*10000; // strikes at a random moment
    setTimeout(()=>{
      const flash = document.getElementById('lightningFlash');
      if(flash){
        flash.classList.remove('flash');
        void flash.offsetWidth; // restart the CSS animation
        flash.classList.add('flash');
      }
      scheduleLightning();
    }, wait);
  }

  initRainWindow();

  async function initAfterEntry(){
    try{ await loadNickname(); }catch(e){ console.error(e); }
    try{ await getMyUserId(); }catch(e){ console.error(e); }
    try{ await loadMyVote(); }catch(e){ console.error(e); }
    try{ await refreshVotingUI(); }catch(e){ console.error(e); }
    try{ await renderRatingsFull(); }catch(e){ console.error(e); }

    // Keep shared data live so every guest sees fresh votes and averages
    // without needing to reload the page.
    setInterval(()=> refreshVotingUI().catch(()=>{}), 7000);
    setInterval(()=> renderRatingsFull().catch(()=>{}), 7000);
  }

  // ---------- Stable identity (survives reload/close of the tab) ----------
  async function getMyUserId(){
    if(myUserId) return myUserId;
    const existing = await storeGet('user_id', false);
    if(existing){
      myUserId = existing;
    } else {
      myUserId = 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,10);
      await storeSet('user_id', myUserId, false);
    }
    return myUserId;
  }

  // ---------- Nickname ----------
  async function loadNickname(){
    const name = await storeGet('nickname', false);
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
    await storeSet('nickname', val, false);
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
    searchStatus.textContent = 'Ты прошёл мимо, ничего не выбрав.';
  });

  async function doSearch(){
    const q = bookInput.value.trim();
    if(!q) return;
    searchStatus.style.display='block';
    searchStatus.textContent = 'Хранитель листает каталоги...';
    bookResult.style.display='none';
    addRow.style.display='none';
    currentFoundBook = null;

    try{
      const resp = await fetch('https://openlibrary.org/search.json?title=' + encodeURIComponent(q) + '&limit=1');
      if(!resp.ok) throw new Error('network');
      const data = await resp.json();
      const doc = data.docs && data.docs[0];
      if(!doc){
        searchStatus.textContent = 'В этих каталогах такой книги не нашлось. Можешь попробовать иначе или пропустить.';
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
      searchStatus.textContent = 'Каталоги сейчас недоступны. Впиши книгу от руки — она всё равно попадёт в свиток.';
      currentFoundBook = { title: q, author: '', year: '', cover: '' };
      addRow.style.display = 'flex';
      addToVoteBtn.disabled = false;
      addToVoteBtn.textContent = 'Внести в список голосования';
    }
  }

  // ---------- Shared book list & voting ----------
  async function getSharedBooks(){
    const data = await jsonbinRead();
    return data.books;
  }

  async function setSharedBooks(list){
    const data = await jsonbinRead();
    data.books = list;
    return jsonbinWrite(data);
  }

  async function loadMyVote(){
    myVoteId = await storeGet('myVote', false);
  }

  addToVoteBtn.addEventListener('click', async ()=>{
    if(!currentFoundBook || addToVoteBtn.disabled) return;
    addToVoteBtn.disabled = true;
    const list = await getSharedBooks();
    const exists = list.find(b => b.title.trim().toLowerCase() === currentFoundBook.title.trim().toLowerCase());
    if(!exists){
      list.push({
        id: 'b_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
        title: currentFoundBook.title,
        author: currentFoundBook.author,
        cover: currentFoundBook.cover,
        votes: 0,
        voters: []
      });
      await setSharedBooks(list);
    }
    addToVoteBtn.textContent = 'Уже внесена в свиток';
    await refreshVotingUI();
  });

  // Each voter id occupies at most one slot across all "voters" arrays,
  // so the vote count is always just that array's length — never a
  // hand-incremented number that can drift out of sync.
  async function castVote(bookId){
    if(votingBusy) return;
    votingBusy = true;
    setVoteButtonsDisabled(true);
    try{
      const uid = await getMyUserId();
      const list = await getSharedBooks();

      list.forEach(b=>{
        if(!Array.isArray(b.voters)) b.voters = [];
        b.voters = b.voters.filter(v => v !== uid);
      });

      const alreadyHadThisVote = (myVoteId === bookId);
      if(!alreadyHadThisVote){
        const target = list.find(b => b.id === bookId);
        if(target) target.voters.push(uid);
        myVoteId = bookId;
      } else {
        myVoteId = null;
      }

      list.forEach(b=>{ b.votes = b.voters.length; });

      await setSharedBooks(list);
      await storeSet('myVote', myVoteId || '', false);
      await refreshVotingUI();
    } finally {
      votingBusy = false;
      setVoteButtonsDisabled(false);
    }
  }

  function setVoteButtonsDisabled(disabled){
    bookList.querySelectorAll('button').forEach(b => b.disabled = disabled);
  }

  async function refreshVotingUI(){
    const list = await getSharedBooks();

    // Normalize legacy/incomplete entries
    let needsNormalize = false;
    list.forEach(b=>{
      if(!Array.isArray(b.voters)){ b.voters = []; needsNormalize = true; }
      if(b.votes !== b.voters.length){ b.votes = b.voters.length; needsNormalize = true; }
    });
    if(needsNormalize) await setSharedBooks(list);

    renderVotingSummary(list);
    renderVotingModalList(list);
  }

  function renderVotingSummary(list){
    if(list.length === 0){
      votingSummary.innerHTML = '<p class="empty-note">Список пуст. Внеси книгу выше — станешь первым.</p>';
      return;
    }
    const sorted = [...list].sort((a,b)=> (b.votes||0) - (a.votes||0));
    const leader = sorted[0];
    votingSummary.innerHTML = `
      <p class="leader-line"><span class="crown">&#128081;</span><span class="title">${escapeHtml(leader.title)}</span></p>
      <p class="leader-count">лидирует с ${leader.votes||0} голос(ами) · книг в свитке: ${list.length}</p>
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
      voteBtn.style.marginLeft = '0.6rem';
      voteBtn.textContent = isMine ? 'Забрать голос' : 'Голосовать';
      voteBtn.addEventListener('click', ()=> castVote(b.id));
      li.appendChild(voteBtn);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'ghost danger';
      removeBtn.style.marginLeft = '0.5rem';
      removeBtn.textContent = 'Убрать';
      removeBtn.addEventListener('click', ()=> removeBook(b.id));
      li.appendChild(removeBtn);

      bookList.appendChild(li);
    });
  }

  // Removes a book from the voting scroll entirely (any guest can do this).
  async function removeBook(bookId){
    if(votingBusy) return;
    votingBusy = true;
    setVoteButtonsDisabled(true);
    try{
      const data = await jsonbinRead();
      data.books = data.books.filter(b => b.id !== bookId);
      await jsonbinWrite(data);
      if(myVoteId === bookId){
        myVoteId = null;
        await storeSet('myVote', '', false);
      }
      await refreshVotingUI();
    } finally {
      votingBusy = false;
      setVoteButtonsDisabled(false);
    }
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
    const list = await getSharedBooks();
    if(list.length === 0) return;
    const sorted = [...list].sort((a,b) => (b.votes||0) - (a.votes||0));
    const winner = sorted[0];
    winnerCover.src = winner.cover || '';
    winnerCover.style.display = winner.cover ? 'block' : 'none';
    winnerTitle.textContent = winner.title + (winner.author ? (' — ' + winner.author) : '');
    winnerVotes.textContent = 'Голосов за неё: ' + (winner.votes||0);
    winnerCard.style.display = 'block';
    votingModal.classList.remove('show');

    // The council has spoken — clear the scroll so a new round can begin.
    const data = await jsonbinRead();
    data.books = [];
    await jsonbinWrite(data);
    myVoteId = null;
    await storeSet('myVote', '', false);
    await refreshVotingUI();

    winnerCard.scrollIntoView({behavior:'smooth', block:'center'});
  });

  // ---------- Ratings hall (1-10 scale, shared averages, extendable list) ----------
  const newRatingBookInput = document.getElementById('newRatingBookInput');
  const addRatingBookBtn = document.getElementById('addRatingBookBtn');

  async function getAllRatingBooks(){
    const data = await jsonbinRead();
    const extra = Array.isArray(data.extraRatingBooks) ? data.extraRatingBooks : [];
    return STATIC_BOOKS.concat(extra);
  }

  async function addRatingBook(title){
    const data = await jsonbinRead();
    if(!Array.isArray(data.extraRatingBooks)) data.extraRatingBooks = [];
    const clean = title.trim();
    const takenTitles = STATIC_BOOKS.map(b=>b.title.toLowerCase())
      .concat(data.extraRatingBooks.map(b=>b.title.toLowerCase()));
    if(takenTitles.includes(clean.toLowerCase())) return false;
    data.extraRatingBooks.push({
      id: 'rbx_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
      title: clean
    });
    await jsonbinWrite(data);
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
      const data = await jsonbinRead();
      if(!data.bookRatings) data.bookRatings = {};
      if(!data.bookRatings[bookId]) data.bookRatings[bookId] = {};
      data.bookRatings[bookId][uid] = score;
      await jsonbinWrite(data);
      await renderRatingsFull();
    } finally {
      if(btnEl) btnEl.disabled = false;
    }
  }

  async function renderRatingsFull(){
    const uid = await getMyUserId();
    const data = await jsonbinRead();
    const extra = Array.isArray(data.extraRatingBooks) ? data.extraRatingBooks : [];
    const allBooks = STATIC_BOOKS.concat(extra);
    const ratings = data.bookRatings || {};

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

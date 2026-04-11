/**
 * grid.js
 * Grilla de eventos con filtros.
 */

window.Grid = (() => {
  let _filter = 'all';
  let _cat = 'Todos';

  function init() {
    _buildPills();
    build();
  }

  function _buildPills() {
    const element = document.getElementById('cat-pills');
    if (!element) return;
    element.innerHTML = CATEGORIES.map(category =>
      `<button class="cat-pill${category === 'Todos' ? ' active' : ''}" onclick="Grid.setCat('${category}')">${category}</button>`
    ).join('');
  }

  function setFilter(filter) {
    _filter = filter;
    ['all', 'bestSeller', 'recommended'].forEach(key => {
      document.getElementById(`f-${key}`)?.classList.toggle('active-filter', key === filter);
    });
    build();
  }

  function setCat(category) {
    _cat = category;
    document.querySelectorAll('.cat-pill').forEach(pill => {
      pill.classList.toggle('active', pill.textContent.trim() === category);
    });
    build();
  }

  function toggleCats() {
    document.getElementById('cat-pills')?.classList.toggle('open');
  }

  function clearAll() {
    _filter = 'all';
    _cat = 'Todos';
    const input = document.getElementById('search-input');
    if (input) input.value = '';
    document.getElementById('search-clear')?.classList.add('hidden');
    document.getElementById('cat-pills')?.classList.remove('open');
    _buildPills();
    ['all', 'bestSeller', 'recommended'].forEach(key => {
      document.getElementById(`f-${key}`)?.classList.toggle('active-filter', key === 'all');
    });
    build();
  }

  function build() {
    const query = (Search.getQuery() || '').toLowerCase();
    const items = _compute(query);
    _renderHeader(items.length, query);
    _renderGrid(items);
  }

  function _compute(query) {
    const seen = new Set();
    const items = [];

    EVENTS.forEach(event => {
      if (event.status === 'expired') return;

      const matchCategory = _cat === 'Todos' || event.category === _cat;
      const matchQuery = !query || [event.city, event.category, event.venue || '', event.tourName || '']
        .some(value => value.toLowerCase().includes(query));
      const matchFilter = _filter === 'bestSeller'
        ? event.bestSeller
        : _filter === 'recommended'
          ? event.recommended
          : true;

      if (!matchCategory || !matchQuery || !matchFilter) return;

      if (event.tourName) {
        const key = `${event.artistId}-${event.tourName}`;
        if (seen.has(key)) return;
        seen.add(key);
        const dates = EVENTS
          .filter(item => item.artistId === event.artistId && item.tourName === event.tourName && item.status !== 'expired')
          .sort((left, right) => new Date(left.date) - new Date(right.date));
        items.push({ type: 'tour', artistId: event.artistId, tourName: event.tourName, dates });
        return;
      }

      items.push({ type: 'event', event });
    });

    return items;
  }

  function _renderHeader(count, query) {
    const hasFilters = query || _cat !== 'Todos' || _filter !== 'all';
    const title = document.getElementById('grid-title');
    const countLabel = document.getElementById('grid-count');
    const clearButton = document.getElementById('clear-all-btn');

    if (title) title.textContent = hasFilters ? 'Resultados' : 'Eventos Destacados';
    if (clearButton) clearButton.classList.toggle('hidden', !hasFilters);

    if (countLabel) {
      let html = `${count} resultado${count !== 1 ? 's' : ''}`;
      if (_cat !== 'Todos') html += ` en <span>${_cat}</span>`;
      if (query) html += ` · "<span>${query}</span>"`;
      countLabel.innerHTML = html;
    }
  }

  function _renderGrid(items) {
    const grid = document.getElementById('events-grid');
    if (!grid) return;

    if (!items.length) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-icon">${Icons.search}</div><h3 class="empty-title">Sin resultados</h3><p class="empty-sub">¿Buscas un artista? Escribelo y seleccionalo del menu.</p><button class="btn btn-ghost" onclick="Grid.clearAll()">Limpiar filtros</button></div>`;
      return;
    }

    grid.innerHTML = items.map(item =>
      item.type === 'tour' ? _tourCard(item) : _eventCard(item.event)
    ).join('');
  }

  function _tourCard(item) {
    const first = item.dates[0];
    const last = item.dates[item.dates.length - 1];
    const cities = item.dates.map(event => event.city);
    const minPrice = Math.min(...item.dates.map(event => Zones.getMinPrice(event.id)));
    const liked = Profile.isLiked(first.id);
    const start = _fmt(first.date, { day: 'numeric', month: 'short' });
    const end = _fmt(last.date, { day: 'numeric', month: 'short', year: 'numeric' });

    return `
      <article class="card card--tour" onclick="Pages.openArtist('${item.artistId}')" role="button" tabindex="0">
        <div class="card-img">
          <img src="${first.image}" alt="${item.tourName}" loading="lazy"/>
          <div class="card-img-overlay"></div>
          <span class="badge badge--gira">Gira</span>
          <div class="badge--cities">${cities.slice(0, 3).join(' · ')}${cities.length > 3 ? ` +${cities.length - 3}` : ''}</div>
          <button class="like-btn${liked ? ' liked' : ''}" data-id="${first.id}"
            onclick="event.stopPropagation();Profile.toggleLike('${first.id}',this)" aria-label="Favorito">${liked ? Icons.heart : Icons.heartOutline}</button>
        </div>
        <div class="card-body">
          <p class="card-category card-category--tour">${first.category}</p>
          <h2 class="card-title">${item.tourName}</h2>
          <p class="card-artist">${first.artist}</p>
          <div class="card-meta">
            <div class="card-meta-row"><span class="meta-icon"></span>${start} — ${end}</div>
            <div class="card-meta-row"><span class="meta-icon"></span>${item.dates.length} ciudad${item.dates.length !== 1 ? 'es' : ''}</div>
          </div>
          <div class="card-footer">
            <div><p class="price-from">Desde</p><p class="price-value">$${minPrice.toLocaleString()}</p></div>
            <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();Pages.openArtist('${item.artistId}')">Ver fechas</button>
          </div>
        </div>
      </article>`;
  }

  function _eventCard(event) {
    const reviews = event.reviews || [];
    const liked = Profile.isLiked(event.id);
    const dateLabel = _fmt(event.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    const location = event.venue ? `${event.venue}, ${event.city}` : event.city;
    const stars = reviews.length ? _stars(reviews) : '';
    const price = Zones.getMinPrice(event.id);

    return `
      <article class="card card--event" onclick="Pages.openEvent('${event.id}')" role="button" tabindex="0">
        <div class="card-img">
          <img src="${event.image}" alt="${event.title}" loading="lazy"/>
          <div class="card-img-overlay"></div>
          <div class="card-badges">
            ${event.bestSeller ? '<span class="badge badge--top">Top</span>' : ''}
          </div>
          ${event.status === 'expired' ? '<div class="expired-overlay"><div class="expired-label">Caducado</div></div>' : ''}
          <button class="like-btn${liked ? ' liked' : ''}" data-id="${event.id}"
            onclick="event.stopPropagation();Profile.toggleLike('${event.id}',this)" aria-label="Favorito">${liked ? Icons.heart : Icons.heartOutline}</button>
        </div>
        <div class="card-body">
          <p class="card-category card-category--event">${event.category}</p>
          <h2 class="card-title">${event.title}</h2>
          <p class="card-artist">${event.artist}</p>
          <div class="card-meta">
            <div class="card-meta-row"><span class="meta-icon"></span>${dateLabel}</div>
            <div class="card-meta-row"><span class="meta-icon"></span>${location}</div>
          </div>
          ${stars}
          <div class="card-footer">
            <div><p class="price-from">Precio</p><p class="price-value">$${price.toLocaleString()}</p></div>
            <button class="btn btn-primary btn-sm" ${event.status === 'expired' ? 'disabled' : ''}
              onclick="event.stopPropagation();Pages.handleBuy('${event.id}')">Comprar</button>
          </div>
        </div>
      </article>`;
  }

  function _stars(reviews) {
    const average = reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length;
    return `<div class="card-stars">
      ${[1, 2, 3, 4, 5].map(index => `<span class="star star--${index <= Math.round(average) ? 'filled' : 'empty'}">${Icons.star}</span>`).join('')}
      <span class="star-count">(${reviews.length})</span>
    </div>`;
  }

  function _fmt(date, options) {
    return new Date(date).toLocaleDateString('es-ES', options);
  }

  return { init, build, setFilter, setCat, toggleCats, clearAll };
})();

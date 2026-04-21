/**
 * pages.js
 * Renderiza la pagina de artista y el detalle del evento.
 */

const Pages = (() => {
  let pendingRating = 0;
  let currentEventId = '';

  function _eventPrice(eventId) {
    if (typeof Zones !== 'undefined' && Zones.getMinPrice) return Zones.getMinPrice(eventId);
    return EVENTS.find(event => event.id === eventId)?.ticketPrice || 0;
  }

  function openArtist(id) {
    const artist = ARTISTS.find(item => item.id === id);
    if (!artist) return;

    document.getElementById('artist-hero-img').src = artist.image;
    document.getElementById('artist-hero-img').alt = artist.name;
    document.getElementById('artist-avatar').innerHTML = Icons._icon('mic', 32, '#fff');
    document.getElementById('artist-name').textContent = artist.name;
    document.getElementById('artist-genre').textContent = artist.genre;
    document.getElementById('artist-bio').textContent = artist.bio;

    const badge = document.getElementById('artist-tour-badge');
    badge.classList.toggle('hidden', !artist.isOnTour);

    renderArtistTours(id);
    App.navigate('artist');
  }

  function renderArtistTours(artistId) {
    const all = EVENTS
      .filter(event => event.artistId === artistId)
      .sort((left, right) => new Date(left.date) - new Date(right.date));
    const active = all.filter(event => event.status !== 'expired');
    const expired = all.filter(event => event.status === 'expired');
    const tours = {};

    active.forEach(event => {
      const key = event.tourName || '__single__';
      if (!tours[key]) tours[key] = [];
      tours[key].push(event);
    });

    let html = '';
    Object.entries(tours).forEach(([tourName, events]) => {
      const label = tourName === '__single__' ? 'Proximas fechas' : tourName;
      html += `
        <div class="tour-group">
          <div class="tour-group-header">
            <div class="tour-group-accent"></div>
            <h2 class="tour-group-title">${label}</h2>
            <span class="tour-group-count">${events.length} fecha${events.length !== 1 ? 's' : ''}</span>
          </div>
          ${events.map(event => tourDateCard(event)).join('')}
        </div>`;
    });

    if (expired.length) {
      html += `
        <div class="tour-group past">
          <div class="tour-group-header">
            <div class="tour-group-accent"></div>
            <h2 class="tour-group-title">Fechas pasadas</h2>
          </div>
          ${expired.map(event => `
            <div class="tour-date-card" style="pointer-events:none">
              ${dateBadge(event.date)}
              <div class="date-info">
                <div class="date-city">${event.city}</div>
                <div class="date-venue">${event.venue || ''}</div>
              </div>
              <span class="badge" style="background:rgba(255,255,255,.08);color:var(--text-muted)">Pasado</span>
            </div>`).join('')}
        </div>`;
    }

    document.getElementById('artist-tours').innerHTML =
      html || '<p style="color:var(--text-muted);font-size:.85rem">Sin fechas disponibles.</p>';
  }

  function tourDateCard(event) {
    const date = new Date(event.date);
    const daysUntil = Math.ceil((date - Date.now()) / 86400000);
    const soon = daysUntil > 0 && daysUntil <= 7
      ? `<span class="soon-badge">${daysUntil === 1 ? 'Manana' : `${daysUntil} dias`}</span>`
      : '';
    const weekday = date.toLocaleDateString('es-ES', { weekday: 'long' });
    const price = _eventPrice(event.id);

    return `
      <div class="tour-date-card" onclick="Pages.openEvent('${event.id}')" role="button" tabindex="0"
        onkeydown="if(event.key==='Enter') Pages.openEvent('${event.id}')">
        ${dateBadge(event.date)}
        <div class="date-info">
          <div class="date-city">${event.city} ${soon}</div>
          <div class="date-venue">${event.venue || ''}</div>
          <div class="date-weekday">${weekday} · 20:00 hrs</div>
        </div>
        <div class="date-right">
          <div>
            <div class="date-price-label">Precio</div>
            <div class="date-price">$${price.toLocaleString()}</div>
          </div>
          <button class="btn btn-secondary btn-sm"
            onclick="event.stopPropagation(); Pages.handleBuy('${event.id}')">
            Boletos
          </button>
        </div>
      </div>`;
  }

  function dateBadge(dateText) {
    const date = new Date(dateText);
    const day = date.getDate();
    const month = date.toLocaleString('es-ES', { month: 'short' }).replace('.', '');
    return `
      <div class="date-box">
        <div class="date-day">${day}</div>
        <div class="date-mon">${month}</div>
      </div>`;
  }

  function openEvent(id) {
    const event = EVENTS.find(item => item.id === id);
    if (!event) return;
    currentEventId = id;

    document.getElementById('event-hero-img').src = event.image;
    document.getElementById('event-hero-img').alt = event.title;
    document.getElementById('event-cat').textContent = event.category;
    document.getElementById('event-title').textContent = event.title;
    document.getElementById('event-artist').textContent = event.artist;
    document.getElementById('event-about').textContent = event.about || '';

    const date = new Date(event.date);
    document.getElementById('event-meta').innerHTML = `
      <div class="event-meta-item"><span class="meta-icon"></span>
        ${date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      </div>
      <div class="event-meta-item"><span class="meta-icon"></span>20:00 hrs</div>
      <div class="event-meta-item"><span class="meta-icon"></span>${event.venue ? `${event.venue}, ` : ''}${event.city}</div>
      <div class="event-meta-item"><span class="meta-icon"></span>${event.category}</div>`;

    renderTourDatesInline(event);
    renderAlsoSeen(event);
    renderSidebar(event, id);

    App.navigate('event');
  }



  function renderTourDatesInline(event) {
    const section = document.getElementById('event-tour-section');
    if (!event.tourName) {
      section.classList.add('hidden');
      return;
    }

    const others = EVENTS
      .filter(item => item.id !== event.id && item.artistId === event.artistId && item.tourName === event.tourName && item.status !== 'expired')
      .sort((left, right) => new Date(left.date) - new Date(right.date));

    if (!others.length) {
      section.classList.add('hidden');
      return;
    }

    document.getElementById('event-tour-name').textContent = event.tourName;
    document.getElementById('event-tour-dates').innerHTML = others.map(item => {
      const date = new Date(item.date);
      return `
        <div class="tour-date-mini" onclick="Pages.openEvent('${item.id}')" role="button" tabindex="0">
          <div class="tour-date-mini-left">
            <div class="mini-cal">
              <div class="mini-cal-day">${date.getDate()}</div>
              <div class="mini-cal-mon">${date.toLocaleString('es-ES', { month: 'short' }).replace('.', '')}</div>
            </div>
            <div>
              <div style="font-size:.88rem;font-weight:600">${item.city}</div>
              <div style="font-size:.75rem;color:var(--text-muted)">${item.venue || ''}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
            <div style="text-align:right">
              <div style="font-size:.65rem;color:var(--text-muted)">Precio</div>
              <div style="font-size:.88rem;font-weight:700">$${_eventPrice(item.id).toLocaleString()}</div>
            </div>
            <button class="btn btn-outline btn-sm"
              onclick="event.stopPropagation(); Pages.handleBuy('${item.id}')">
              Boletos
            </button>
          </div>
        </div>`;
    }).join('');

    section.classList.remove('hidden');
  }



  function renderAlsoSeen(event) {
    const related = EVENTS.filter(item => item.id !== event.id && item.category === event.category && item.status !== 'expired').slice(0, 3);
    const items = related.length >= 2 ? related : EVENTS.filter(item => item.id !== event.id && item.status !== 'expired').slice(0, 3);

    document.getElementById('also-grid').innerHTML = items.map(item => `
      <div class="also-card" onclick="Pages.openEvent('${item.id}')">
        <div class="also-img"><img src="${item.image}" alt="${item.title}" loading="lazy"/></div>
        <div class="also-body">
          <div class="also-cat">${item.category}</div>
          <div class="also-title">${item.title}</div>
          <div class="also-sub">${item.city} · $${_eventPrice(item.id).toLocaleString()}</div>
        </div>
      </div>`).join('');
  }

  function renderSidebar(event, id) {
    const config = Zones.getTicketConfig(event.id);
    const remaining = Zones.getRemainingCapacity ? Zones.getRemainingCapacity(event.id) : Math.max(config.capacity, 0);
    const sold = Zones.getSoldCount ? Zones.getSoldCount(event.id) : 0;
    const hasLiveAvailability = Number.isFinite(remaining) && Number.isFinite(sold);

    document.getElementById('buy-price').textContent = `$${Number(config.price || 0).toLocaleString()}`;

    const pill = document.getElementById('buy-rating-pill');
    if (pill) pill.innerHTML = '';

    const details = document.getElementById('buy-details');
    details.innerHTML = `
      <div class="buy-detail-list">
        <div class="buy-detail-row">
          <span class="buy-detail-label">Precio por boleto</span>
          <span class="buy-detail-value">$${Number(config.price || 0).toLocaleString()}</span>
        </div>
        <div class="buy-detail-row">
          <span class="buy-detail-label">Capacidad</span>
          <span class="buy-detail-value">${Number(config.capacity || 0).toLocaleString()} personas</span>
        </div>
        <div class="buy-detail-row">
          <span class="buy-detail-label">Disponibles</span>
          <span class="buy-detail-value">${hasLiveAvailability ? `${remaining.toLocaleString()} boletos` : 'Consultando...'}</span>
        </div>
      </div>`;

    const buyButton = document.getElementById('buy-main-btn');
    if (event.status === 'expired') {
      buyButton.disabled = true;
      buyButton.textContent = 'Evento caducado';
    } else if (!config.price || (hasLiveAvailability && remaining <= 0)) {
      buyButton.disabled = true;
      buyButton.textContent = 'Sin boletos disponibles';
    } else {
      buyButton.disabled = false;
      buyButton.textContent = `Comprar — $${Number(config.price || 0).toLocaleString()} MXN`;
      buyButton.dataset.id = event.id;
    }

    const attendees = document.querySelector('.buy-attendees');
    if (attendees) {
      attendees.innerHTML = hasLiveAvailability
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline-flex;margin-right:4px"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>${sold.toLocaleString()} personas ya apartaron su entrada`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline-flex;margin-right:4px"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>Consultando compras reales...`;
    }
  }

  function refreshCurrentEvent() {
    if (!currentEventId || !document.getElementById('page-event')?.classList.contains('active')) return;
    const event = EVENTS.find(item => item.id === currentEventId);
    if (!event) return;
    renderSidebar(event, currentEventId);
  }



  function handleBuy(id) {
    if (!Auth.isLoggedIn()) {
      Auth.openModal();
      return;
    }
    Checkout.open(id);
  }

  function handleBuyClick() {
    const id = document.getElementById('buy-main-btn')?.dataset.id;
    if (id) handleBuy(id);
  }

  function starRow(value, size = '0.8rem') {
    return [1, 2, 3, 4, 5].map(index =>
      `<span style="font-size:${size};color:${index <= value ? '#facc15' : '#374151'};display:inline-flex">${Icons.star}</span>`
    ).join('');
  }

  return {
    openArtist,
    openEvent,
    handleBuy,
    handleBuyClick,
    refreshCurrentEvent,
  };
})();

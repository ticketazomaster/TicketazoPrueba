/**
 * profile.js
 * Perfil del usuario: favoritos, boletos, QR y cuenta bancaria del organizador.
 */

window.Profile = (() => {
  const STORAGE_KEYS = {
    tickets: 'ticketazo.profile.tickets.v4',
    organizerCard: 'ticketazo.profile.card.v2',
  };

  const LEGACY_STORAGE_KEYS = {
    ticketsV3: 'ticketazo.profile.tickets.v3',
    ticketsV2: 'ticketazo.profile.tickets.v2',
    ticketsV1: 'ticketazo.profile.tickets.v1',
    organizerCardV1: 'ticketazo.profile.card.v1',
  };

  const state = {
    liked: new Set(),
    tickets: [],
    registeredCard: null,
    scope: '',
    ticketsLoading: false,
    ticketsHydrated: false,
    ticketsError: '',
  };

  function _loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_err) {
      return fallback;
    }
  }

  function _saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_err) {
      // Demo sin manejo adicional.
    }
  }

  function _currentUserScope() {
    const session = typeof Auth !== 'undefined' && Auth.session ? Auth.session() : null;
    if (session?.id) return `user:${session.id}`;
    if (session?.email) return `email:${String(session.email).trim().toLowerCase()}`;
    return 'guest';
  }

  function _scopedKey(baseKey, scope = _currentUserScope()) {
    return `${baseKey}:${scope}`;
  }

  function _findEvent(eventId) {
    return EVENTS.find(event => event.id === eventId) || null;
  }

  function _profileVisible() {
    return !!document.getElementById('page-profile')?.classList.contains('active');
  }

  function _useDbTickets() {
    const session = typeof Auth !== 'undefined' && Auth.session ? Auth.session() : null;
    return !!(session?.dbUserId && typeof DB !== 'undefined' && DB.fetchUserTickets);
  }

  function _ticketDisplayData(ticket) {
    const event = _findEvent(ticket.eventId);
    return {
      image: ticket.eventImage || event?.image || 'assets/img/logo.png',
      title: ticket.eventTitle || event?.title || 'Evento Ticketazo',
      artist: ticket.artist || event?.artist || '',
      venue: ticket.venue || event?.venue || 'Lugar por confirmar',
      city: ticket.city || event?.city || '',
      date: ticket.eventDate || event?.date || '',
    };
  }

  function _buildTicketCode(eventId, ticketId) {
    const random = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `TKZ-${String(eventId || 'EVT').toUpperCase()}-${ticketId}-${random}`;
  }

  function _formatTicketRef() {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const random = Math.floor(1000 + Math.random() * 9000);
    return `ORD-${stamp}-${random}`;
  }

  function _base64UrlEncode(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function _base64UrlDecode(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(normalized + padding);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function _serializeTicketPayload(payload) {
    return _base64UrlEncode(JSON.stringify(payload));
  }

  function _deserializeTicketPayload(token) {
    try {
      return JSON.parse(_base64UrlDecode(token));
    } catch (_err) {
      return null;
    }
  }

  function _ticketStatusLabel(value, fallback) {
    const label = String(value || fallback || '').trim();
    return label || fallback;
  }

  function _sessionIdentity() {
    const session = typeof Auth !== 'undefined' && Auth.session ? Auth.session() : null;
    return {
      name: session?.name || 'Cliente Ticketazo',
      email: session?.email || '',
    };
  }

  function _buildTicketPayload(ticket) {
    const identity = _sessionIdentity();
    const display = _ticketDisplayData(ticket);
    return {
      ticketId: ticket.id,
      eventId: ticket.eventId,
      code: ticket.qrCode,
      purchaseRef: ticket.purchaseRef || _formatTicketRef(),
      purchaseDate: ticket.purchaseDate,
      price: Number(ticket.price || 0),
      buyerName: ticket.buyerName || identity.name,
      buyerEmail: ticket.buyerEmail || identity.email,
      purchaseStatus: _ticketStatusLabel(ticket.purchaseStatus, 'Aprobado'),
      accessStatus: _ticketStatusLabel(ticket.accessStatus, 'Activo'),
      eventTitle: display.title,
      artist: display.artist,
      date: display.date,
      venue: display.venue,
      city: display.city,
    };
  }

  function _buildTicketUrl(ticket) {
    const payload = _serializeTicketPayload(_buildTicketPayload(ticket));
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('ticket', payload);
    return url.toString();
  }

  function _findTicket(ticketId) {
    _hydrateState();
    return state.tickets.find(ticket => ticket.id === ticketId) || null;
  }

  function _formatLongDate(value) {
    if (!value) return 'Fecha por confirmar';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  function _formatShortDate(value) {
    if (!value) return 'Sin registro';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  function _normalizeTicket(ticket) {
    if (!ticket?.eventId && !ticket?.eventTitle) return null;
    const event = _findEvent(ticket.eventId);
    const ticketId = ticket.id || `T-${Math.floor(1000 + Math.random() * 9000)}`;
    const identity = _sessionIdentity();
    return {
      id: ticketId,
      eventId: ticket.eventId || '',
      dbId: ticket.dbId || null,
      purchaseDate: ticket.purchaseDate || new Date().toISOString(),
      price: Number(ticket.price || ticket.unitPrice || event?.ticketPrice || 0),
      qrCode: ticket.qrCode || _buildTicketCode(ticket.eventId, ticketId),
      purchaseRef: ticket.purchaseRef || _formatTicketRef(),
      buyerName: ticket.buyerName || ticket.userName || identity.name,
      buyerEmail: ticket.buyerEmail || ticket.userEmail || identity.email,
      purchaseStatus: _ticketStatusLabel(ticket.purchaseStatus, 'Aprobado'),
      accessStatus: _ticketStatusLabel(ticket.accessStatus, 'Activo'),
      eventTitle: ticket.eventTitle || event?.title || '',
      artist: ticket.artist || event?.artist || '',
      eventDate: ticket.eventDate || event?.date || '',
      venue: ticket.venue || event?.venue || '',
      city: ticket.city || event?.city || '',
      eventImage: ticket.eventImage || event?.image || 'assets/img/logo.png',
    };
  }

  function _migrateTickets(scope) {
    const targetKey = _scopedKey(STORAGE_KEYS.tickets, scope);
    if (localStorage.getItem(targetKey)) return;

    const sourceKeys = [
      _scopedKey(LEGACY_STORAGE_KEYS.ticketsV3, scope),
      _scopedKey(LEGACY_STORAGE_KEYS.ticketsV2, scope),
      LEGACY_STORAGE_KEYS.ticketsV1,
    ];

    for (const key of sourceKeys) {
      const legacy = _loadJSON(key, null);
      if (!Array.isArray(legacy) || !legacy.length) continue;
      const normalized = legacy.map(_normalizeTicket).filter(Boolean);
      _saveJSON(targetKey, normalized);
      localStorage.removeItem(key);
      return;
    }
  }

  function _migrateOrganizerCard(scope) {
    const targetKey = _scopedKey(STORAGE_KEYS.organizerCard, scope);
    if (localStorage.getItem(targetKey)) return;

    const legacyScoped = _scopedKey(LEGACY_STORAGE_KEYS.organizerCardV1, scope);
    const legacy = _loadJSON(legacyScoped, _loadJSON(LEGACY_STORAGE_KEYS.organizerCardV1, null));
    if (!legacy) return;

    _saveJSON(targetKey, legacy);
    localStorage.removeItem(legacyScoped);
    localStorage.removeItem(LEGACY_STORAGE_KEYS.organizerCardV1);
  }

  function _persistTickets() {
    _saveJSON(_scopedKey(STORAGE_KEYS.tickets, state.scope), state.tickets);
  }

  function _persistCard() {
    _saveJSON(_scopedKey(STORAGE_KEYS.organizerCard, state.scope), state.registeredCard);
  }

  function _setTickets(tickets) {
    state.tickets = (tickets || []).map(_normalizeTicket).filter(Boolean);
    _persistTickets();
  }

  async function _loadTicketsFromDb(force = false) {
    if (!_useDbTickets()) return state.tickets;
    if (state.ticketsLoading) return state.tickets;
    if (state.ticketsHydrated && !force) return state.tickets;

    const session = Auth.session();
    if (!session?.dbUserId) return state.tickets;

    state.ticketsLoading = true;
    state.ticketsError = '';
    const localBackup = [...state.tickets];

    try {
      const dbTickets = await DB.fetchUserTickets(session.dbUserId);
      if (dbTickets.length || !localBackup.length) {
        _setTickets(dbTickets);
      }
      state.ticketsHydrated = true;
    } catch (err) {
      console.warn('[Profile] No se pudieron cargar los boletos desde la BD:', err);
      state.ticketsError = 'No pudimos sincronizar tus boletos en este momento.';
    } finally {
      state.ticketsLoading = false;
      if (_profileVisible()) render();
    }

    return state.tickets;
  }

  function _hydrateState(force = false) {
    const scope = _currentUserScope();
    if (!force && state.scope === scope) return;

    _migrateTickets(scope);
    _migrateOrganizerCard(scope);

    const storageKey = _scopedKey(STORAGE_KEYS.tickets, scope);
    const storedTickets = _loadJSON(storageKey, []);
    const normalizedTickets = storedTickets
      .map(_normalizeTicket)
      .filter(Boolean);
    const needsTicketSync = Array.isArray(storedTickets) && storedTickets.some(ticket => (
      ticket
      && (
        !ticket.purchaseRef
        || !ticket.buyerName
        || !ticket.buyerEmail
        || !ticket.purchaseStatus
        || !ticket.accessStatus
      )
    ));

    state.scope = scope;
    state.tickets = normalizedTickets;
    state.registeredCard = _loadJSON(_scopedKey(STORAGE_KEYS.organizerCard, scope), null);
    state.ticketsLoading = false;
    state.ticketsHydrated = false;
    state.ticketsError = '';

    if (needsTicketSync) {
      _saveJSON(storageKey, normalizedTickets);
    }
  }

  _hydrateState(true);

  async function addTickets(eventId, qty, priceOverride) {
    _hydrateState();
    const event = _findEvent(eventId);
    if (!event) return [];

    const liveConfig = typeof Zones !== 'undefined' && Zones.getTicketConfig
      ? Zones.getTicketConfig(eventId)
      : null;
    const eventForPurchase = {
      ...event,
      ticketCapacity: Number(liveConfig?.capacity || event.ticketCapacity || 0),
    };
    const paidPrice = Number(priceOverride || liveConfig?.price || event.ticketPrice || 0);
    const session = typeof Auth !== 'undefined' && Auth.session ? Auth.session() : { name: 'Cliente Ticketazo', email: '' };
    const purchaseRef = _formatTicketRef();

    if (_useDbTickets()) {
      const created = await DB.createTicketPurchase({
        event: eventForPurchase,
        qty,
        price: paidPrice,
        buyerUserId: session?.dbUserId,
      });

      const hydrated = created.map(ticket => ({
        ...ticket,
        buyerName: session?.name || 'Cliente Ticketazo',
        buyerEmail: session?.email || '',
        purchaseRef: ticket.purchaseRef || purchaseRef,
      }));

      _setTickets([...hydrated, ...state.tickets]);
      state.ticketsHydrated = true;
      if (typeof Zones !== 'undefined' && Zones.refreshSales) {
        await Zones.refreshSales(true);
      }
      return hydrated;
    }

    const created = [];
    for (let index = 0; index < qty; index += 1) {
      const ticketId = `T-${Math.floor(1000 + Math.random() * 9000)}`;
      created.unshift({
        id: ticketId,
        eventId,
        purchaseDate: new Date().toISOString(),
        price: paidPrice,
        qrCode: _buildTicketCode(eventId, ticketId),
        purchaseRef,
        buyerName: session?.name || 'Cliente Ticketazo',
        buyerEmail: session?.email || '',
        purchaseStatus: 'Aprobado',
        accessStatus: 'Activo',
        eventTitle: eventForPurchase.title,
        artist: eventForPurchase.artist,
        eventDate: eventForPurchase.date,
        venue: eventForPurchase.venue || '',
        city: eventForPurchase.city || '',
        eventImage: eventForPurchase.image || 'assets/img/logo.png',
      });
    }

    _setTickets([...created, ...state.tickets]);
    return created;
  }

  async function _loadFavoritesFromDb() {
    const session = typeof Auth !== 'undefined' && Auth.session ? Auth.session() : null;
    if (!session?.dbUserId || typeof DB === 'undefined' || !DB.fetchFavorites) return;
    try {
      const likedIds = await DB.fetchFavorites(session.dbUserId);
      state.liked = new Set(likedIds);
      // Refresh like buttons on screen
      document.querySelectorAll('.like-btn').forEach(btn => {
        const id = btn.dataset.id;
        if (!id) return;
        const liked = state.liked.has(id);
        btn.classList.toggle('liked', liked);
        btn.innerHTML = liked ? Icons.heart : Icons.heartOutline;
      });
    } catch (err) {
      console.warn('[Profile] No se pudieron cargar los favoritos:', err);
    }
  }

  function toggleLike(id, _el) {
    if (!Auth.isLoggedIn()) {
      Auth.openModal();
      return;
    }
    const liked = state.liked.has(id);
    const nextState = !liked;

    // Optimistic UI update
    if (liked) state.liked.delete(id);
    else state.liked.add(id);

    document.querySelectorAll(`.like-btn[data-id="${id}"]`).forEach(button => {
      button.classList.toggle('liked', nextState);
      button.setAttribute('aria-label', nextState ? 'Quitar de favoritos' : 'Agregar a favoritos');
      button.innerHTML = nextState ? Icons.heart : Icons.heartOutline;
    });

    // Persist to DB
    const session = typeof Auth !== 'undefined' && Auth.session ? Auth.session() : null;
    if (session?.dbUserId && typeof DB !== 'undefined' && DB.toggleFavorite) {
      DB.toggleFavorite(session.dbUserId, id).catch(err => {
        // Rollback on error
        console.warn('[Profile] Error al toggleFavorite:', err);
        if (nextState) state.liked.delete(id); else state.liked.add(id);
        document.querySelectorAll(`.like-btn[data-id="${id}"]`).forEach(button => {
          button.classList.toggle('liked', !nextState);
          button.innerHTML = !nextState ? Icons.heart : Icons.heartOutline;
        });
      });
    }
  }

  function isLiked(id) {
    return state.liked.has(id);
  }

  function open() {
    if (!Auth.isLoggedIn()) {
      Auth.openModal();
      return;
    }
    _hydrateState();
    void _loadTicketsFromDb();
    void _loadFavoritesFromDb();
    render();
    App.navigate('profile');
  }

  function render() {
    _hydrateState();
    if (_useDbTickets() && !state.ticketsHydrated && !state.ticketsLoading) {
      void _loadTicketsFromDb();
    }
    const session = Auth.session();
    const page = document.getElementById('page-profile');
    if (!page) return;

    const isOrganizer = session.role === 'organizer';
    const avatarIcon = Icons._icon('person', 36, '#fff');
    const roleLabels = {
      user: { label: `${Icons.ticket} Cliente`, cls: 'user' },
      organizer: { label: `${Icons.star} Organizador`, cls: 'organizer' },
      admin: { label: `${Icons.filter} Administrador`, cls: 'admin' },
      treasurer: { label: `${Icons.lock} Tesorero`, cls: 'admin' },
    };
    const roleInfo = roleLabels[session.role] || roleLabels.user;

    page.innerHTML = `
      <div class="profile-wrap">
        <div class="profile-header">
          <div class="profile-avatar">${avatarIcon}</div>
          <div class="profile-info">
            <div class="profile-name">${session.name}</div>
            <div id="profile-email-display" style="display:flex;align-items:center;gap:8px;margin-top:2px">
              <span class="profile-email" id="profile-email-text">${session.email}</span>
              <button style="font-size:.68rem;color:var(--color-blue);background:none;border:none;cursor:pointer;font-weight:600;padding:0;font-family:var(--font-body)"
                onclick="Profile.toggleEmailEdit()">Cambiar</button>
            </div>
            <div id="profile-email-edit" style="display:none;margin-top:6px">
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <input type="email" id="new-email-input"
                  style="background:rgba(0,0,0,.35);border:1px solid rgba(135,206,235,.3);border-radius:8px;padding:6px 10px;color:#fff;font-size:.8rem;outline:none;font-family:var(--font-body);width:220px;max-width:100%"
                  placeholder="${session.email}"/>
                <button style="font-size:.75rem;font-weight:600;padding:6px 14px;border-radius:50px;background:linear-gradient(90deg,var(--color-blue),var(--color-purple));color:#fff;border:none;cursor:pointer;font-family:var(--font-body)"
                  onclick="Profile.saveEmail()">Guardar</button>
                <button style="font-size:.75rem;color:var(--text-muted);background:none;border:none;cursor:pointer;font-family:var(--font-body)"
                  onclick="Profile.toggleEmailEdit()">Cancelar</button>
              </div>
            </div>
            <div class="profile-role-badge profile-role-badge--${roleInfo.cls}" style="margin-top:8px">
              ${roleInfo.label}
            </div>
          </div>
        </div>

        ${isOrganizer ? renderCardSection() : ''}
        ${renderFavorites()}
        ${renderTickets()}
        ${renderRecentReviews(session.name)}
      </div>`;

  }

  function renderCardSection() {
    const card = state.registeredCard;

    const warningHtml = !card ? `
      <div class="no-card-warning">
        <span><strong>Necesitas una cuenta registrada</strong> para poder recibir los depositos de tus ventas.</span>
      </div>` : '';

    const cardContent = card ? `
      <div class="registered-card">
        <div class="registered-card-left">
          <div class="card-chip"></div>
          <div>
            <div class="card-number">${card.last4}</div>
            <div class="card-brand">${card.brand} · ${card.holder}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span class="card-status-badge">Activa para Depositos</span>
          <button class="remove-card-btn" onclick="Profile.removeCard()">Eliminar</button>
        </div>
      </div>` : `
      <div class="add-card-form">
        <div class="add-card-title"><span style="display:inline-flex;vertical-align:middle;margin-right:6px"><span class="material-symbols-outlined" style="font-size:18px;vertical-align:middle;">account_balance</span></span> Cuenta Bancaria de Deposito</div>
        <div class="add-card-grid">
          <div class="add-card-full">
            <label class="profile-input-label">Clave CLABE Interbancaria (18 digitos)</label>
            <input class="profile-input" id="pc-num" type="text" placeholder="000 000 0000000000 0" maxlength="22" oninput="Profile.fmtCard(this)"/>
          </div>
          <div class="add-card-full">
            <label class="profile-input-label">Nombre del Titular de la Cuenta</label>
            <input class="profile-input" id="pc-name" type="text" placeholder="Como aparece en el banco"/>
          </div>
          <div class="add-card-full">
            <label class="profile-input-label">Banco</label>
            <input class="profile-input" id="pc-bank" type="text" placeholder="Ej. BBVA, Santander, Banorte"/>
          </div>
        </div>
        <button class="save-card-btn" onclick="Profile.saveCard()">
          <span style="display:inline-flex;vertical-align:bottom;margin-right:6px">${Icons.lock}</span> Guardar Cuenta Bancaria
        </button>
        <p style="font-size:.7rem;color:var(--text-muted);margin-top:8px;text-align:center">
          Tus datos se usan unicamente para transferir las ganancias de tus eventos.
        </p>
      </div>`;

    return `
      <div class="profile-section">
        <div class="profile-section-header">
          <div class="profile-section-title">
            <div class="profile-section-icon icon--amber"><span class="material-symbols-outlined" style="font-size:18px;color:inherit;vertical-align:middle;">account_balance</span></div>
            Datos para Depositos
          </div>
        </div>
        <div class="card-reg-wrap">
          ${warningHtml}
          ${cardContent}
        </div>
      </div>`;
  }

  function saveCard() {
    _hydrateState();
    const number = document.getElementById('pc-num')?.value.replace(/\s/g, '');
    const name = document.getElementById('pc-name')?.value.trim();
    const bank = document.getElementById('pc-bank')?.value.trim();

    if (number.length < 18 || !name || !bank) {
      alert('Por favor completa todos los campos de la cuenta interbancaria.');
      return;
    }

    state.registeredCard = {
      last4: `CLABE terminada en ${number.slice(-4)}`,
      brand: bank,
      holder: name,
    };

    _persistCard();
    render();
  }

  function removeCard() {
    _hydrateState();
    if (!confirm('¿Estas seguro de que deseas eliminar esta cuenta bancaria?')) return;
    state.registeredCard = null;
    _persistCard();
    render();
  }

  function hasCard() {
    _hydrateState();
    return !!state.registeredCard;
  }

  function fmtCard(input) {
    input.value = input.value.replace(/\D/g, '').slice(0, 18).replace(/(.{4})(?=\d)/g, '$1 ').trim();
  }

  function renderFavorites() {
    const likedIds = [...state.liked];
    const likedEvents = EVENTS.filter(event => likedIds.includes(event.id));

    const content = likedEvents.length
      ? `<div class="favorites-grid">
          ${likedEvents.map(event => `
            <div class="fav-card" onclick="Pages.openEvent('${event.id}')">
              <div class="fav-img"><img src="${event.image}" alt="${event.title}" loading="lazy"/></div>
              <div class="fav-info">
                <div class="fav-title">${event.title}</div>
                <div class="fav-artist">${event.artist}</div>
                <div class="fav-date">${new Date(event.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
              </div>
              <button class="fav-remove" onclick="event.stopPropagation(); Profile.toggleLike('${event.id}', this); Profile.render();" title="Quitar de favoritos">${Icons.close}</button>
            </div>`).join('')}
        </div>`
      : `<div class="profile-empty">
          <div class="profile-empty-icon">${Icons.heart}</div>
          <div>Aun no tienes eventos favoritos.</div>
          <div style="font-size:.78rem;margin-top:4px">Dale con el boton de corazon a los eventos que te gusten.</div>
        </div>`;

    return `
      <div class="profile-section">
        <div class="profile-section-header">
          <div class="profile-section-title">
            <div class="profile-section-icon icon--pink">${Icons.heart}</div>
            Mis Favoritos
          </div>
          <span style="font-size:.82rem;color:var(--text-muted)">${likedEvents.length} evento${likedEvents.length !== 1 ? 's' : ''}</span>
        </div>
        ${content}
      </div>`;
  }

  function renderTickets() {
    _hydrateState();
    const tickets = Auth.isLoggedIn() ? state.tickets : [];
    const loading = _useDbTickets() && state.ticketsLoading && !tickets.length;
    const error = state.ticketsError;

    const content = loading
      ? `<div class="profile-empty">
          <div class="profile-empty-icon">${Icons.ticket}</div>
          <div>Cargando tus boletos...</div>
          <div style="font-size:.78rem;margin-top:4px">Estamos consultando la base de datos.</div>
        </div>`
      : tickets.length
      ? `<div class="tickets-list">
          ${tickets.map(ticket => {
            const display = _ticketDisplayData(ticket);
            const eventDate = new Date(display.date);
            return `
              <div class="ticket-card" id="tc-${ticket.id}">
                <div class="ticket-top">
                  <div class="ticket-event-img">
                    <img src="${display.image}" alt="${display.title}" loading="lazy"/>
                  </div>
                  <div class="ticket-info">
                    <div class="ticket-event-name">${display.title}</div>
                    <div class="ticket-meta">
                      ${(display.venue || 'Lugar por confirmar')}${display.city ? `, ${display.city}` : ''}<br>
                      ${Number.isNaN(eventDate.getTime()) ? 'Fecha por confirmar' : eventDate.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                    <span class="ticket-price-tag">Pagado: $${Number(ticket.price || 0).toLocaleString()}</span>
                  </div>
                  <button class="ticket-qr-toggle" onclick="Profile.toggleQR('${ticket.id}')">
                    Ver QR
                  </button>
                </div>
                <div class="ticket-qr-section" id="qr-${ticket.id}">
                  <div class="qr-canvas-wrap">
                    <div class="ticket-qr-real" id="qrc-${ticket.id}"></div>
                  </div>
                  <div class="ticket-qr-info">
                    <div class="ticket-qr-code">${ticket.qrCode}</div>
                    <div class="ticket-qr-hint">Escanea este QR para abrir tu boleto con la informacion de compra.</div>
                    <div class="ticket-qr-actions">
                      <button class="ticket-link-btn" onclick="Profile.openTicket('${ticket.id}')">Abrir ticket</button>
                      <button class="ticket-link-btn ticket-link-btn--ghost" onclick="Profile.copyTicketLink('${ticket.id}')">Copiar enlace</button>
                    </div>
                    <div style="font-size:.7rem;color:var(--text-muted);margin-top:6px">
                      Comprado el ${new Date(ticket.purchaseDate).toLocaleDateString('es-ES')}
                    </div>
                  </div>
                </div>
              </div>`;
          }).join('')}
        </div>`
      : `<div class="profile-empty">
          <div class="profile-empty-icon">${Icons.ticket}</div>
          <div>Aun no tienes boletos.</div>
          <div style="font-size:.78rem;margin-top:4px">${error || 'Tus compras apareceran aqui con su codigo QR.'}</div>
        </div>`;

    return `
      <div class="profile-section">
        <div class="profile-section-header">
          <div class="profile-section-title">
            <div class="profile-section-icon icon--blue">${Icons.ticket}</div>
            Mis Boletos
          </div>
          <span style="font-size:.82rem;color:var(--text-muted)">${tickets.length} boleto${tickets.length !== 1 ? 's' : ''}</span>
        </div>
        ${content}
      </div>`;
  }

  function toggleQR(ticketId) {
    _hydrateState();
    const section = document.getElementById(`qr-${ticketId}`);
    const button = section?.previousElementSibling?.querySelector('.ticket-qr-toggle');
    if (!section) return;

    const opened = section.classList.toggle('open');
    if (button) button.textContent = opened ? 'Ocultar QR' : 'Ver QR';

    if (opened) {
      renderQRCode(ticketId);
    }
  }

  function renderQRCode(ticketId) {
    const wrap = document.getElementById(`qrc-${ticketId}`);
    const ticket = _findTicket(ticketId);
    if (!wrap || !ticket) return;

    const link = _buildTicketUrl(ticket);
    if (wrap.dataset.generated === link) return;

    wrap.innerHTML = '';

    if (typeof QRCode !== 'undefined') {
      new QRCode(wrap, {
        text: link,
        width: 148,
        height: 148,
        colorDark: '#0f172a',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M,
      });
    } else {
      wrap.innerHTML = `<div class="ticket-qr-fallback">No se pudo cargar la libreria del QR.<br/>Abre el ticket manualmente.</div>`;
    }

    wrap.dataset.generated = link;
  }

  function copyTicketLink(ticketId) {
    const ticket = _findTicket(ticketId);
    if (!ticket) return;

    const link = _buildTicketUrl(ticket);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link)
        .then(() => alert('Enlace del boleto copiado.'))
        .catch(() => alert(link));
      return;
    }

    alert(link);
  }

  function renderSharedTicket(payload) {
    const page = document.getElementById('page-ticket');
    if (!page) return false;

    if (!payload) {
      page.innerHTML = `
        <div class="ticket-page-wrap">
          <div class="ticket-page-card ticket-page-card--invalid">
            <div class="ticket-page-status ticket-page-status--invalid">Boleto no disponible</div>
            <h1 class="ticket-page-title">No pudimos abrir este ticket</h1>
            <p class="ticket-page-copy">El enlace del boleto no es valido o esta incompleto.</p>
            <div class="ticket-page-actions">
              <button class="ticket-page-btn" onclick="App.navigate('home')">Volver al inicio</button>
            </div>
          </div>
        </div>`;
      return true;
    }

    const event = _findEvent(payload.eventId);
    const eventTitle = payload.eventTitle || event?.title || 'Evento Ticketazo';
    const artist = payload.artist || event?.artist || 'Ticketazo';
    const venue = payload.venue || event?.venue || 'Venue por confirmar';
    const city = payload.city || event?.city || '';
    const ticketDate = payload.date || event?.date || '';
    const purchaseStatus = _ticketStatusLabel(payload.purchaseStatus, 'Aprobado');
    const accessStatus = _ticketStatusLabel(payload.accessStatus, 'Activo');
    const buyerName = payload.buyerName || _sessionIdentity().name;
    const buyerEmail = payload.buyerEmail || _sessionIdentity().email || 'No disponible';

    page.innerHTML = `
      <div class="ticket-page-wrap">
        <div class="ticket-page-card">
          <div class="ticket-page-body">
            <div class="ticket-page-brand">
              <div class="ticket-page-brand-left">
                <img src="assets/img/logo.png" alt="Ticketazo" class="ticket-page-logo"/>
                <div>
                  <div class="ticket-page-brand-name">Ticketazo</div>
                  <div class="ticket-page-brand-sub">Comprobante imprimible de acceso</div>
                </div>
              </div>
              <div class="ticket-page-brand-right">
                <div class="ticket-page-brand-meta">
                  Emitido: ${_formatShortDate(payload.purchaseDate)}
                </div>
                <button class="ticket-page-home-btn" onclick="App.navigate('home')">Volver al inicio</button>
              </div>
            </div>

            <div class="ticket-page-head">
              <div>
                <div class="ticket-page-kicker">Documento de acceso Ticketazo</div>
                <h1 class="ticket-page-title">${eventTitle}</h1>
                <p class="ticket-page-copy">${artist}</p>
              </div>
              <div class="ticket-page-statuses">
                <span class="ticket-page-status ticket-page-status--ok">Compra ${purchaseStatus}</span>
                <span class="ticket-page-status ticket-page-status--info">Acceso ${accessStatus}</span>
              </div>
            </div>

            <div class="ticket-page-doc-rule"></div>

            <div class="ticket-page-grid">
              <div class="ticket-page-item">
                <span>Codigo</span>
                <strong>${payload.code}</strong>
              </div>
              <div class="ticket-page-item">
                <span>Folio</span>
                <strong>${payload.purchaseRef}</strong>
              </div>
              <div class="ticket-page-item">
                <span>Fecha del evento</span>
                <strong>${_formatLongDate(ticketDate)}</strong>
              </div>
              <div class="ticket-page-item">
                <span>Lugar</span>
                <strong>${venue}${city ? `, ${city}` : ''}</strong>
              </div>
              <div class="ticket-page-item">
                <span>Comprador</span>
                <strong>${buyerName}</strong>
              </div>
              <div class="ticket-page-item">
                <span>Correo</span>
                <strong>${buyerEmail}</strong>
              </div>
              <div class="ticket-page-item">
                <span>Monto pagado</span>
                <strong>$${Number(payload.price || 0).toLocaleString()}</strong>
              </div>
              <div class="ticket-page-item">
                <span>Fecha de compra</span>
                <strong>${_formatShortDate(payload.purchaseDate)}</strong>
              </div>
            </div>

            <div class="ticket-page-note">
              Presenta este documento junto con el QR de tu compra. Para esta demo escolar, este ticket funciona como comprobante imprimible de acceso.
            </div>

            <div class="ticket-page-actions">
              <button class="ticket-page-btn ticket-page-btn--primary" onclick="window.print()">Imprimir ticket</button>
              <button class="ticket-page-btn" onclick="Profile.copyCurrentTicketLink()">Copiar enlace</button>
            </div>
          </div>
        </div>
      </div>`;

    return true;
  }

  function openTicket(ticketId) {
    const ticket = _findTicket(ticketId);
    if (!ticket) return;

    const link = _buildTicketUrl(ticket);
    history.replaceState({}, '', link);
    renderSharedTicket(_buildTicketPayload(ticket));
    App.navigate('ticket');
  }

  function copyCurrentTicketLink() {
    const link = window.location.href;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link)
        .then(() => alert('Enlace del ticket copiado.'))
        .catch(() => alert(link));
      return;
    }
    alert(link);
  }

  function closeSharedTicket() {
    App.navigate(Auth.isLoggedIn() ? 'profile' : 'home');
  }

  function maybeOpenSharedTicketFromUrl() {
    const url = new URL(window.location.href);
    const token = url.searchParams.get('ticket');
    if (!token) return false;

    const payload = _deserializeTicketPayload(token);
    renderSharedTicket(payload);
    App.navigate('ticket');
    return true;
  }

  function renderRecentReviews(userName) {
    const reviews = [];
    EVENTS.forEach(event => {
      const cache = Pages.getReviewsCache ? (Pages.getReviewsCache(event.id) || event.reviews || []) : (event.reviews || []);
      cache.forEach(review => {
        if (review.user === userName || review.user === 'Anonimo') {
          reviews.push({ ...review, eventId: event.id, eventTitle: event.title, eventImage: event.image });
        }
      });
    });

    const recent = reviews.slice(0, 5);
    const content = recent.length
      ? recent.map(review => `
          <div class="profile-review-card" onclick="Pages.openEvent('${review.eventId}')">
            <div class="profile-review-event-img">
              <img src="${review.eventImage}" alt="${review.eventTitle}" loading="lazy"/>
            </div>
            <div class="profile-review-body">
              <div class="profile-review-event">${review.eventTitle}</div>
              <div class="profile-review-stars">
                ${[1, 2, 3, 4, 5].map(index => `<span style="font-size:.72rem;color:${index <= review.rating ? '#facc15' : '#374151'}">${Icons.star}</span>`).join('')}
              </div>
              <div class="profile-review-text">${review.comment}</div>
              <div class="profile-review-date">${review.date}</div>
            </div>
          </div>`).join('')
      : `<div class="profile-empty">
          <div class="profile-empty-icon">${Icons.message}</div>
          <div>Aun no has escrito resenas.</div>
          <div style="font-size:.78rem;margin-top:4px">Tus resenas apareceran aqui.</div>
        </div>`;

    return `
      <div class="profile-section">
        <div class="profile-section-header">
          <div class="profile-section-title">
            <div class="profile-section-icon icon--purple">${Icons.message}</div>
            Mis Resenas Recientes
          </div>
          <span style="font-size:.82rem;color:var(--text-muted)">${recent.length} resena${recent.length !== 1 ? 's' : ''}</span>
        </div>
        ${content}
      </div>`;
  }

  function toggleEmailEdit() {
    const display = document.getElementById('profile-email-display');
    const edit = document.getElementById('profile-email-edit');
    if (!display || !edit) return;
    const opened = edit.style.display !== 'none';
    edit.style.display = opened ? 'none' : 'block';
    display.style.display = opened ? 'flex' : 'none';
  }

  function saveEmail() {
    const input = document.getElementById('new-email-input');
    if (!input) return;

    const newEmail = input.value.trim().toLowerCase();
    if (!newEmail) {
      input.style.borderColor = 'rgba(248,113,113,.5)';
      return;
    }

    const allowed = /\@(gmail|hotmail|outlook)\.com$/i.test(newEmail);
    if (!allowed) {
      input.style.borderColor = 'rgba(248,113,113,.5)';
      alert('Solo se permiten correos @gmail, @hotmail o @outlook.');
      return;
    }

    const session = Auth.session();
    session.email = newEmail;
    render();
  }

  function onSessionChanged() {
    _hydrateState(true);
    if (_useDbTickets()) {
      void _loadTicketsFromDb(true);
      void _loadFavoritesFromDb();
    }
  }

  return {
    open,
    render,
    onSessionChanged,
    toggleEmailEdit,
    saveEmail,
    toggleLike,
    isLiked,
    toggleQR,
    openTicket,
    copyTicketLink,
    copyCurrentTicketLink,
    closeSharedTicket,
    maybeOpenSharedTicketFromUrl,
    saveCard,
    removeCard,
    hasCard,
    fmtCard,
    addTickets,
    getTickets: () => {
      _hydrateState();
      return state.tickets.map(ticket => ({ ...ticket }));
    },
    getState: () => state,
  };
})();

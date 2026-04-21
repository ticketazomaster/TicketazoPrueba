window.Zones = (() => {
  const STORAGE_KEYS = {
    customEvents: 'ticketazo.custom-events.v1',
    ticketState: 'ticketazo.ticket-state.v3',
    heroSlides: 'ticketazo.hero-slides.v1',
  };

  const _state = {};
  let _customLoaded = false;
  let _liveSales = {};
  let _salesLoaded = false;
  let _salesLoading = null;
  let _salesError = '';
  let _skippedCard = false;

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

  function _fmt(date) {
    return new Date(date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function _slug(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32);
  }

  function _toast(message, type = 'success') {
    let toast = document.getElementById('_tz');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = '_tz';
      toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(40px);padding:8px 20px;border-radius:999px;font-size:.8rem;font-weight:600;z-index:9999;transition:all .25s;opacity:0;white-space:nowrap;pointer-events:none';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.background = type === 'success' ? 'rgba(134,239,172,.15)' : 'rgba(248,113,113,.15)';
    toast.style.border = `1px solid ${type === 'success' ? 'rgba(134,239,172,.3)' : 'rgba(248,113,113,.3)'}`;
    toast.style.color = type === 'success' ? '#16a34a' : '#ef4444';
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(40px)';
    }, 3000);
  }

  function _event(id) {
    return EVENTS.find(event => event.id === id) || null;
  }

  function _persistState() {
    _saveJSON(STORAGE_KEYS.ticketState, _state);
  }

  function _ensureArtistRecord(name, category, preferredId = '') {
    if (preferredId && ARTISTS.some(artist => artist.id === preferredId)) return preferredId;
    const normalized = String(name || '').trim().toLowerCase();
    const existing = ARTISTS.find(artist => artist.name.trim().toLowerCase() === normalized);
    if (existing) return existing.id;

    const id = preferredId || `artist-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    ARTISTS.push({
      id,
      name: String(name || 'Artista invitado').trim(),
      genre: category || 'Eventos en vivo',
      image: 'assets/img/logo.png',
      bio: 'Artista registrado desde el panel de Ticketazo.',
      isOnTour: true,
    });
    return id;
  }

  function _ensureCityRecord(city) {
    const normalized = String(city || '').trim();
    if (!normalized) return;
    if (!CITIES.includes(normalized)) {
      CITIES.push(normalized);
      CITIES.sort((left, right) => left.localeCompare(right, 'es'));
    }
  }

  function _customEvents() {
    return EVENTS.filter(event => event.__custom);
  }

  function _persistCustomEvents() {
    _saveJSON(STORAGE_KEYS.customEvents, _customEvents());
  }

  function _persistHeroSlides() {
    // Legacy localStorage fallback — BD is the primary store now
    _saveJSON(STORAGE_KEYS.heroSlides, HERO_SLIDES.map(slide => ({ ...slide })));
  }

  function _loadHeroSlides() {
    // Try localStorage as immediate cache while DB loads async
    const storedSlides = _loadJSON(STORAGE_KEYS.heroSlides, null);
    if (!Array.isArray(storedSlides) || !storedSlides.length) return;
    const normalized = storedSlides
      .filter(slide => slide?.eventId && _event(slide.eventId))
      .map(slide => ({ ...slide }));
    if (!normalized.length) return;
    HERO_SLIDES.splice(0, HERO_SLIDES.length, ...normalized);
  }

  async function _loadRealHeroSlides() {
    if (typeof DB === 'undefined' || !DB.fetchHeroSlides) return;
    try {
      const dbSlides = await DB.fetchHeroSlides();
      if (!dbSlides || !dbSlides.length) return;

      const slides = dbSlides.map(row => {
        const localId = row.eventId;
        const event = _event(localId);
        if (!event) return null;
        return {
          eventId: localId,
          title: row.title || event.title,
          sub: row.sub || `${event.artist} - ${event.city}`,
          cta: row.cta || `Ver ${event.title}`,
          image: event.image,
        };
      }).filter(Boolean);

      if (slides.length) {
        HERO_SLIDES.splice(0, HERO_SLIDES.length, ...slides);
        _persistHeroSlides();
        Carousel.refresh?.();
      }
    } catch (err) {
      console.warn('[Dashboard] No se pudieron cargar los slides del carrusel:', err);
    }
  }

  function _loadCustomEvents() {
    if (_customLoaded) return;
    const customEvents = _loadJSON(STORAGE_KEYS.customEvents, []);
    customEvents.forEach(event => {
      if (EVENTS.some(item => item.id === event.id)) return;
      EVENTS.push(event);
      _ensureCityRecord(event.city);
      event.artistId = _ensureArtistRecord(event.artist, event.category, event.artistId);
    });
    _customLoaded = true;
  }

  async function _loadRealSales(force = false) {
    if (_salesLoading && !force) return _salesLoading;
    if (_salesLoaded && !force) return _liveSales;

    if (typeof DB === 'undefined' || !DB.fetchEventSales) {
      _salesLoaded = true;
      _liveSales = Object.fromEntries(EVENTS.map(event => [event.id, { sold: 0, revenue: 0 }]));
      return _liveSales;
    }

    _salesError = '';
    _salesLoading = DB.fetchEventSales(EVENTS)
      .then(summary => {
        _liveSales = Object.fromEntries(EVENTS.map(event => {
          const sales = summary?.[event.id] || {};
          return [event.id, {
            sold: Number(sales.sold || 0),
            revenue: Number(sales.revenue || 0),
          }];
        }));
        _salesLoaded = true;
        if (document.getElementById('page-dashboard')?.classList.contains('active')) {
          _refreshPanels();
        }
        Pages.refreshCurrentEvent?.();
        return _liveSales;
      })
      .catch(err => {
        console.warn('[Dashboard] No se pudieron cargar las ventas reales:', err);
        _salesError = 'No pudimos sincronizar las ventas reales desde la base de datos.';
        _salesLoaded = false;
        _liveSales = {};
        if (document.getElementById('page-dashboard')?.classList.contains('active')) {
          _refreshPanels();
        }
        Pages.refreshCurrentEvent?.();
        return _liveSales;
      })
      .finally(() => {
        _salesLoading = null;
      });

    return _salesLoading;
  }

  function _eventUsesSeatMap(event) {
    return !!(event && (event.seatMapDbId || event.seatsioChartKey || event.seatsioEventKey));
  }

  async function _loadRealEvents() {
    if (typeof DB === 'undefined' || !DB.fetchAllEvents) return;
    try {
      const dbEvents = await DB.fetchAllEvents();
      if (!dbEvents || !dbEvents.length) return;
      let added = false;
      dbEvents.forEach(dbEvent => {
        if (!EVENTS.some(e => e.id === dbEvent.id)) {
          EVENTS.unshift(dbEvent);
          _ensureCityRecord(dbEvent.city);
          added = true;
        } else {
          // Sync organizer email if it exists
          const existing = EVENTS.find(e => e.id === dbEvent.id);
          if (existing) {
            if (dbEvent.organizerId && !existing.organizerId) {
              existing.organizerId = dbEvent.organizerId;
            }
            // Sync price from DB if available (overrides localStorage)
            if (dbEvent.ticketPrice > 0) {
              existing.ticketPrice = dbEvent.ticketPrice;
              if (_state[existing.id]) {
                _state[existing.id].price = dbEvent.ticketPrice;
              }
            }
            if (dbEvent.ticketCapacity > 0) {
              const cap = Number(dbEvent.ticketCapacity);
              existing.ticketCapacity = cap;
              if (_state[existing.id]) {
                _state[existing.id].capacity = cap;
              }
            }
          }
        }
      });
      if (added) {
        EVENTS.forEach(event => {
          if (!_state[event.id]) {
            // Use ticketPrice from DB event directly (no localStorage fallback)
            const baseCap = Number(event.ticketCapacity ?? 0);
            _state[event.id] = {
              price: Number(event.ticketPrice ?? 0),
              capacity: baseCap,
            };
          }
        });
        _persistState();
        if (typeof Grid !== 'undefined' && Grid.build) Grid.build();
        if (document.getElementById('page-dashboard')?.classList.contains('active')) {
          _refreshPanels();
        }
      } else {
        // Even if nothing was added, rebuild grid so prices show correctly
        _persistState();
        if (typeof Grid !== 'undefined' && Grid.build) Grid.build();
        if (document.getElementById('page-dashboard')?.classList.contains('active')) {
          _refreshPanels();
        }
      }
    } catch (err) {
      console.warn('[Dashboard] Fallo al sincronizar eventos reales:', err);
    }
  }

  function init() {
    _loadCustomEvents();
    _loadHeroSlides(); // Load from local cache immediately
    void _loadRealHeroSlides(); // Then sync from BD
    const storedState = _loadJSON(STORAGE_KEYS.ticketState, {});
    EVENTS.forEach(event => {
      const current = storedState[event.id] || _state[event.id] || {};
      const baseCap = Number(current.capacity ?? event.ticketCapacity ?? 0);
      _state[event.id] = {
        price: Number(current.price ?? event.ticketPrice ?? 0),
        capacity: baseCap,
        prices: current.prices || event.prices || null,
        status: current.status ?? event.status ?? 'active',
      };
      event.status = _state[event.id].status;
      if (_state[event.id].prices) event.prices = _state[event.id].prices;
    });
    _persistState();
    void _loadRealEvents().then(() => _loadRealSales(true));
  }

  function getTicketConfig(id) {
    const event = _event(id);
    const current = _state[id] || {};
    const seated = _eventUsesSeatMap(event);
    const gaPrice = Number(
      (event?.prices && event.prices.GA != null)
        ? event.prices.GA
        : (current.price ?? event?.ticketPrice ?? 0),
    );
    const cap = Number(current.capacity ?? event?.ticketCapacity ?? 0);
    return {
      price: gaPrice,
      capacity: cap,
    };
  }

  function getStatus() {
    return 'approved';
  }

  function getMinPrice(id) {
    return getTicketConfig(id).price;
  }

  function getPending() {
    return [];
  }

  function getSoldCount(id) {
    if (_salesError || !_salesLoaded) return null;
    return Number(_liveSales[id]?.sold || 0);
  }

  function getRevenue(id) {
    if (_salesError || !_salesLoaded) return null;
    return Number(_liveSales[id]?.revenue || 0);
  }

  function getRemainingCapacity(id) {
    const config = getTicketConfig(id);
    const sold = getSoldCount(id);
    if (!Number.isFinite(sold)) return null;
    return Math.max(config.capacity - sold, 0);
  }

  function _numberLabel(value) {
    return Number.isFinite(value) ? value.toLocaleString() : '--';
  }

  function _moneyLabel(value) {
    return Number.isFinite(value) ? `$${value.toLocaleString()}` : '--';
  }

  function _salesNote() {
    if (_salesError) {
      return `<div class="db-inline-note db-inline-note--error">${_salesError}</div>`;
    }
    if (_salesLoaded) {
      return `<div class="db-inline-note">Datos sincronizados con compras reales.</div>`;
    }
    return `<div class="db-inline-note">Sincronizando compras reales...</div>`;
  }

  function _tabs(role) {
    if (role === 'admin') {
      return [
        { key: 'promote', label: 'Promocionar Evento', icon: Icons._icon('campaign', 18) },
        { key: 'approve', label: 'Aprobar Eventos', icon: Icons._icon('check_circle', 18) },
        { key: 'commissions', label: 'Comisiones', icon: Icons._icon('percent', 18) },
        { key: 'reports', label: 'Reportes', icon: Icons.chart },
      ];
    }
    if (role === 'treasurer') {
      return [
        { key: 'sales', label: 'Ventas por Evento', icon: Icons.chart },
        { key: 'payouts', label: 'Pagos a Organizadores', icon: Icons.card },
      ];
    }
    return [
      { key: 'events', label: 'Mis Eventos', icon: Icons.ticket },
      { key: 'new', label: 'Crear Evento', icon: Icons._icon('add_circle', 18) },
    ];
  }

  function _buildNav() {
    const nav = document.getElementById('db-nav');
    if (!nav) return [];
    const tabs = _tabs(Auth.session().role);
    nav.innerHTML = tabs.map((tab, index) => `
      <button class="db-nav-btn${index === 0 ? ' active' : ''}" id="tab-${tab.key}" onclick="Zones.switchTab('${tab.key}', this)">
        <span class="db-nav-icon">${tab.icon}</span>
        <span class="db-nav-label">${tab.label}</span>
      </button>`).join('');
    document.querySelectorAll('.db-panel').forEach(panel => {
      panel.classList.remove('active');
      panel.innerHTML = '';
    });
    return tabs;
  }

  function _buildUser() {
    const element = document.getElementById('db-user-block');
    if (!element) return;
    const session = Auth.session();
    const label = { organizer: 'Organizador', treasurer: 'Tesorero', admin: 'Administrador' }[session.role] || session.role;
    element.innerHTML = `
      <div class="db-user-profile">
        <div class="db-user-avatar"><span class="material-symbols-outlined" style="font-size:24px;">person</span></div>
        <div class="db-user-info">
          <div class="db-user-name">${session.name}</div>
          <div class="db-user-role">${label}</div>
        </div>
      </div>
      <div class="db-user-actions">
        <button class="db-user-action-btn" onclick="Profile.open()"><span class="material-symbols-outlined" style="font-size:18px;">manage_accounts</span> Mi Cuenta</button>
        <button class="db-user-action-btn" style="color:#f87171;" onclick="Auth.logout()"><span class="material-symbols-outlined" style="font-size:18px;">logout</span> Cerrar Sesion</button>
      </div>`;
  }

  function _panelTitle(key) {
    return {
      overview: 'Resumen General',
      events: 'Eventos',
      new: 'Crear Evento',
      promote: 'Promocionar Evento',
      sales: 'Ventas por Evento',
      payouts: 'Pagos a Organizadores',
      approve: 'Aprobar Eventos',
      commissions: 'Definir Comisiones',
      reports: 'Generar Reportes',
    }[key] || 'Panel de Control';
  }

  function _panelContent(key) {
    return {
      overview: _renderOverview,
      events: _renderEvents,
      new: _renderCreateForm,
      promote: _renderPromote,
      sales: _renderSales,
      payouts: _renderPayouts,
      approve: _renderApprove,
      commissions: _renderCommissions,
      reports: _renderReports,
    }[key]?.() || '';
  }

  function _activatePanel(key) {
    if (!key) return;
    document.querySelectorAll('.db-panel').forEach(panel => panel.classList.remove('active'));
    const panel = document.getElementById(`panel-${key}`);
    if (!panel) return;
    panel.classList.add('active');
    panel.innerHTML = _panelContent(key);
    const title = document.getElementById('db-topbar-title');
    if (title) title.textContent = _panelTitle(key);
    if (key === 'new' && typeof SeatsioMaps !== 'undefined' && SeatsioMaps.initCreateForm) {
      requestAnimationFrame(() => SeatsioMaps.initCreateForm());
    }
  }

  function switchTab(key, button) {
    document.querySelectorAll('.db-nav-btn').forEach(item => item.classList.remove('active'));
    if (button) button.classList.add('active');
    _activatePanel(key);
    if (window.innerWidth <= 900) closeSidebar();

    if (['events', 'sales', 'overview', 'payouts'].includes(key)) {
      void _loadRealEvents().then(() => _loadRealSales(true));
    }
  }

  function openDashboard() {
    if (!Auth.isLoggedIn()) {
      Auth.openModal();
      return;
    }
    const role = Auth.session().role;
    if (!['organizer', 'treasurer', 'admin'].includes(role)) {
      alert('No tienes acceso a este panel.');
      return;
    }
    init();
    const tabs = _buildNav();
    _buildUser();
    closeSidebar();
    App.navigate('dashboard');
    requestAnimationFrame(() => _activatePanel(tabs[0]?.key));
  }

  function openSidebar() {
    if (window.innerWidth > 900) return;
    document.getElementById('db-sidebar')?.classList.add('open');
    document.getElementById('db-overlay')?.classList.add('open');
  }

  function closeSidebar() {
    document.getElementById('db-sidebar')?.classList.remove('open');
    document.getElementById('db-overlay')?.classList.remove('open');
  }

  function _ownerEvents() {
    return Auth.session().role === 'admin'
      ? EVENTS
      : EVENTS.filter(event => event.organizerId === Auth.session().email);
  }

  function _manageCard(event) {
    const config = getTicketConfig(event.id);
    const sold = getSoldCount(event.id);
    const remaining = getRemainingCapacity(event.id);
    return `
      <div class="db-card db-manage-card">
        <div class="db-card-head">
          <div style="display:flex;align-items:center;gap:12px;min-width:0;flex:1">
            <img src="${event.image}" alt="${event.title}" style="width:56px;height:56px;border-radius:10px;object-fit:cover"/>
            <div style="min-width:0">
              <div class="db-card-title">${event.title}</div>
              <div style="font-size:.78rem;color:#64748b;margin-top:4px">${event.city} · ${_fmt(event.date)}</div>
            </div>
          </div>
          ${event.status === 'pending' ? '<span class="db-badge pending">En Revisión</span>' : (event.status === 'rejected' ? '<span class="db-badge rejected">Rechazado</span>' : '<span class="db-badge approved">Publicado</span>')}
        </div>
        <div class="db-card-body">
          <div class="db-manage-grid">
            <div class="db-field"><label class="db-label">Precio del boleto</label><input class="db-input" type="number" min="0" value="${config.price}" oninput="Zones.setTicketField('${event.id}','price',this.value)"/></div>
            <div class="db-field"><label class="db-label">Capacidad disponible</label><input class="db-input" type="number" min="1" value="${config.capacity}" oninput="Zones.setTicketField('${event.id}','capacity',this.value)"/></div>
          </div>
          <div class="db-manage-metrics">
            <div class="db-manage-metric"><span>Vendidos reales</span><strong>${_numberLabel(sold)}</strong></div>
            <div class="db-manage-metric"><span>Disponibles</span><strong>${_numberLabel(remaining)}</strong></div>
          </div>
          <div class="db-manage-actions" style="display:flex;gap:8px;">
            <button class="db-btn db-btn-secondary" style="color:#2563eb;border-color:#2563eb;background:rgba(37,99,235,.05);display:flex;align-items:center;gap:4px;padding:8px 12px" title="Ver evento" onclick="Pages.openEvent('${event.id}')"><span class="material-symbols-outlined" style="font-size:18px">visibility</span></button>
            <button class="db-btn db-btn-primary" style="flex:1" onclick="Zones.saveTicketConfig('${event.id}')">Guardar</button>
            <button class="db-btn db-btn-secondary" style="color:#ef4444;border-color:transparent;background:rgba(239,68,68,.1);padding:8px 12px" title="Borrar evento" onclick="Zones.deleteEvent('${event.id}')"><span class="material-symbols-outlined" style="font-size:18px">delete</span></button>
          </div>
        </div>
      </div>`;
  }

  function _renderEvents() {
    const events = _ownerEvents();
    const totals = events.reduce((acc, event) => {
      const config = getTicketConfig(event.id);
      const sold = getSoldCount(event.id);
      const revenue = getRevenue(event.id);
      acc.capacity += config.capacity;
      acc.sold += Number.isFinite(sold) ? sold : 0;
      acc.revenue += Number.isFinite(revenue) ? revenue : 0;
      return acc;
    }, { capacity: 0, sold: 0, revenue: 0 });

    return `
      <div class="db-page-header"><div><h1>${Auth.session().role === 'admin' ? 'Todos los Eventos' : 'Mis Eventos'}</h1><p>Administra tus eventos y monitorea su estado.</p>${_salesNote()}</div></div>
      <div class="db-stats">
        <div class="db-stat blue"><div class="db-stat-icon">${Icons._icon('event', 24)}</div><div><div class="db-stat-label">Eventos</div><div class="db-stat-value">${events.length}</div></div></div>
        <div class="db-stat green"><div class="db-stat-icon">${Icons._icon('confirmation_number', 24)}</div><div><div class="db-stat-label">Vendidos</div><div class="db-stat-value">${_salesLoaded ? totals.sold.toLocaleString() : '--'}</div></div></div>
        <div class="db-stat purple"><div class="db-stat-icon">${Icons._icon('inventory', 24)}</div><div><div class="db-stat-label">Capacidad</div><div class="db-stat-value">${totals.capacity.toLocaleString()}</div></div></div>
        <div class="db-stat pink"><div class="db-stat-icon">${Icons._icon('attach_money', 24)}</div><div><div class="db-stat-label">Ingresos</div><div class="db-stat-value">${_salesLoaded ? _moneyLabel(totals.revenue) : '--'}</div></div></div>
      </div>
      ${events.length ? events.map(event => _manageCard(event)).join('') : `<div class="db-empty"><div class="db-empty-icon"></div><div class="db-empty-text">Aun no tienes eventos creados.</div></div>`}`;
  }

  function _renderCreateForm() {
    // Check original account bank was removed so organizer can bypass check directly
    /*
    if (Auth.session().role === 'organizer' && !Profile.hasCard() && !_skippedCard) {
      return \`
        <div class="db-card" style="text-align:center;padding:40px 20px;">
          <div style="font-size:3rem;margin-bottom:16px;"><span class="material-symbols-outlined" style="font-size:48px;color:#ca8a04;">account_balance</span></div>
          <div style="font-weight:700;font-size:1.1rem;color:#1e293b;margin-bottom:8px;">Se requiere cuenta bancaria</div>
          <div style="font-size:0.88rem;color:#64748b;margin-bottom:20px;max-width:420px;margin-left:auto;margin-right:auto;">Para crear y publicar eventos, primero debes registrar tu CLABE en tu perfil.</div>
          <button class="db-btn db-btn-primary" onclick="Profile.open()">Registrar Cuenta Bancaria</button>
          <button class="db-btn db-btn-secondary" style="margin-top: 12px; display: block; margin-left: auto; margin-right: auto;" onclick="Zones.skipCardRegistration()">Saltar registro (prueba)</button>
        </div>\`;
    }
    */

    return `
      <div class="db-page-header"><div><h1>Crear Nuevo Evento</h1><p>Tu evento será revisado por un administrador antes de publicarse.</p></div></div>
      <div class="db-card"><div class="db-card-head"><div class="db-card-title">Informacion General</div></div><div class="db-card-body">
        <div class="db-grid2">
          <div class="db-field"><label class="db-label">Nombre del Evento</label><input class="db-input" id="db-new-title" type="text" placeholder="Ej. Gran Premio de F1"/></div>
          <div class="db-field"><label class="db-label">Artista / Organizador Principal</label><input class="db-input" id="db-new-artist" type="text" placeholder="Nombre del artista o franquicia"/></div>
          <div class="db-field"><label class="db-label">Nombre de Gira</label><input class="db-input" id="db-new-tour" type="text" placeholder="Opcional"/></div>
          <div class="db-field"><label class="db-label">Categoria</label><select class="db-select" id="db-new-category"><option value="">Selecciona...</option>${CATEGORIES.filter(category => category !== 'Todos').map(category => `<option>${category}</option>`).join('')}</select></div>
          <div class="db-field"><label class="db-label">Fecha</label><input class="db-input" id="db-new-date" type="date"/></div>
          <div class="db-field"><label class="db-label">Hora</label><input class="db-input" id="db-new-time" type="time" value="20:00"/></div>
          <div class="db-field"><label class="db-label">Ciudad</label><input class="db-input" id="db-new-city" type="text" placeholder="Ciudad"/></div>
          <div class="db-field"><label class="db-label">Recinto</label><input class="db-input" id="db-new-venue" type="text" placeholder="Ej. Autodromo Hermanos Rodriguez"/></div>
        </div>
      </div></div>
      <div class="db-card"><div class="db-card-head"><div class="db-card-title">Imagen Promocional</div></div><div class="db-card-body">
        <div class="db-upload" id="db-upload-area" onclick="document.getElementById('db-file-input').click()" ondragover="event.preventDefault(); this.classList.add('dragover')" ondragleave="this.classList.remove('dragover')" ondrop="Zones.handleDrop(event, this)">
          <input type="file" id="db-file-input" style="display:none" accept="image/*" onchange="Zones.handleFileSelect(this, document.getElementById('db-upload-area'))"/>
          <div class="db-upload-icon">${Icons._icon('cloud_upload', 40)}</div>
          <div class="db-upload-text">Arrastra o haz clic para subir imagen</div>
          <div class="db-upload-hint">JPG, PNG, WEBP · Max. 10 MB</div>
        </div>
      </div></div>
      <div class="db-card"><div class="db-card-head db-create-ticket-head"><div class="db-card-title">${Icons.ticket} Boletaje</div><span class="db-create-ticket-note" id="db-create-ticket-note">Capacidad total compartida y precios por tipo de boleto.</span></div><div class="db-card-body">
        <div class="db-grid2">
          <div class="db-field"><label class="db-label">Precio General / GA (obligatorio)</label><input class="db-input" id="db-new-price-ga" type="number" min="1" placeholder="Ej. 500"/></div>
          <div id="db-extra-tier-fields" class="db-grid2" style="grid-column:1/-1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px">
            <div class="db-field"><label class="db-label">Precio VIP (Opcional)</label><input class="db-input" id="db-new-price-vip" type="number" min="0" placeholder="Ej. 1200"/></div>
            <div class="db-field"><label class="db-label">Precio PLATINUM (Opcional)</label><input class="db-input" id="db-new-price-plat" type="number" min="0" placeholder="Ej. 2500"/></div>
          </div>
          <div id="db-capacity-field" class="db-field" style="grid-column:1/-1"><label class="db-label">Capacidad total <span style="font-weight:400;color:#94a3b8">(con mapa: número de asientos del plano)</span></label><input class="db-input" id="db-new-capacity" type="number" min="0" placeholder="Ej. 1200 (0 = sin límite fijo)"/></div>
        </div>
      </div></div>
      <div class="db-card"><div class="db-card-head"><div class="db-card-title">Mapa de asientos (seats.io)</div></div><div class="db-card-body">
        <p style="font-size:.8rem;color:#64748b;margin:0 0 12px 0">Opcional: vincula un plano de seats.io o deja solo capacidad general.</p>
        <label class="db-radio-row"><input type="radio" name="db-seat-map-mode" value="none" checked/><span>Sin mapa numerado (solo capacidad general)</span></label>
        <label class="db-radio-row"><input type="radio" name="db-seat-map-mode" value="existing"/><span>Usar un mapa guardado</span></label>
        <label class="db-radio-row"><input type="radio" name="db-seat-map-mode" value="new"/><span>Crear mapa nuevo en el diseñador</span></label>
        <input type="hidden" id="db-seat-map-db-id" value="" />
        <div id="db-seat-map-existing-wrap" class="hidden" style="margin-top:14px">
          <div class="db-field">
            <label class="db-label">Tus mapas guardados</label>
            <select class="db-select" id="db-seat-map-existing"></select>
          </div>
        </div>
        <div id="db-seat-map-new-wrap" class="hidden" style="margin-top:14px">
          <button type="button" class="db-btn db-btn-secondary" onclick="SeatsioMaps.openDesigner()">Abrir diseñador embebido</button>
          <p style="margin-top:10px;font-size:.78rem;color:#64748b;line-height:1.45">Abre el diseñador, edita y al terminar presiona <strong>Publicar ahora</strong> para publicar en seats.io y guardar el mapa en Ticketazo. Requiere la función Edge <code>seatsio-publish</code> en Supabase.</p>
          <p id="db-seat-map-new-status" class="hidden" style="margin-top:10px;font-size:.8rem;color:#16a34a;font-weight:600"></p>
        </div>
      </div></div>
      <div class="db-card"><div class="db-card-head"><div class="db-card-title">Descripcion</div></div><div class="db-card-body"><textarea class="db-textarea" id="db-new-about" rows="4" placeholder="Describe el evento..."></textarea></div></div>
      <div class="db-create-actions"><button class="db-btn db-btn-secondary" onclick="Zones.resetCreateForm()">Limpiar</button><button class="db-btn db-btn-primary" id="db-create-submit" onclick="Zones.createEvent()">${Auth.session().role === 'admin' ? 'Publicar evento' : 'Solicitar Publicación'}</button></div>`;
  }

  function _renderSales() {
    const rows = EVENTS.filter(event => event.status === 'active')
      .map(event => {
        const config = getTicketConfig(event.id);
        const sold = getSoldCount(event.id);
        const revenue = getRevenue(event.id);
        const averagePrice = Number.isFinite(sold) && sold > 0 ? revenue / sold : config.price;
        return { ...event, price: averagePrice, capacity: config.capacity, sold, revenue };
      })
      .sort((left, right) => (Number(right.revenue || 0) - Number(left.revenue || 0)));
    const totalRevenue = rows.reduce((sum, row) => sum + (Number.isFinite(row.revenue) ? row.revenue : 0), 0);
    const totalSold = rows.reduce((sum, row) => sum + (Number.isFinite(row.sold) ? row.sold : 0), 0);
    return `
      <div class="db-page-header"><div><h1>Ventas por Evento</h1><p>Resumen basado en compras reales registradas en la base de datos.</p>${_salesNote()}</div></div>
      <div class="db-stats">
        <div class="db-stat blue"><div class="db-stat-icon">${Icons._icon('confirmation_number', 24)}</div><div><div class="db-stat-label">Boletos vendidos</div><div class="db-stat-value">${_salesLoaded ? totalSold.toLocaleString() : '--'}</div></div></div>
        <div class="db-stat green"><div class="db-stat-icon">${Icons._icon('attach_money', 24)}</div><div><div class="db-stat-label">Ingresos</div><div class="db-stat-value">${_salesLoaded ? _moneyLabel(totalRevenue) : '--'}</div></div></div>
        <div class="db-stat purple"><div class="db-stat-icon">${Icons._icon('inventory', 24)}</div><div><div class="db-stat-label">Eventos activos</div><div class="db-stat-value">${rows.length}</div></div></div>
      </div>
      <div class="db-card"><div class="db-table-wrap"><table class="db-table"><thead><tr><th>Evento</th><th>GA</th><th>VIP</th><th>PLATINUM</th><th>Capacidad</th><th>Vendidos</th><th>Ingresos</th></tr></thead><tbody>
        ${rows.map(row => {
          const p = row.prices || {};
          const ga       = p.GA       != null ? `$${Number(p.GA).toLocaleString()}`       : (row.ticketPrice ? `$${Number(row.ticketPrice).toLocaleString()}` : '--');
          const vip      = p.VIP      != null ? `$${Number(p.VIP).toLocaleString()}`      : '<span style="color:#94a3b8">--</span>';
          const platinum = p.PLATINUM != null ? `$${Number(p.PLATINUM).toLocaleString()}` : '<span style="color:#94a3b8">--</span>';
          return `<tr>
            <td><div style="font-weight:700">${row.title}</div><div style="font-size:.72rem;color:#64748b">${row.city}</div></td>
            <td style="font-weight:600">${ga}</td>
            <td>${vip}</td>
            <td>${platinum}</td>
            <td>${row.capacity.toLocaleString()}</td>
            <td>${_numberLabel(row.sold)}</td>
            <td style="font-weight:700">${_moneyLabel(row.revenue)}</td>
          </tr>`;
        }).join('')}
      </tbody></table></div></div>`;
  }

  function _renderPromote() {
    const active = EVENTS.filter(event => event.status === 'active');
    return `
      <div class="db-page-header"><div><h1>Promocionar Evento</h1><p>Elige un evento para destacarlo en el carrusel del inicio.</p></div></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px">
        ${active.map(event => {
          const featured = HERO_SLIDES.some(slide => slide.eventId === event.id);
          return `<div style="background:#fff;border:1px solid ${featured ? 'rgba(138,43,226,.4)' : '#e2e8f0'};border-radius:14px;overflow:hidden;${featured ? 'box-shadow:0 0 0 2px rgba(138,43,226,.2)' : ''}"><div style="position:relative;height:130px;overflow:hidden"><img src="${event.image}" alt="${event.title}" style="width:100%;height:100%;object-fit:cover"/>${featured ? '<div style="position:absolute;top:8px;right:8px;background:rgba(138,43,226,.9);color:#fff;font-size:.65rem;font-weight:700;padding:3px 9px;border-radius:999px">En carrusel</div>' : ''}</div><div style="padding:12px"><div style="font-size:.8rem;font-weight:700;color:#0f172a;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${event.title}</div><div style="font-size:.7rem;color:#64748b;margin-bottom:10px">${event.artist} · ${event.city}</div>${featured ? `<button class="db-btn db-btn-secondary" style="width:100%;font-size:.75rem;color:#ef4444;border-color:#fca5a5;background:rgba(239,68,68,.05)" onclick="Zones.demoteFromCarousel('${event.id}')">Quitar del Carrusel</button>` : `<button class="db-btn db-btn-primary" style="width:100%;font-size:.75rem" onclick="Zones.promoteToCarousel('${event.id}')">Promocionar</button>`}</div></div>`;
        }).join('')}
      </div>`;
  }

  function _bankInfo(email) {
    return {
      'eber.higuera@gmail.com': { name: 'Eber Higuera', bankName: 'BBVA', clabe: '012 180 01534007821 9' },
      'other.organizer@gmail.com': { name: 'Compania Teatral Elite', bankName: 'Santander', clabe: '014 180 00000000930 2' },
    }[email] || { name: email, bankName: 'Banco pendiente', clabe: 'Sin CLABE registrada' };
  }

  function _renderPayouts() {
    const currentCommission = Math.max(0, _loadJSON('ticketazo.commission', 5));
    const commMultiplier = currentCommission / 100;
    const events = EVENTS.filter(event => event.status === 'active');

    return `
      <div class="db-page-header"><div><h1>Pagos a Organizadores</h1><p>Consulta la informacion bancaria y distribuye ingresos reales.</p>${_salesNote()}</div></div>
      ${events.map(event => {
        const email = event.organizerId || 'sin-organizador@ticketazo.mx';
        const gross = getRevenue(event.id) || 0;
        const fee = Math.round(gross * commMultiplier);
        const payout = gross - fee;

        return `<div class="db-card db-payout-card">
          <div class="db-card-head db-payout-head">
            <div class="db-payout-profile">
              <div class="db-payout-avatar">${Icons._icon('person', 24)}</div>
              <div class="db-payout-meta">
                <div class="db-card-title">${event.title}</div>
                <div class="db-payout-email">Organizador: ${email}</div>
              </div>
            </div>
          </div>
          <div class="db-card-body">
            <div class="db-payout-stats">
              <div class="db-stat blue">
                <div class="db-stat-icon">${Icons._icon('account_balance', 22)}</div>
                <div>
                  <div class="db-stat-label">Ingresos Brutos</div>
                  <div class="db-stat-value">${_salesLoaded ? _moneyLabel(gross) : '--'}</div>
                </div>
              </div>
              <div class="db-stat pink">
                <div class="db-stat-icon">%</div>
                <div>
                  <div class="db-stat-label">Comision ${currentCommission}%</div>
                  <div class="db-stat-value db-payout-minus">${_salesLoaded ? `-${_moneyLabel(fee)}` : '--'}</div>
                </div>
              </div>
              <div class="db-stat green">
                <div class="db-stat-icon">${Icons._icon('wallet', 22)}</div>
                <div>
                  <div class="db-stat-label">A Transferir</div>
                  <div class="db-stat-value db-payout-plus">${_salesLoaded ? _moneyLabel(payout) : '--'}</div>
                </div>
              </div>
            </div>
          </div>
        </div>`;
      }).join('')}`;
  }

  function _renderOverview() {
    const activeEvents = EVENTS.filter(event => event.status === 'active');
    const sold = activeEvents.reduce((sum, event) => sum + (Number.isFinite(getSoldCount(event.id)) ? getSoldCount(event.id) : 0), 0);
    const projected = activeEvents.reduce((sum, event) => sum + (Number.isFinite(getRevenue(event.id)) ? getRevenue(event.id) : 0), 0);
    const organizers = new Set(activeEvents.map(event => event.organizerId).filter(Boolean)).size;
    return `
      <div class="db-page-header"><div><h1>Centro de Control</h1><p>Gestión de tus eventos y boletería.</p>${_salesNote()}</div><div style="background:rgba(138,43,226,.08);color:#8A2BE2;padding:6px 14px;border-radius:9px;font-size:.78rem;font-weight:700;border:1px solid rgba(138,43,226,.15)">Operativa</div></div>
      <div class="db-stats">
        <div class="db-stat blue"><div class="db-stat-icon">${Icons._icon('event', 24)}</div><div><div class="db-stat-label">Eventos activos</div><div class="db-stat-value">${activeEvents.length}</div></div></div>
        <div class="db-stat purple"><div class="db-stat-icon">${Icons._icon('groups', 24)}</div><div><div class="db-stat-label">Organizadores</div><div class="db-stat-value">${organizers}</div></div></div>
        <div class="db-stat green"><div class="db-stat-icon">${Icons._icon('confirmation_number', 24)}</div><div><div class="db-stat-label">Vendidos</div><div class="db-stat-value">${_salesLoaded ? sold.toLocaleString() : '--'}</div></div></div>
        <div class="db-stat pink"><div class="db-stat-icon">${Icons._icon('attach_money', 24)}</div><div><div class="db-stat-label">Ingresos</div><div class="db-stat-value">${_salesLoaded ? _moneyLabel(projected) : '--'}</div></div></div>
      </div>
      <div class="db-card"><div class="db-card-head"><div class="db-card-title">Ultimos eventos publicados</div></div><div class="db-card-body">
        ${activeEvents.slice().sort((left, right) => new Date(right.date) - new Date(left.date)).slice(0, 5).map(event => `<div style="display:flex;align-items:center;justify-content:space-between;padding:11px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:9px;margin-bottom:7px;flex-wrap:wrap;gap:7px"><div style="display:flex;align-items:center;gap:9px"><img src="${event.image}" style="width:36px;height:36px;border-radius:7px;object-fit:cover"/><div><div style="font-size:.82rem;font-weight:600;color:#0f172a">${event.title}</div><div style="font-size:.7rem;color:#64748b">${event.organizerId || 'Sin organizador'}</div></div></div><span class="db-badge ${event.status === 'pending' ? 'pending' : (event.status === 'rejected' ? 'rejected' : 'approved')}">${event.status === 'pending' ? 'En Revisión' : (event.status === 'rejected' ? 'Rechazado' : 'Publicado')}</span></div>`).join('') || `<div class="db-empty"><div class="db-empty-icon"></div><div class="db-empty-text">Sin eventos cargados.</div></div>`}
      </div></div>`;
  }

  function setTicketField(id, field, value) {
    if (!_state[id]) init();
    _state[id][field] = Math.max(field === 'capacity' ? 1 : 0, Number(value || 0));
    _persistState();
  }

  async function saveTicketConfig(id) {
    const event = _event(id);
    const state = _state[id];
    if (!event || !state || state.price <= 0 || state.capacity <= 0) {
      alert('Completa un precio valido y una capacidad mayor a cero.');
      return;
    }

    event.ticketPrice = Number(state.price);
    event.ticketCapacity = Number(state.capacity);
    _persistState();
    if (event.__custom) {
      _persistCustomEvents();
    }
    try {
      if (typeof DB !== 'undefined' && DB.saveEventRecord) {
        await DB.saveEventRecord(event);
      }
    } catch (err) {
      console.warn('[Dashboard] No se pudo sincronizar el evento con la BD:', err);
    }
    _toast('Cambios guardados', 'success');
    _refreshPanels();
    Grid.build?.();
  }

  function _previewImage(file, element) {
    if (!file.type.startsWith('image/')) {
      _toast('Sube una imagen valida', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = loadEvent => {
      const src = loadEvent.target.result;
      element.dataset.image = src;
      element.innerHTML = `<img src="${src}" style="max-height:200px;border-radius:8px;object-fit:contain;border:1px solid #e2e8f0;"/><div style="margin-top:10px;font-size:0.85rem;color:#ef4444;font-weight:600;cursor:pointer;" onclick="event.stopPropagation(); Zones.resetUploadArea()">Eliminar imagen</div>`;
    };
    reader.readAsDataURL(file);
  }

  function resetUploadArea() {
    const element = document.getElementById('db-upload-area');
    if (!element) return;
    delete element.dataset.image;
    element.innerHTML = `<input type="file" id="db-file-input" style="display:none" accept="image/*" onchange="Zones.handleFileSelect(this, document.getElementById('db-upload-area'))"/><div class="db-upload-icon">${Icons._icon('cloud_upload', 40)}</div><div class="db-upload-text">Arrastra o haz clic para subir imagen</div><div class="db-upload-hint">JPG, PNG, WEBP · Max. 10 MB</div>`;
  }

  function handleDrop(event, element) {
    event.preventDefault();
    element.classList.remove('dragover');
    if (event.dataTransfer.files?.[0]) _previewImage(event.dataTransfer.files[0], element);
  }

  function handleFileSelect(input, element) {
    if (input.files?.[0]) _previewImage(input.files[0], element);
  }

  function resetCreateForm() {
    _activatePanel('new');
  }

  function skipCardRegistration() {
    _skippedCard = true;
    _activatePanel('new');
  }

  async function createEvent() {
    const title = document.getElementById('db-new-title')?.value.trim();
    const artist = document.getElementById('db-new-artist')?.value.trim();
    const tourName = document.getElementById('db-new-tour')?.value.trim();
    const category = document.getElementById('db-new-category')?.value;
    const date = document.getElementById('db-new-date')?.value;
    const time = document.getElementById('db-new-time')?.value || '20:00';
    const city = document.getElementById('db-new-city')?.value.trim();
    const venue = document.getElementById('db-new-venue')?.value.trim();
    const priceGA = Number(document.getElementById('db-new-price-ga')?.value || 0);
    const priceVIP = Number(document.getElementById('db-new-price-vip')?.value || 0);
    const pricePlat = Number(document.getElementById('db-new-price-plat')?.value || 0);
    const about = document.getElementById('db-new-about')?.value.trim();
    const image = document.getElementById('db-upload-area')?.dataset.image || 'assets/img/logo.png';
    const button = document.getElementById('db-create-submit');

    const seatMode = document.querySelector('input[name="db-seat-map-mode"]:checked')?.value || 'none';
    const seatedFlow = seatMode === 'existing' || seatMode === 'new';
    // Para eventos con mapa: la capacidad viene del campo oculto (auto-detectada del plano).
    // Si la detección falló y queda en 0, lo guardamos como 0 (seats.io controla la disponibilidad).
    const rawCap = Number(document.getElementById('db-new-capacity')?.value || 0);
    const capacity = seatedFlow ? (rawCap || 0) : rawCap;

    if (!title || !artist || !category || !date || !city || !venue || priceGA <= 0 || (!seatedFlow && capacity <= 0)) {
      alert('Completa todos los campos obligatorios del evento. El precio GA es requerido.' + (!seatedFlow ? ' La capacidad es requerida para eventos sin mapa.' : ''));
      return;
    }

    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    if (date < todayStr) {
      alert('No puedes seleccionar una fecha que ya pasó para el evento.');
      return;
    }

    let seatMapDbId = null;
    if (seatMode === 'existing') {
      seatMapDbId = document.getElementById('db-seat-map-existing')?.value || '';
      if (!seatMapDbId) {
        alert('Selecciona un mapa de la lista o cambia a “Sin mapa”.');
        return;
      }
    } else if (seatMode === 'new') {
      seatMapDbId = document.getElementById('db-seat-map-db-id')?.value || '';
      if (!seatMapDbId) {
        alert('Abre el diseñador, guarda el mapa en seats.io y espera a que se guarde en Ticketazo antes de publicar.');
        return;
      }
    }

    const artistId = _ensureArtistRecord(artist, category);
    const localId = `evt-${_slug(title)}-${Date.now().toString(36)}`;
    const event = {
      id: localId,
      artistId,
      organizerId: Auth.session().email,
      title,
      artist,
      date,
      time,
      city,
      venue,
      image,
      category,
      recommended: false,
      bestSeller: false,
      ticketPrice: priceGA,
      prices: {
        GA: priceGA,
        ...(priceVIP > 0 && { VIP: priceVIP }),
        ...(pricePlat > 0 && { PLATINUM: pricePlat }),
      },
      ticketCapacity: capacity,
      status: Auth.session().role === 'admin' ? 'active' : 'pending',
      tourName: tourName || null,
      about: about || 'Evento creado desde el panel de Ticketazo.',
      reviews: [],
      __custom: true,
      seatMapDbId: seatMapDbId ? Number(seatMapDbId) : null,
    };

    if (event.seatMapDbId && typeof DB !== 'undefined' && DB.fetchSeatMapById) {
      try {
        const sm = await DB.fetchSeatMapById(event.seatMapDbId);
        if (sm) {
          event.seatsioChartKey = sm.seatsio_chart_key;
          event.seatsioEventKey = ''; // Asegurar que checkout.js cree uno nuevo, vinculado a ESTE evento único
          event.seatMapName = sm.nombre;
        }
      } catch (_e) {}
    } else {
      event.seatsioChartKey = '';
      event.seatsioEventKey = '';
    }

    if (button) {
      button.disabled = true;
      button.textContent = Auth.session().role === 'admin' ? 'Publicando...' : 'Solicitando...';
    }

    try {
      if (typeof DB !== 'undefined' && DB.saveEventRecord) {
        await DB.saveEventRecord(event);
      }

      EVENTS.unshift(event);
      _state[event.id] = { price: priceGA, prices: event.prices, capacity, status: event.status };
      _liveSales[event.id] = { sold: 0, revenue: 0 };
      _ensureCityRecord(city);
      _persistState();
      _persistCustomEvents();

      _toast(Auth.session().role === 'admin' ? 'Evento publicado correctamente' : 'Solicitud enviada a revisión', 'success');
      Grid.build?.();
      _refreshPanels('events');
    } catch (err) {
      console.error('[Dashboard] Error creando evento:', err);
      _toast('No se pudo crear el evento en la base de datos', 'error');
      if (button) {
        button.disabled = false;
        button.textContent = Auth.session().role === 'admin' ? 'Publicar evento' : 'Solicitar Publicación';
      }
    }
  }

  async function promoteToCarousel(id) {
    const event = _event(id);
    if (!event) return;
    if (HERO_SLIDES.some(slide => slide.eventId === id)) {
      _toast('Este evento ya esta en el carrusel del inicio', 'success');
      return;
    }
    const slide = { title: event.title, sub: `${event.artist} - ${event.city}`, cta: `Ver ${event.title}`, eventId: event.id, image: event.image };
    HERO_SLIDES.push(slide);
    _persistHeroSlides();
    Carousel.refresh?.();
    _toast(`"${event.title}" ahora aparece en el carrusel`, 'success');
    if (document.getElementById('panel-promote')?.classList.contains('active')) _activatePanel('promote');
    // Persist to BD
    try {
      if (typeof DB !== 'undefined' && DB.saveHeroSlide) {
        await DB.saveHeroSlide({ eventId: id, title: slide.title, sub: slide.sub, cta: slide.cta, orden: HERO_SLIDES.length - 1 });
      }
    } catch (err) {
      console.warn('[Dashboard] No se pudo guardar el slide en BD:', err);
    }
  }

  async function demoteFromCarousel(id, silent = false) {
    const slideIdx = HERO_SLIDES.findIndex(slide => slide.eventId === id);
    if (slideIdx !== -1) {
      HERO_SLIDES.splice(slideIdx, 1);
      _persistHeroSlides();
      Carousel.refresh?.();
      if (!silent) {
         _toast('El evento ha sido quitado del carrusel', 'success');
         if (document.getElementById('panel-promote')?.classList.contains('active')) _activatePanel('promote');
      }
      // Delete from BD
      try {
        if (typeof DB !== 'undefined' && DB.deleteHeroSlide) {
          await DB.deleteHeroSlide(id);
        }
      } catch (err) {
        console.warn('[Dashboard] No se pudo borrar el slide en BD:', err);
      }
    }
  }

  async function deleteEvent(id) {
    if (!confirm('¿Estás seguro de que deseas eliminar este evento permanentemente? Esta acción no se puede deshacer.')) return;
    
    try {
      if (typeof DB !== 'undefined' && DB.deleteEventRecord) {
        await DB.deleteEventRecord(id);
      }
    } catch(err) {
      console.warn('[Dashboard] Fallo al borrar de base de datos:', err);
    }
    
    const idx = EVENTS.findIndex(e => e.id === id);
    if (idx !== -1) {
      EVENTS.splice(idx, 1);
    }
    
    delete _state[id];
    delete _liveSales[id];
    _persistState();
    _persistCustomEvents();
    
    demoteFromCarousel(id, true);
    
    _toast('Evento eliminado', 'success');
    _refreshPanels();
    if (typeof Grid !== 'undefined' && Grid.build) Grid.build();
  }

  function copyBankNumber(value) {
    const text = String(value || '').trim();
    if (!text) return;
    const fallback = () => {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand('copy');
        _toast('CLABE copiada', 'success');
      } catch (_err) {
        _toast('No se pudo copiar la CLABE', 'error');
      } finally {
        area.remove();
      }
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => _toast('CLABE copiada', 'success')).catch(() => fallback());
      return;
    }
    fallback();
  }

  function _refreshPanels(preferredKey) {
    // Lee el tab activo ANTES de tocar cualquier cosa en el DOM
    const activeKey = preferredKey
      || document.querySelector('.db-nav-btn.active')?.id?.replace('tab-', '')
      || _tabs(Auth.session().role)[0]?.key;

    // Solo re-renderiza el contenido del panel activo; NO reconstruye la navegación
    // para no perder qué botón tiene la clase 'active'.
    if (activeKey) {
      _activatePanel(activeKey);
    }
  }

  function _renderApprove() {
    const events = EVENTS.filter(event => event.status === 'pending');
    return `
      <div class="db-page-header"><div><h1>Aprobar Publicacion de Eventos</h1><p>Revisa y aprueba los eventos propuestos por los organizadores.</p></div></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px">
        ${events.length ? events.map(event => {
          return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden"><div style="position:relative;height:130px;overflow:hidden"><img src="${event.image}" alt="${event.title}" style="width:100%;height:100%;object-fit:cover"/></div><div style="padding:12px"><div style="font-size:.8rem;font-weight:700;color:#0f172a;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${event.title}</div><div style="font-size:.7rem;color:#64748b;margin-bottom:10px">${event.organizerId || 'Sin organizador'}</div>
          <div style="display:flex;gap:8px">
            <button class="db-btn db-btn-primary" style="flex:1;font-size:.75rem" onclick="Zones.approveEvent('${event.id}')">Aprobar</button>
            <button class="db-btn db-btn-secondary" style="color:#ef4444;border-color:transparent;background:rgba(239,68,68,.1);padding:8px 12px" onclick="Zones.rejectEvent('${event.id}')">Rechazar</button>
          </div>
          </div></div>`;
        }).join('') : `<div class="db-empty"><div class="db-empty-icon"></div><div class="db-empty-text">No hay eventos pendientes.</div></div>`}
      </div>`;
  }

  function _renderCommissions() {
    const currentCommission = _loadJSON('ticketazo.commission', 5);
    return `
      <div class="db-page-header"><div><h1>Definir Comisiones</h1><p>Ajusta el porcentaje de comision que se cobra por la venta de boletos.</p></div></div>
      <div class="db-card" style="max-width: 400px;">
        <div class="db-card-body">
          <div class="db-field">
            <label class="db-label">Comision Actual (%)</label>
            <input id="admin-commission-input" class="db-input" type="number" min="0" max="100" value="${currentCommission}" />
          </div>
          <button class="db-btn db-btn-primary" style="width: 100%; margin-top: 10px;" onclick="
            const val = document.getElementById('admin-commission-input').value;
            localStorage.setItem('ticketazo.commission', val);
            alert('Comision actualizada a ' + val + '%');
          ">Guardar Comision</button>
        </div>
      </div>
    `;
  }

  function _renderReports() {
    return `
      <div class="db-page-header"><div><h1>Generar Reportes</h1><p>Visualiza y descarga los reportes del sistema en alta calidad PDF.</p></div></div>
      
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;">
        <div class="db-card" style="padding:24px;text-align:center;">
          <div style="font-size:3rem;margin-bottom:16px;color:#3b82f6;"><span class="material-symbols-outlined" style="font-size:48px;">event_note</span></div>
          <h2 style="font-size:1.1rem;font-weight:700;margin-bottom:8px;color:#0f172a">Catálogo de Eventos</h2>
          <p style="font-size:.85rem;color:#64748b;margin-bottom:20px;height:40px;">Reporte detallado con todas las fechas, recintos y organizadores.</p>
          <button class="db-btn db-btn-primary" style="width:100%" onclick="Zones.generateReport('events')">Descargar PDF</button>
        </div>

        <div class="db-card" style="padding:24px;text-align:center;">
          <div style="font-size:3rem;margin-bottom:16px;color:#10b981;"><span class="material-symbols-outlined" style="font-size:48px;">account_balance_wallet</span></div>
          <h2 style="font-size:1.1rem;font-weight:700;margin-bottom:8px;color:#0f172a">Reporte de Ingresos</h2>
          <p style="font-size:.85rem;color:#64748b;margin-bottom:20px;height:40px;">Balance de ingresos brutos, comisiones calculadas y pagos netos.</p>
          <button class="db-btn db-btn-primary" style="width:100%;background-color:#10b981;" onclick="Zones.generateReport('financial')">Descargar PDF</button>
        </div>

        <div class="db-card" style="padding:24px;text-align:center;">
          <div style="font-size:3rem;margin-bottom:16px;color:#8b5cf6;"><span class="material-symbols-outlined" style="font-size:48px;">confirmation_number</span></div>
          <h2 style="font-size:1.1rem;font-weight:700;margin-bottom:8px;color:#0f172a">Inventario de Boletos</h2>
          <p style="font-size:.85rem;color:#64748b;margin-bottom:20px;height:40px;">Desglose del boletaje: capacidad instalada vs. vendidos totales.</p>
          <button class="db-btn db-btn-primary" style="width:100%;background-color:#8b5cf6;" onclick="Zones.generateReport('tickets')">Descargar PDF</button>
        </div>
      </div>
      <div id="pdf-render-container" style="position:absolute;left:-9999px;top:0;width:800px;background:#ffffff;"></div>
    `;
  }

  function generateReport(type) {
    if (typeof html2pdf === 'undefined') {
      alert('La libreria para PDF no se ha cargado. Actualice la pagina.');
      return;
    }
    
    let container = document.getElementById('pdf-render-container');
    if (!container) return;

    let title = '';
    let rowsHtml = '';
    
    if (type === 'events') {
      title = 'Catálogo de Eventos Activos';
      const active = EVENTS.filter(e => e.status === 'active');
      rowsHtml = `
        <table style="width:100%; border-collapse:collapse; font-size:12px; font-family:sans-serif;">
          <thead>
            <tr style="background:#f1f5f9; color:#475569; text-align:left;">
              <th style="padding:12px; border-bottom:2px solid #cbd5e1;">Evento</th>
              <th style="padding:12px; border-bottom:2px solid #cbd5e1;">Artista</th>
              <th style="padding:12px; border-bottom:2px solid #cbd5e1;">Fecha</th>
              <th style="padding:12px; border-bottom:2px solid #cbd5e1;">Recinto / Ciudad</th>
              <th style="padding:12px; border-bottom:2px solid #cbd5e1;">Organizador</th>
            </tr>
          </thead>
          <tbody>
            ${active.map(e => `
              <tr style="border-bottom:1px solid #e2e8f0;">
                <td style="padding:12px;"><strong>${e.title}</strong><br><span style="color:#64748b;font-size:10px">${e.category}</span></td>
                <td style="padding:12px;">${e.artist}</td>
                <td style="padding:12px;">${e.date}</td>
                <td style="padding:12px;">${e.venue || ''}<br><span style="color:#64748b;font-size:10px">${e.city}</span></td>
                <td style="padding:12px;">${e.organizerId || 'N/A'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`;
    } else if (type === 'financial') {
      title = 'Reporte Financiero de Ingresos';
      const comm = Math.max(0, _loadJSON('ticketazo.commission', 5)) / 100;
      const groups = {};
      EVENTS.filter(e => e.status !== 'expired').forEach(e => {
        const org = e.organizerId || 'Plataforma';
        if (!groups[org]) groups[org] = { org, gross: 0, evts: 0 };
        groups[org].gross += Number.isFinite(getRevenue(e.id)) ? getRevenue(e.id) : 0;
        groups[org].evts++;
      });
      rowsHtml = `
        <table style="width:100%; border-collapse:collapse; font-size:12px; font-family:sans-serif;">
          <thead>
            <tr style="background:#f1f5f9; color:#475569; text-align:left;">
              <th style="padding:12px; border-bottom:2px solid #cbd5e1;">Organizador</th>
              <th style="padding:12px; border-bottom:2px solid #cbd5e1; text-align:center;">Eventos Activos</th>
              <th style="padding:12px; border-bottom:2px solid #cbd5e1; text-align:right;">Ingreso Bruto</th>
              <th style="padding:12px; border-bottom:2px solid #cbd5e1; text-align:right;">Comisión (${comm*100}%)</th>
              <th style="padding:12px; border-bottom:2px solid #cbd5e1; text-align:right;">Neto a Pagar</th>
            </tr>
          </thead>
          <tbody>
            ${Object.values(groups).map(g => {
              const f = Math.round(g.gross * comm);
              const net = g.gross - f;
              return `
              <tr style="border-bottom:1px solid #e2e8f0;">
                <td style="padding:12px; font-weight:700;">${g.org}</td>
                <td style="padding:12px; text-align:center;">${g.evts}</td>
                <td style="padding:12px; text-align:right; color:#3b82f6;">$${g.gross.toLocaleString()}</td>
                <td style="padding:12px; text-align:right; color:#ef4444;">-$${f.toLocaleString()}</td>
                <td style="padding:12px; text-align:right; color:#10b981; font-weight:700;">$${net.toLocaleString()}</td>
              </tr>
            `}).join('')}
          </tbody>
        </table>`;
    } else if (type === 'tickets') {
      title = 'Inventario de Boletos por Evento';
      const active = EVENTS.filter(e => e.status !== 'expired');
      rowsHtml = `
        <table style="width:100%; border-collapse:collapse; font-size:12px; font-family:sans-serif;">
          <thead>
            <tr style="background:#f1f5f9; color:#475569; text-align:left;">
              <th style="padding:12px; border-bottom:2px solid #cbd5e1;">Evento</th>
              <th style="padding:12px; border-bottom:2px solid #cbd5e1; text-align:right;">Precio</th>
              <th style="padding:12px; border-bottom:2px solid #cbd5e1; text-align:center;">Capacidad Total</th>
              <th style="padding:12px; border-bottom:2px solid #cbd5e1; text-align:center;">Vendidos</th>
              <th style="padding:12px; border-bottom:2px solid #cbd5e1; text-align:center;">Disponibles</th>
            </tr>
          </thead>
          <tbody>
            ${active.map(e => {
              const cfg = getTicketConfig(e.id);
              const sold = getSoldCount(e.id);
              const avail = cfg.capacity - sold;
              return `
              <tr style="border-bottom:1px solid #e2e8f0;">
                <td style="padding:12px; font-weight:700;">${e.title}</td>
                <td style="padding:12px; text-align:right;">$${cfg.price.toLocaleString()}</td>
                <td style="padding:12px; text-align:center;">${cfg.capacity.toLocaleString()}</td>
                <td style="padding:12px; text-align:center; color:#10b981;">${sold.toLocaleString()}</td>
                <td style="padding:12px; text-align:center; font-weight:700;">${avail <= 0 ? 'AGOTADO' : avail.toLocaleString()}</td>
              </tr>
            `}).join('')}
          </tbody>
        </table>`;
    }

    const htmlContent = `
      <div style="padding:40px; width:800px; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; color:#1e293b; background:#fff;">
        <div style="display:flex; justify-content:space-between; align-items:flex-end; border-bottom:3px solid ${type === 'events' ? '#3b82f6' : type === 'financial' ? '#10b981' : '#8b5cf6'}; padding-bottom:20px; margin-bottom:30px;">
          <div>
            <h1 style="margin:0; font-size:28px; font-weight:800; color:#0f172a; letter-spacing:-0.5px;">Ticketazo</h1>
            <p style="margin:4px 0 0; color:#64748b; font-size:12px; text-transform:uppercase; letter-spacing:1px;">Sistema de Administración Integral</p>
          </div>
          <div style="text-align:right;">
            <h2 style="margin:0; font-size:18px; color:${type === 'events' ? '#3b82f6' : type === 'financial' ? '#10b981' : '#8b5cf6'}; font-weight:600;">${title}</h2>
            <p style="margin:4px 0 0; color:#64748b; font-size:12px;">Fecha de emisión: ${new Date().toLocaleDateString('es-ES')}</p>
          </div>
        </div>
        ${rowsHtml}
        <div style="margin-top:50px; text-align:center; font-size:10px; color:#94a3b8; border-top:1px solid #e2e8f0; padding-top:20px;">
          Reporte generado automáticamente. Documento confidencial de Ticketazo.
        </div>
      </div>`;

    _toast('Generando PDF, por favor espera...', 'success');

    const opt = {
      margin:       0.3,
      filename:     `reporte_${type}_${Date.now()}.pdf`,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true },
      jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
    };

    html2pdf().from(htmlContent).set(opt).save().catch(err => {
      console.error(err);
      _toast('Error al generar PDF', 'error');
    });
  }

  async function approveEvent(id) {
    const event = _event(id);
    if (!event) return;
    event.status = 'active';
    if (!_state[id]) _state[id] = {};
    _state[id].status = 'active';
    
    try {
      if (typeof DB !== 'undefined' && DB.saveEventRecord) {
        await DB.saveEventRecord(event);
      }
    } catch(err) {
      console.warn('Error saving approved state remotely', err);
    }
    
    _persistState();
    if (event.__custom) _persistCustomEvents();
    _toast('Evento aprobado y publicado', 'success');
    _refreshPanels('approve');
    if (typeof Grid !== 'undefined' && Grid.build) Grid.build();
  }

  async function rejectEvent(id) {
    if (!confirm('¿Estás seguro de rechazar este evento?')) return;
    const event = _event(id);
    if (!event) return;
    event.status = 'rejected';
    if (!_state[id]) _state[id] = {};
    _state[id].status = 'rejected';

    try {
      if (typeof DB !== 'undefined' && DB.saveEventRecord) {
        await DB.saveEventRecord(event);
      }
    } catch(err) {
      console.warn('Error saving rejected state remotely', err);
    }
    
    _persistState();
    if (event.__custom) _persistCustomEvents();
    _toast('Evento rechazado', 'success');
    _refreshPanels('approve');
    if (typeof Grid !== 'undefined' && Grid.build) Grid.build();
  }

  return {
    init,
    openDashboard,
    getTicketConfig,
    getStatus,
    getMinPrice,
    getPending,
    getSoldCount,
    getRevenue,
    getRemainingCapacity,
    refreshSales: _loadRealSales,
    openSidebar,
    closeSidebar,
    switchTab,
    setTicketField,
    saveTicketConfig,
    handleDrop,
    handleFileSelect,
    resetUploadArea,
    resetCreateForm,
    skipCardRegistration,
    createEvent,
    promoteToCarousel,
    demoteFromCarousel,
    deleteEvent,
    copyBankNumber,
    approveEvent,
    rejectEvent,
    generateReport,
  };
})();

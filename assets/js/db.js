/**
 * db.js
 * Helper centralizado para Supabase y la BD actual de Ticketazo.
 */

window.DB = (() => {
  const CONFIG = {
    supabaseUrl: 'https://urumaghjardjgdveblxa.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVydW1hZ2hqYXJkamdkdmVibHhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3ODg3MjAsImV4cCI6MjA4OTM2NDcyMH0.qNfIZu-8lQQKUDzEbwJsF4y3cIthx2nDXwHkHCnaZcI',
    tables: {
      admins: 'administradores',
      tickets: 'boleto',
      events: 'evento',
      payments: 'pago',
      users: 'usuario',
      carousel: 'carrusel_hero',
      favorites: 'favorito',
      seatMaps: 'mapa_asiento',
    },
    legacyPasswordPlaceholder: 'SUPABASE_AUTH_MANAGED',
    eventMapStorageKey: 'ticketazo.db.event-map.v1',
  };

  let _client = null;
  let _eventMap = null;

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
      // No-op para demo.
    }
  }

  function _getEventMap() {
    if (_eventMap) return _eventMap;
    _eventMap = _loadJSON(CONFIG.eventMapStorageKey, {});
    return _eventMap;
  }

  function _persistEventMap() {
    _saveJSON(CONFIG.eventMapStorageKey, _getEventMap());
  }

  function client() {
    if (_client) return _client;
    if (!window.supabase?.createClient) return null;
    _client = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
    return _client;
  }

  function isReady() {
    return !!client();
  }

  function _safeName(email, fallback = 'Usuario Ticketazo') {
    if (fallback && String(fallback).trim()) return String(fallback).trim();
    const prefix = String(email || '').split('@')[0]?.trim();
    return prefix || fallback;
  }

  function _eventLocation(event) {
    return [event?.venue, event?.city].filter(Boolean).join(', ').trim();
  }

  function _matchLocalEventByDbEvent(dbEvent) {
    if (!dbEvent) return null;
    return EVENTS.find(event => (
      String(event.title || '').trim().toLowerCase() === String(dbEvent.titulo || '').trim().toLowerCase()
      && String(event.date || '') === String(dbEvent.fecha || '')
      && _eventLocation(event).toLowerCase() === String(dbEvent.ubicacion || '').trim().toLowerCase()
    )) || null;
  }

  function _splitLocation(location, fallbackEvent = null) {
    const raw = String(location || '').trim();
    if (!raw) {
      return {
        venue: fallbackEvent?.venue || '',
        city: fallbackEvent?.city || '',
      };
    }

    const parts = raw.split(',').map(part => part.trim()).filter(Boolean);
    if (parts.length <= 1) {
      return {
        venue: raw,
        city: fallbackEvent?.city || '',
      };
    }

    return {
      venue: parts.slice(0, -1).join(', '),
      city: parts.at(-1) || '',
    };
  }

  function _ticketCode(prefix = 'TKZ') {
    const stamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `${prefix}-${stamp}-${random}`;
  }

  function _ticketPurchaseRef(ticketId) {
    return `BOL-${String(ticketId).padStart(6, '0')}`;
  }

  function _mapPaymentStatus(value) {
    const status = String(value || '').trim().toLowerCase();
    if (['aprobado', 'approved', 'pagado', 'paid'].includes(status)) return 'Aprobado';
    if (['rechazado', 'rejected', 'fallido', 'failed'].includes(status)) return 'Rechazado';
    if (['pendiente', 'pending'].includes(status)) return 'Pendiente';
    return 'Aprobado';
  }

  function _isApprovedPayment(value) {
    return ['aprobado', 'approved', 'pagado', 'paid'].includes(String(value || '').trim().toLowerCase());
  }

  function _ticketAmount(ticket) {
    const qty = Number(ticket?.total ?? 1);
    const price = Number(ticket?.precio ?? 0);
    return qty * price;
  }

  async function findAdministratorByEmail(email) {
    const sb = client();
    if (!sb || !email) return null;

    const { data, error } = await sb
      .from(CONFIG.tables.admins)
      .select('id,nombre,email,rol')
      .eq('email', String(email).trim().toLowerCase())
      .maybeSingle();

    if (error) throw error;
    return data || null;
  }

  async function ensureUserRecord({ email, name }) {
    const sb = client();
    if (!sb || !email) return null;

    const normalizedEmail = String(email).trim().toLowerCase();
    const safeName = _safeName(normalizedEmail, name);

    const { data: found, error: findError } = await sb
      .from(CONFIG.tables.users)
      .select('id,nombre,email')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (findError) throw findError;

    if (found?.id) {
      if (safeName && safeName !== found.nombre) {
        await sb
          .from(CONFIG.tables.users)
          .update({ nombre: safeName })
          .eq('id', found.id);
      }
      return {
        id: found.id,
        nombre: safeName || found.nombre,
        email: found.email,
      };
    }

    const payload = {
      nombre: safeName,
      email: normalizedEmail,
      // La tabla legacy exige password NOT NULL. No usamos esta columna para autenticar.
      password: CONFIG.legacyPasswordPlaceholder,
    };

    const { data, error } = await sb
      .from(CONFIG.tables.users)
      .insert(payload)
      .select('id,nombre,email')
      .single();

    if (error) throw error;
    return data;
  }

  async function syncIdentity({ email, name }) {
    const user = await ensureUserRecord({ email, name });
    let admin = null;

    try {
      admin = await findAdministratorByEmail(email);
    } catch (_err) {
      admin = null;
    }

    return {
      userId: user?.id || null,
      userName: user?.nombre || name || '',
      adminId: admin?.id || null,
      adminRole: admin?.rol || '',
    };
  }

  async function ensureEventRecord(localEvent) {
    const sb = client();
    if (!sb || !localEvent) return null;

    const map = _getEventMap();
    if (map[localEvent.id]) return Number(map[localEvent.id]);

    const location = _eventLocation(localEvent);
    const { data: found, error: findError } = await sb
      .from(CONFIG.tables.events)
      .select('id,titulo,fecha,ubicacion')
      .eq('titulo', localEvent.title)
      .eq('fecha', localEvent.date)
      .eq('ubicacion', location)
      .maybeSingle();

    if (findError) throw findError;

    if (found?.id) {
      map[localEvent.id] = Number(found.id);
      _persistEventMap();
      return Number(found.id);
    }

    let adminId = null;
    try {
      const admin = await findAdministratorByEmail(localEvent.organizerId);
      adminId = admin?.id || null;
    } catch (_err) {
      adminId = null;
    }

    let finalImg = localEvent.image || null;
    if (finalImg) {
      if (localEvent.status && localEvent.status !== 'active') {
        finalImg += '#' + localEvent.status;
      }
      if (localEvent.prices) {
        finalImg += '#prices=' + btoa(JSON.stringify(localEvent.prices));
      }
      if (localEvent.about) {
        finalImg += '#about=' + btoa(encodeURIComponent(localEvent.about));
      }
      if (localEvent.category) {
        finalImg += '#cat=' + btoa(encodeURIComponent(localEvent.category));
      }
      if (localEvent.artist) {
        finalImg += '#art=' + btoa(encodeURIComponent(localEvent.artist));
      }
      if (localEvent.tourName) {
        finalImg += '#tour=' + btoa(encodeURIComponent(localEvent.tourName));
      }
    }
    const payload = {
      titulo: localEvent.title,
      fecha: localEvent.date,
      ubicacion: location,
      capacidad: Number(localEvent.ticketCapacity || 0) || 1,
      precio: Number(localEvent.ticketPrice || 0),
      imagen_url: finalImg,
    };

    if (adminId) payload.id_administrador = adminId;

    if (localEvent.seatMapDbId != null && localEvent.seatMapDbId !== '') {
      const seatMapId = Number(localEvent.seatMapDbId);
      if (!Number.isNaN(seatMapId)) payload.id_mapa_asiento = seatMapId;
    }
    if (Object.prototype.hasOwnProperty.call(localEvent, 'seatsioChartKey')) {
      payload.seatsio_chart_key = localEvent.seatsioChartKey || null;
    }
    if (Object.prototype.hasOwnProperty.call(localEvent, 'seatsioEventKey')) {
      payload.seatsio_event_key = localEvent.seatsioEventKey || null;
    }

    const { data, error } = await sb
      .from(CONFIG.tables.events)
      .insert(payload)
      .select('id')
      .single();

    if (error) throw error;

    map[localEvent.id] = Number(data.id);
    _persistEventMap();
    return Number(data.id);
  }

  async function saveEventRecord(localEvent) {
    const sb = client();
    if (!sb || !localEvent) return null;

    const map = _getEventMap();
    const knownId = map[localEvent.id] ? Number(map[localEvent.id]) : null;
    const location = _eventLocation(localEvent);
    let finalImg = localEvent.image || null;
    if (finalImg) {
      if (localEvent.status && localEvent.status !== 'active') {
        finalImg += '#' + localEvent.status;
      }
      if (localEvent.prices) {
        finalImg += '#prices=' + btoa(JSON.stringify(localEvent.prices));
      }
      if (localEvent.about) {
        finalImg += '#about=' + btoa(encodeURIComponent(localEvent.about));
      }
      if (localEvent.category) {
        finalImg += '#cat=' + btoa(encodeURIComponent(localEvent.category));
      }
      if (localEvent.artist) {
        finalImg += '#art=' + btoa(encodeURIComponent(localEvent.artist));
      }
      if (localEvent.tourName) {
        finalImg += '#tour=' + btoa(encodeURIComponent(localEvent.tourName));
      }
    }
    const payload = {
      titulo: localEvent.title,
      fecha: localEvent.date,
      ubicacion: location,
      capacidad: Number(localEvent.ticketCapacity || 0) || 1,
      precio: Number(localEvent.ticketPrice || 0),
      imagen_url: finalImg,
    };

    let adminId = null;
    try {
      const admin = await findAdministratorByEmail(localEvent.organizerId);
      adminId = admin?.id || null;
    } catch (_err) {
      adminId = null;
    }

    if (adminId) payload.id_administrador = adminId;

    if (Object.prototype.hasOwnProperty.call(localEvent, 'seatMapDbId')) {
      const sm = localEvent.seatMapDbId;
      payload.id_mapa_asiento = sm != null && sm !== '' ? Number(sm) : null;
    }
    if (Object.prototype.hasOwnProperty.call(localEvent, 'seatsioChartKey')) {
      payload.seatsio_chart_key = localEvent.seatsioChartKey || null;
    }
    if (Object.prototype.hasOwnProperty.call(localEvent, 'seatsioEventKey')) {
      payload.seatsio_event_key = localEvent.seatsioEventKey || null;
    }

    if (!knownId) {
      return ensureEventRecord(localEvent);
    }

    const { error } = await sb
      .from(CONFIG.tables.events)
      .update(payload)
      .eq('id', knownId);

    if (error) throw error;
    return knownId;
  }

  async function deleteEventRecord(localEventId) {
    const sb = client();
    if (!sb || !localEventId) return false;

    const map = _getEventMap();
    const knownId = map[localEventId] ? Number(map[localEventId]) : null;
    
    if (knownId) {
      await sb.from(CONFIG.tables.tickets).delete().eq('id_evento', knownId);

      const { error } = await sb
        .from(CONFIG.tables.events)
        .delete()
        .eq('id', knownId);
        
      if (error) {
        console.warn('Error deleting event from DB', error);
        return false;
      }
      
      delete map[localEventId];
      _persistEventMap();
      return true;
    }
    return false;
  }

  async function _findDbEventIdForLocalEvent(localEvent) {
    const sb = client();
    if (!sb || !localEvent?.id) return null;

    const map = _getEventMap();
    const knownId = map[localEvent.id] ? Number(map[localEvent.id]) : null;
    if (knownId) return knownId;

    const location = _eventLocation(localEvent);
    const { data, error } = await sb
      .from(CONFIG.tables.events)
      .select('id')
      .eq('titulo', localEvent.title)
      .eq('fecha', localEvent.date)
      .eq('ubicacion', location)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) return null;

    map[localEvent.id] = Number(data.id);
    _persistEventMap();
    return Number(data.id);
  }

  async function fetchEventSales(localEvents = []) {
    const sb = client();
    if (!sb) return {};

    const events = Array.isArray(localEvents) ? localEvents.filter(Boolean) : [];
    const summary = Object.fromEntries(events.map(event => [event.id, { sold: 0, revenue: 0 }]));

    const resolved = await Promise.all(events.map(async event => {
      const dbEventId = await _findDbEventIdForLocalEvent(event);
      return dbEventId ? { localId: event.id, dbEventId } : null;
    }));

    const matches = resolved.filter(Boolean);
    if (!matches.length) return summary;

    const localIdsByDbEvent = {};
    matches.forEach(match => {
      if (!localIdsByDbEvent[match.dbEventId]) {
        localIdsByDbEvent[match.dbEventId] = [];
      }
      localIdsByDbEvent[match.dbEventId].push(match.localId);
    });

    const dbEventIds = [...new Set(matches.map(match => match.dbEventId))];
    const { data: tickets, error: ticketError } = await sb
      .from(CONFIG.tables.tickets)
      .select('id,id_evento,total,precio,estado')
      .in('id_evento', dbEventIds);

    if (ticketError) throw ticketError;
    if (!tickets?.length) return summary;

    const ticketIds = tickets.map(ticket => ticket.id);
    let payments = [];

    if (ticketIds.length) {
      const { data, error } = await sb
        .from(CONFIG.tables.payments)
        .select('id_boleto,estado')
        .in('id_boleto', ticketIds);

      if (error) throw error;
      payments = data || [];
    }

    const paymentsByTicket = new Map();
    payments.forEach(payment => {
      if (!paymentsByTicket.has(payment.id_boleto)) {
        paymentsByTicket.set(payment.id_boleto, []);
      }
      paymentsByTicket.get(payment.id_boleto).push(payment);
    });

    tickets.forEach(ticket => {
      const targetLocalIds = localIdsByDbEvent[ticket.id_evento] || [];
      if (!targetLocalIds.length) return;

      const relatedPayments = paymentsByTicket.get(ticket.id) || [];
      const approved = relatedPayments.length
        ? relatedPayments.some(payment => _isApprovedPayment(payment.estado))
        : String(ticket.estado || '').trim().toLowerCase() === 'vendido';

      if (!approved) return;

      const amount = _ticketAmount(ticket);
      targetLocalIds.forEach(localId => {
        summary[localId].sold += Number(ticket.total || 0);
        summary[localId].revenue += amount;
      });
    });

    return summary;
  }

  async function fetchAllEvents() {
    const sb = client();
    if (!sb) return [];

    const { data: dbEvents, error } = await sb
      .from(CONFIG.tables.events)
      .select('id,titulo,fecha,ubicacion,capacidad,precio,imagen_url,id_administrador,id_mapa_asiento,seatsio_chart_key,seatsio_event_key');

    if (error) {
      console.warn('Error fetching all events:', error);
      return [];
    }

    const mapIds = [...new Set((dbEvents || []).map(e => e.id_mapa_asiento).filter(Boolean))];
    let seatMapsById = {};
    if (mapIds.length) {
      const { data: smRows, error: smErr } = await sb
        .from(CONFIG.tables.seatMaps)
        .select('id,nombre,seatsio_chart_key,seatsio_event_key')
        .in('id', mapIds);
      if (!smErr && smRows?.length) {
        seatMapsById = Object.fromEntries(smRows.map(row => [row.id, row]));
      }
    }

    let adminsMap = {};
    if (dbEvents?.length) {
      const { data: admins } = await sb
        .from(CONFIG.tables.admins)
        .select('id,email');
      if (admins) {
        adminsMap = Object.fromEntries(admins.map(a => [a.id, a.email]));
      }
    }

    // Fetch price per event from boleto table
    let priceByEventId = {};
    if (dbEvents?.length) {
      const dbEventIds = dbEvents.map(e => e.id);
      const { data: boletos } = await sb
        .from(CONFIG.tables.tickets)
        .select('id_evento,precio')
        .in('id_evento', dbEventIds)
        .gt('precio', 0);
      if (boletos?.length) {
        boletos.forEach(b => {
          if (b.precio > 0 && !priceByEventId[b.id_evento]) {
            priceByEventId[b.id_evento] = Number(b.precio);
          }
        });
      }
    }

    const map = _getEventMap();
    const dbToLocal = Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]));
    let mapUpdated = false;

    const formattedEvents = dbEvents.map(dbEvent => {
      let localId = dbToLocal[dbEvent.id];
      if (!localId) {
        // Find existing match by title/date/location if not in map
        const location = dbEvent.ubicacion || '';
        const existing = EVENTS.find(e => 
          e.title.toLowerCase() === dbEvent.titulo.toLowerCase() && 
          e.date === dbEvent.fecha &&
          _eventLocation(e).toLowerCase() === location.toLowerCase()
        );
        if (existing) {
          localId = existing.id;
        } else {
          localId = `evt-db-${dbEvent.id}`;
        }
        map[localId] = Number(dbEvent.id);
        mapUpdated = true;
      }

      const { venue, city } = _splitLocation(dbEvent.ubicacion);
      // Primary price = evento.precio; fallback = first boleto precio for legacy events
      const derivedPrice = Number(dbEvent.precio || 0) || (priceByEventId[dbEvent.id] || 0);
      
      let rawImg = dbEvent.imagen_url || 'assets/img/logo.png';
      let derivedStatus = 'active';
      let derivedPrices = null;
      let derivedAbout = 'Evento importado desde la base de datos.';
      let derivedCategory = 'Conciertos';
      let derivedArtist = dbEvent.titulo || 'Artista';
      let derivedTourName = null;
      
      const aboutMatch = rawImg.match(/#about=([^#]+)/);
      if (aboutMatch) {
         try { derivedAbout = decodeURIComponent(atob(aboutMatch[1])); rawImg = rawImg.replace(aboutMatch[0], ''); } catch(e) {}
      }
      const catMatch = rawImg.match(/#cat=([^#]+)/);
      if (catMatch) {
         try { derivedCategory = decodeURIComponent(atob(catMatch[1])); rawImg = rawImg.replace(catMatch[0], ''); } catch(e) {}
      }
      const artMatch = rawImg.match(/#art=([^#]+)/);
      if (artMatch) {
         try { derivedArtist = decodeURIComponent(atob(artMatch[1])); rawImg = rawImg.replace(artMatch[0], ''); } catch(e) {}
      }
      const tourMatch = rawImg.match(/#tour=([^#]+)/);
      if (tourMatch) {
         try { derivedTourName = decodeURIComponent(atob(tourMatch[1])); rawImg = rawImg.replace(tourMatch[0], ''); } catch(e) {}
      }

      const pricesMatch = rawImg.match(/#prices=([^#]+)/);
      if (pricesMatch) {
         try { derivedPrices = JSON.parse(atob(pricesMatch[1])); rawImg = rawImg.replace(pricesMatch[0], ''); } catch(e) {}
      }

      if (rawImg.includes('#pending')) {
        derivedStatus = 'pending';
        rawImg = rawImg.replace('#pending', '');
      } else if (rawImg.includes('#rejected')) {
        derivedStatus = 'rejected';
        rawImg = rawImg.replace('#rejected', '');
      }

      const sm = dbEvent.id_mapa_asiento ? seatMapsById[dbEvent.id_mapa_asiento] : null;

      let artistId = null;
      if (typeof ARTISTS !== 'undefined') {
        const existing = ARTISTS.find(a => a.name === derivedArtist);
        if (existing) {
          artistId = existing.id;
        } else {
          artistId = `artist-db-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
          ARTISTS.push({
            id: artistId,
            name: derivedArtist,
            genre: derivedCategory,
            image: rawImg,
            bio: 'Artista registrado desde Ticketazo.',
            isOnTour: !!derivedTourName
          });
        }
      }

      return {
        id: localId,
        artistId: artistId,
        tourName: derivedTourName,
        title: dbEvent.titulo || 'Evento Sin Nombre',
        date: dbEvent.fecha || '',
        time: '20:00',
        venue: venue || 'Por Definir',
        city: city || 'Ciudad',
        ticketCapacity: Number(dbEvent.capacidad || 100),
        ticketPrice: derivedPrice,
        prices: derivedPrices,
        image: rawImg,
        organizerId: adminsMap[dbEvent.id_administrador] || '',
        status: derivedStatus,
        artist: derivedArtist,
        category: derivedCategory,
        about: derivedAbout,
        reviews: [],
        __custom: true,
        seatMapDbId: dbEvent.id_mapa_asiento || null,
        seatsioChartKey: dbEvent.seatsio_chart_key || sm?.seatsio_chart_key || '',
        seatsioEventKey: dbEvent.seatsio_event_key || '',
        seatMapName: sm?.nombre || '',
      };
    });

    if (mapUpdated) {
      _persistEventMap();
    }
    return formattedEvents;
  }

  async function createTicketPurchase({ event, qty, price, buyerUserId, ticketTier, stripePaymentIntentId, seatLabels }) {
    const sb = client();
    if (!sb) throw new Error('Supabase no esta disponible.');
    if (!event?.id) throw new Error('No se pudo identificar el evento.');
    if (!buyerUserId) throw new Error('No encontramos tu usuario en la base de datos.');

    const eventDbId = await ensureEventRecord(event);
    if (!eventDbId) throw new Error('No se pudo enlazar el evento con la base de datos.');

    let organizerAdmin = null;
    try {
      organizerAdmin = await findAdministratorByEmail(event.organizerId);
    } catch (_err) {
      organizerAdmin = null;
    }

    const safeQty = Math.max(1, Number(qty || 1));
    const unitPrice = Math.max(0, Number(price || event.ticketPrice || 0));
    const adminId = organizerAdmin?.id || null;

    const labels = Array.isArray(seatLabels) ? seatLabels : [];
    const ticketPayloads = Array.from({ length: safeQty }, (_, index) => {
      const tier = ticketTier || 'GA';
      let qrSuffix = '#' + tier;
      const seat = labels[index];
      if (seat) qrSuffix += '#' + String(seat);
      const payload = {
        total: 1,
        codigoqr: _ticketCode('TKZ') + qrSuffix,
        estado: 'vendido',
        precio: unitPrice,
        id_evento: eventDbId,
        id_usuario: buyerUserId,
      };
      if (adminId) payload.id_administrador = adminId;
      return payload;
    });

    const { data: insertedTickets, error: ticketError } = await sb
      .from(CONFIG.tables.tickets)
      .insert(ticketPayloads)
      .select('id,total,fecha,codigoqr,estado,precio,id_evento,id_administrador');

    if (ticketError) throw ticketError;

    try {
      const paymentPayloads = (insertedTickets || []).map(ticket => {
        const payload = {
          metodo: 'tarjeta',
          estado: 'aprobado',
          id_boleto: ticket.id,
          monto: Math.round(unitPrice * safeQty * 100), // centavos para Stripe
          moneda: 'mxn',
          id_usuario: buyerUserId || null,
          stripe_payment_intent_id: stripePaymentIntentId || null,
        };
        if (adminId) payload.id_administrador = adminId;
        return payload;
      });

      if (paymentPayloads.length) {
        const { error: paymentError } = await sb
          .from(CONFIG.tables.payments)
          .insert(paymentPayloads);
        if (paymentError) throw paymentError;
      }
    } catch (error) {
      const insertedIds = (insertedTickets || []).map(ticket => ticket.id);
      if (insertedIds.length) {
        await sb.from(CONFIG.tables.tickets).delete().in('id', insertedIds);
      }
      throw error;
    }

    return (insertedTickets || []).map(ticket => {
      const location = _splitLocation(_eventLocation(event), event);
      return {
        id: `DB-${ticket.id}`,
        dbId: ticket.id,
        eventId: event.id,
        purchaseDate: ticket.fecha ? `${ticket.fecha}T12:00:00` : new Date().toISOString(),
        price: _ticketAmount(ticket),
        qrCode: ticket.codigoqr,
        purchaseRef: _ticketPurchaseRef(ticket.id),
        buyerName: '',
        buyerEmail: '',
        purchaseStatus: 'Aprobado',
        accessStatus: ticket.estado === 'vendido' ? 'Activo' : 'Disponible',
        eventTitle: event.title,
        artist: event.artist || '',
        eventDate: event.date || '',
        venue: location.venue || '',
        city: location.city || '',
        eventImage: event.image || 'assets/img/logo.png',
        ticketTier: (() => {
          const p = _parseTicketCodigoQr(ticket.codigoqr);
          if (p.seatLabel) return `${p.tier === 'GA' ? 'General (GA)' : p.tier} · ${p.seatLabel}`;
          return p.tier === 'GA' ? 'General (GA)' : p.tier;
        })(),
      };
    });
  }

  async function fetchUserTickets(userId) {
    const sb = client();
    if (!sb || !userId) return [];

    const { data: tickets, error: ticketError } = await sb
      .from(CONFIG.tables.tickets)
      .select('id,total,fecha,codigoqr,estado,precio,id_evento,id_administrador')
      .eq('id_usuario', userId)
      .order('fecha', { ascending: false })
      .order('id', { ascending: false });

    if (ticketError) throw ticketError;
    if (!tickets?.length) return [];

    const eventIds = [...new Set(tickets.map(ticket => ticket.id_evento).filter(Boolean))];
    const ticketIds = tickets.map(ticket => ticket.id);

    let dbEvents = [];
    let payments = [];

    if (eventIds.length) {
      const { data, error } = await sb
        .from(CONFIG.tables.events)
        .select('id,titulo,fecha,ubicacion,imagen_url')
        .in('id', eventIds);
      if (error) throw error;
      dbEvents = data || [];
    }

    if (ticketIds.length) {
      const { data, error } = await sb
        .from(CONFIG.tables.payments)
        .select('id_boleto,estado,metodo')
        .in('id_boleto', ticketIds);
      if (error) throw error;
      payments = data || [];
    }

    const dbEventsById = Object.fromEntries(dbEvents.map(event => [event.id, event]));
    const paymentsByTicket = Object.fromEntries(payments.map(payment => [payment.id_boleto, payment]));

    return tickets.map(ticket => {
      const dbEvent = dbEventsById[ticket.id_evento] || null;
      const localEvent = _matchLocalEventByDbEvent(dbEvent);
      const location = _splitLocation(dbEvent?.ubicacion, localEvent);
      const payment = paymentsByTicket[ticket.id] || null;

      const parsed = _parseTicketCodigoQr(ticket.codigoqr || '');
      const rawQr = parsed.rawQr;
      let displayTier = parsed.tier === 'GA' ? 'General (GA)' : parsed.tier;
      if (parsed.seatLabel) displayTier = `${displayTier} · ${parsed.seatLabel}`;

      return {
        id: `DB-${ticket.id}`,
        dbId: ticket.id,
        eventId: localEvent?.id || `db-event-${ticket.id_evento}`,
        purchaseDate: ticket.fecha ? `${ticket.fecha}T12:00:00` : new Date().toISOString(),
        price: _ticketAmount(ticket),
        qrCode: rawQr,
        purchaseRef: _ticketPurchaseRef(ticket.id),
        buyerName: '',
        buyerEmail: '',
        purchaseStatus: _mapPaymentStatus(payment?.estado),
        accessStatus: ticket.estado === 'vendido' ? 'Activo' : 'Disponible',
        eventTitle: localEvent?.title || dbEvent?.titulo || 'Evento Ticketazo',
        artist: localEvent?.artist || '',
        eventDate: localEvent?.date || dbEvent?.fecha || '',
        venue: localEvent?.venue || location.venue || '',
        city: localEvent?.city || location.city || '',
        eventImage: localEvent?.image || dbEvent?.imagen_url || 'assets/img/logo.png',
        ticketTier: displayTier,
      };
    });
  }

  // ── Carrusel Hero ─────────────────────────────────────────────────────────

  async function fetchHeroSlides() {
    const sb = client();
    if (!sb) return [];
    const { data, error } = await sb
      .from(CONFIG.tables.carousel)
      .select('id,id_evento,titulo,subtitulo,cta,orden')
      .order('orden', { ascending: true });
    if (error) { console.warn('[DB] fetchHeroSlides:', error); return []; }

    const map = _getEventMap();
    const dbToLocal = Object.fromEntries(Object.entries(map).map(([k, v]) => [Number(v), k]));

    return (data || []).map(row => {
      const localId = dbToLocal[row.id_evento] || `evt-db-${row.id_evento}`;
      return {
        dbId: row.id,
        eventId: localId,
        title: row.titulo || '',
        sub: row.subtitulo || '',
        cta: row.cta || '',
        orden: row.orden || 0,
      };
    });
  }

  async function saveHeroSlide({ eventId, title, sub, cta, orden = 0 }) {
    const sb = client();
    if (!sb || !eventId) return null;

    // Resolve DB event id
    const map = _getEventMap();
    const dbEventId = map[eventId] ? Number(map[eventId]) : null;
    if (!dbEventId) { console.warn('[DB] saveHeroSlide: evento no encontrado:', eventId); return null; }

    // Upsert: if a row for this event already exists, update it
    const { data: existing } = await sb
      .from(CONFIG.tables.carousel)
      .select('id')
      .eq('id_evento', dbEventId)
      .maybeSingle();

    if (existing?.id) {
      const { error } = await sb
        .from(CONFIG.tables.carousel)
        .update({ titulo: title, subtitulo: sub, cta, orden })
        .eq('id', existing.id);
      if (error) throw error;
      return existing.id;
    }

    const { data, error } = await sb
      .from(CONFIG.tables.carousel)
      .insert({ id_evento: dbEventId, titulo: title, subtitulo: sub, cta, orden })
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  }

  async function deleteHeroSlide(eventId) {
    const sb = client();
    if (!sb || !eventId) return false;
    const map = _getEventMap();
    const dbEventId = map[eventId] ? Number(map[eventId]) : null;
    if (!dbEventId) return false;
    const { error } = await sb
      .from(CONFIG.tables.carousel)
      .delete()
      .eq('id_evento', dbEventId);
    if (error) { console.warn('[DB] deleteHeroSlide:', error); return false; }
    return true;
  }

  // ── Favoritos ──────────────────────────────────────────────────────────────

  async function fetchFavorites(userId) {
    const sb = client();
    if (!sb || !userId) return [];
    const { data, error } = await sb
      .from(CONFIG.tables.favorites)
      .select('id_evento')
      .eq('id_usuario', userId);
    if (error) { console.warn('[DB] fetchFavorites:', error); return []; }

    const dbEventIds = (data || []).map(r => r.id_evento);
    if (!dbEventIds.length) return [];

    // Map DB event ids back to local event ids
    const map = _getEventMap();
    const dbToLocal = Object.fromEntries(Object.entries(map).map(([k, v]) => [Number(v), k]));
    return dbEventIds.map(dbId => dbToLocal[dbId]).filter(Boolean);
  }

  async function toggleFavorite(userId, eventId) {
    const sb = client();
    if (!sb || !userId || !eventId) return null;

    const map = _getEventMap();
    const dbEventId = map[eventId] ? Number(map[eventId]) : null;
    if (!dbEventId) { console.warn('[DB] toggleFavorite: evento no mapeado:', eventId); return null; }

    const { data: existing } = await sb
      .from(CONFIG.tables.favorites)
      .select('id')
      .eq('id_usuario', userId)
      .eq('id_evento', dbEventId)
      .maybeSingle();

    if (existing?.id) {
      // Already liked — remove it
      const { error } = await sb
        .from(CONFIG.tables.favorites)
        .delete()
        .eq('id', existing.id);
      if (error) throw error;
      return false; // now unliked
    }

    // Not liked yet — add it
    const { error } = await sb
      .from(CONFIG.tables.favorites)
      .insert({ id_usuario: userId, id_evento: dbEventId });
    if (error) throw error;
    return true; // now liked
  }

  // ── Verificación de boletos por QR ─────────────────────────────────────────

  async function fetchTicketByCode(qrCode) {
    const sb = client();
    if (!sb || !qrCode) return null;

    // El codigoqr puede contener #TIER — buscamos con el código completo
    const { data: ticket, error: ticketError } = await sb
      .from(CONFIG.tables.tickets)
      .select('id,total,fecha,codigoqr,estado,precio,id_evento,id_usuario,usado,fecha_uso')
      .eq('codigoqr', qrCode)
      .maybeSingle();

    if (ticketError) throw ticketError;
    if (!ticket) return null;

    // Obtener info del evento
    let eventData = null;
    if (ticket.id_evento) {
      const { data: evt } = await sb
        .from(CONFIG.tables.events)
        .select('id,titulo,fecha,ubicacion,imagen_url')
        .eq('id', ticket.id_evento)
        .maybeSingle();
      eventData = evt || null;
    }

    // Obtener info del comprador
    let userData = null;
    if (ticket.id_usuario) {
      const { data: usr } = await sb
        .from(CONFIG.tables.users)
        .select('id,nombre,email')
        .eq('id', ticket.id_usuario)
        .maybeSingle();
      userData = usr || null;
    }

    // Obtener info de pago
    let paymentData = null;
    {
      const { data: pay } = await sb
        .from(CONFIG.tables.payments)
        .select('id,estado,metodo,monto,moneda,stripe_payment_intent_id')
        .eq('id_boleto', ticket.id)
        .maybeSingle();
      paymentData = pay || null;
    }

    const location = ticket.id_evento && eventData?.ubicacion
      ? _splitLocation(eventData.ubicacion)
      : { venue: '', city: '' };

    const parsed = _parseTicketCodigoQr(ticket.codigoqr || '');
    const rawQr = parsed.rawQr;
    let tierLabel = parsed.tier === 'GA' ? 'General (GA)' : parsed.tier;
    if (parsed.seatLabel) tierLabel = `${tierLabel} · ${parsed.seatLabel}`;

    return {
      id: ticket.id,
      code: rawQr,
      fullCode: ticket.codigoqr,
      tier: tierLabel,
      status: ticket.estado,
      price: Number(ticket.precio || 0),
      qty: Number(ticket.total || 1),
      purchaseDate: ticket.fecha || null,
      used: !!ticket.usado,
      usedAt: ticket.fecha_uso || null,
      event: eventData ? {
        title: eventData.titulo || 'Evento',
        date: eventData.fecha || '',
        venue: location.venue || '',
        city: location.city || '',
        image: eventData.imagen_url || '',
      } : null,
      buyer: userData ? {
        name: userData.nombre || '',
        email: userData.email || '',
      } : null,
      payment: paymentData ? {
        status: _mapPaymentStatus(paymentData.estado),
        method: paymentData.metodo || '',
        amount: Number(paymentData.monto || 0),
        currency: paymentData.moneda || 'mxn',
        stripeId: paymentData.stripe_payment_intent_id || '',
      } : null,
    };
  }

  async function markTicketUsed(qrCode) {
    const sb = client();
    if (!sb || !qrCode) throw new Error('No se pudo conectar a la base de datos.');

    // Primero verificar que el boleto existe y no está usado
    const { data: ticket, error: findError } = await sb
      .from(CONFIG.tables.tickets)
      .select('id,usado')
      .eq('codigoqr', qrCode)
      .maybeSingle();

    if (findError) throw findError;
    if (!ticket) throw new Error('Boleto no encontrado.');
    if (ticket.usado) throw new Error('Este boleto ya fue utilizado anteriormente.');

    // Marcar como usado
    const { error: updateError } = await sb
      .from(CONFIG.tables.tickets)
      .update({ usado: true, fecha_uso: new Date().toISOString() })
      .eq('id', ticket.id);

    if (updateError) throw updateError;
    return true;
  }

  function _parseTicketCodigoQr(codigoqr) {
    const full = String(codigoqr || '');
    if (!full.includes('#')) {
      return { rawQr: full, tier: 'General', seatLabel: '' };
    }
    const parts = full.split('#');
    return {
      rawQr: parts[0],
      tier: parts[1] || 'General',
      seatLabel: parts.slice(2).join('#'),
    };
  }

  async function fetchSeatMapsForSession(authEmail, role) {
    const sb = client();
    if (!sb || !authEmail) return [];

    const admin = await findAdministratorByEmail(authEmail);
    if (!admin?.id && role !== 'admin') return [];

    let query = sb
      .from(CONFIG.tables.seatMaps)
      .select('id,nombre,seatsio_chart_key,seatsio_event_key,id_administrador')
      .order('nombre', { ascending: true });

    if (role !== 'admin') {
      query = query.eq('id_administrador', admin.id);
    }

    const { data, error } = await query;
    if (error) {
      console.warn('[DB] fetchSeatMapsForSession:', error);
      return [];
    }
    return data || [];
  }

  async function fetchSeatMapById(id) {
    const sb = client();
    if (!sb || id == null || id === '') return null;
    const { data, error } = await sb
      .from(CONFIG.tables.seatMaps)
      .select('id,nombre,seatsio_chart_key,seatsio_event_key')
      .eq('id', Number(id))
      .maybeSingle();
    if (error) {
      console.warn('[DB] fetchSeatMapById:', error);
      return null;
    }
    return data;
  }

  async function insertSeatMap({ nombre, seatsioChartKey, seatsioEventKey, createdByAdminId }) {
    const sb = client();
    if (!sb) throw new Error('Supabase no disponible.');
    const payload = {
      nombre: String(nombre || 'Mapa').trim(),
      seatsio_chart_key: String(seatsioChartKey || '').trim(),
    };
    if (seatsioEventKey) payload.seatsio_event_key = String(seatsioEventKey).trim();
    if (createdByAdminId) payload.id_administrador = Number(createdByAdminId);

    const { data, error } = await sb
      .from(CONFIG.tables.seatMaps)
      .insert(payload)
      .select('id,nombre,seatsio_chart_key,seatsio_event_key')
      .single();

    if (error) throw error;
    return data;
  }

  async function updateSeatMapSeatsioEventKey(mapId, seatsioEventKey) {
    const sb = client();
    if (!sb || mapId == null || mapId === '') return null;
    const key = String(seatsioEventKey || '').trim();
    if (!key) return null;
    const { data, error } = await sb
      .from(CONFIG.tables.seatMaps)
      .update({ seatsio_event_key: key })
      .eq('id', Number(mapId))
      .select('id,nombre,seatsio_chart_key,seatsio_event_key')
      .maybeSingle();
    if (error) {
      console.warn('[DB] updateSeatMapSeatsioEventKey:', error);
      return null;
    }
    return data;
  }

  return {
    client,
    isReady,
    getConfig: () => ({ ...CONFIG, tables: { ...CONFIG.tables } }),
    ensureUserRecord,
    findAdministratorByEmail,
    syncIdentity,
    ensureEventRecord,
    saveEventRecord,
    deleteEventRecord,
    fetchAllEvents,
    fetchEventSales,
    createTicketPurchase,
    fetchUserTickets,
    fetchHeroSlides,
    saveHeroSlide,
    deleteHeroSlide,
    fetchFavorites,
    toggleFavorite,
    fetchTicketByCode,
    markTicketUsed,
    fetchSeatMapsForSession,
    fetchSeatMapById,
    insertSeatMap,
    updateSeatMapSeatsioEventKey,
  };
})();

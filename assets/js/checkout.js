/**
 * checkout.js
 * Flujo de compra de boletos con Stripe Elements.
 * Paso 1: Cantidad / tipo de boleto
 * Paso 2: Pago real con Stripe
 * Paso 3: Confirmación / éxito
 */

window.Checkout = (() => {
  let _eventId = null;
  let _qty = 1;
  let _selectedTier = 'GA';
  let _selectedSeats = [];
  let _seatPriceMap   = {};  // seatLabel → precio unitario según zona
  let _seatCategoryMap = {}; // seatLabel → nombre de categoría/zona
  let _seatsioSessionInit = false;

  // ── Stripe state ────────────────────────────────────────────────────────────
  let _stripeInstance = null;
  let _cardElement = null;

  // ── Helpers de evento / config ──────────────────────────────────────────────
  function _getEvent() {
    return EVENTS.find(event => event.id === _eventId) || null;
  }

  function _isSeatedEvent() {
    const ev = _getEvent();
    return !!((ev?.seatsioEventKey || ev?.seatsioChartKey) && window.TICKETAZO_CONFIG?.seatsioPublicKey);
  }

  function _seatLabelFromObject(o) {
    if (!o) return '';
    if (o.label) return String(o.label);
    if (o.labels && o.labels.own) return String(o.labels.own);
    if (o.ids && o.ids.label) return String(o.ids.label);
    if (o.id != null) return String(o.id);
    return '';
  }

  function _updateSeatHint() {
    const el = document.getElementById('ck-seat-hint');
    if (!el || !_isSeatedEvent()) return;
    el.textContent = `Asientos elegidos: ${_selectedSeats.length} (cada uno es un boleto).`;
    el.classList.toggle('warn', _selectedSeats.length <= 0);
  }

  function _setQtyDisplay() {
    const el = document.getElementById('ck-qty-val');
    if (el) el.textContent = String(_qty);
  }

  // Precio de una zona concreta (GA, VIP, PLATINUM…) desde event.prices
  function _getPriceForCategory(categoryLabel) {
    const ev  = _getEvent();
    const cfg = _getConfig();
    if (!ev?.prices) return cfg.price;
    const lbl = String(categoryLabel || '').trim();
    if (lbl && ev.prices[lbl] !== undefined) return Number(ev.prices[lbl]);
    const key = Object.keys(ev.prices).find(k => k.toLowerCase() === lbl.toLowerCase());
    if (key) return Number(ev.prices[key]);
    return Number(ev.prices.GA ?? cfg.price);
  }

  // Suma de precios por asiento individual (multi-zona)
  function _getSeatedTotal() {
    if (!_isSeatedEvent() || !_selectedSeats.length) return 0;
    const cfg = _getConfig();
    return _selectedSeats.reduce((sum, lbl) => sum + (_seatPriceMap[lbl] ?? cfg.price), 0);
  }

  function _setSubtotalText() {
    const subtotal = document.querySelector('.ck-subtotal');
    if (!subtotal) return;
    const total = _isSeatedEvent() ? _getSeatedTotal() : _getConfig().price * _qty;
    subtotal.innerHTML = `Subtotal: <strong>$${total.toLocaleString()}</strong>`;
  }

  function _refreshSeatedPurchaseUI() {
    if (!_isSeatedEvent()) return;
    _qty = _selectedSeats.length;
    _setQtyDisplay();
    _setSubtotalText();
    _updateSeatHint();
    const btn = document.querySelector('#checkout-body .ck-btn-primary');
    if (btn && btn.getAttribute('onclick') === 'Checkout.goConfirm()') {
      btn.disabled = _qty <= 0;
    }
  }

  async function _mountSeatsioChart() {
    if (!_isSeatedEvent() || typeof SeatsioMaps === 'undefined') return;
    const ev = _getEvent();
    const mountId = 'seatsio-chart-mount';
    if (!document.getElementById(mountId)) return;
    if (!_seatsioSessionInit) {
      _selectedSeats = [];
      _seatsioSessionInit = true;
    }
    try {
      let eventKey = (ev?.seatsioEventKey || '').trim();
      const chartKey = (ev?.seatsioChartKey || '').trim();
      if (!eventKey && chartKey && SeatsioMaps.ensureSeatsioEventForChart) {
        // Enforce a unique Seats.io Event Key per Ticketazo Event, so deleted events don't block seats
        const safeLocalId = String(ev?.id || '').replace(/[^a-zA-Z0-9\-]/g, '');
        const pref = ev?.id ? `tkz-${safeLocalId}` : '';
        eventKey = (await SeatsioMaps.ensureSeatsioEventForChart(chartKey, pref)) || '';
        if (eventKey) {
          ev.seatsioEventKey = eventKey;
          if (typeof DB !== 'undefined' && DB.saveEventRecord) {
            DB.saveEventRecord(ev).catch(() => {});
          }
        }
      }
      await SeatsioMaps.mountBuyerChart(mountId, {
        chartKey,
        eventKey,
      }, {
        maxObjects: 80,
        onObjectSelected: (o) => {
          const l = _seatLabelFromObject(o);
          const categoryLabel = o.category?.label || o.categoryLabel || '';
          const price = _getPriceForCategory(categoryLabel);
          if (l) {
            _seatPriceMap[l]    = price;
            _seatCategoryMap[l] = categoryLabel || 'GA';
            if (!_selectedSeats.includes(l)) _selectedSeats.push(l);
          }
          _refreshSeatedPurchaseUI();
        },
        onObjectDeselected: (o) => {
          const l = _seatLabelFromObject(o);
          if (l) {
            delete _seatPriceMap[l];
            delete _seatCategoryMap[l];
          }
          _selectedSeats = _selectedSeats.filter(x => x !== l);
          _refreshSeatedPurchaseUI();
        },
      });
    } catch (e) {
      console.warn('[Checkout] seats.io:', e);
    }
    _refreshSeatedPurchaseUI();
  }

  function _getConfig() {
    const event = _getEvent();
    const config = typeof Zones !== 'undefined' && Zones.getTicketConfig
      ? Zones.getTicketConfig(_eventId)
      : { price: event?.ticketPrice || 0, capacity: event?.ticketCapacity || 0 };

    if (event?.prices && Object.keys(event.prices).length > 0) {
      if (!_selectedTier || !event.prices[_selectedTier]) {
        _selectedTier = Object.keys(event.prices)[0];
      }
      config.price = event.prices[_selectedTier];
    }
    const sold = typeof Zones !== 'undefined' && Zones.getSoldCount ? Zones.getSoldCount(_eventId) : null;
    const remaining = typeof Zones !== 'undefined' && Zones.getRemainingCapacity
      ? Zones.getRemainingCapacity(_eventId)
      : null;
    const remainingKnown = Number.isFinite(remaining);
    return {
      price: Number(config.price || 0),
      capacity: Number(config.capacity || 0),
      sold: Number.isFinite(sold) ? Number(sold) : null,
      remaining: remainingKnown ? Number(remaining) : Math.max(Number(config.capacity || 0), 0),
      remainingKnown,
    };
  }

  // ── Stripe initialization ───────────────────────────────────────────────────
  function _initStripe() {
    if (_stripeInstance) return _stripeInstance;
    const pk = window.TICKETAZO_CONFIG?.stripePk;
    if (!window.Stripe || !pk) {
      console.warn('[Checkout] Stripe.js no disponible o falta stripePk en TICKETAZO_CONFIG.');
      return null;
    }
    _stripeInstance = Stripe(pk);
    return _stripeInstance;
  }

  function _mountCardElement() {
    const stripe = _initStripe();
    if (!stripe) return;

    const mountEl = document.getElementById('stripe-card-element');
    if (!mountEl || mountEl.dataset.mounted === '1') return;

    const elements = stripe.elements({ locale: 'es' });
    _cardElement = elements.create('card', {
      hidePostalCode: true,
      style: {
        base: {
          color: '#F1F5F9',
          fontFamily: '"Inter", "Poppins", sans-serif',
          fontSize: '15px',
          fontSmoothing: 'antialiased',
          '::placeholder': { color: 'rgba(255,255,255,0.35)' },
          iconColor: '#a78bfa',
        },
        invalid: {
          color: '#ff4d6d',
          iconColor: '#ff4d6d',
        },
      },
    });

    _cardElement.mount('#stripe-card-element');
    mountEl.dataset.mounted = '1';

    _cardElement.on('change', ({ error }) => {
      const errEl = document.getElementById('ck-err');
      if (errEl) {
        if (error) {
          errEl.textContent = error.message;
          errEl.classList.remove('hidden');
        } else {
          errEl.classList.add('hidden');
        }
      }
    });
  }

  // ── Crear PaymentIntent en el servidor ──────────────────────────────────────
  async function _createPaymentIntent(totalCentavos) {
    const event = _getEvent();
    const cfg = window.TICKETAZO_CONFIG;
    if (!cfg?.supabaseFunctionsUrl) throw new Error('Configuración de pagos no disponible.');

    const dbConfig = typeof DB !== 'undefined' && DB.getConfig ? DB.getConfig() : {};
    // Usar siempre el anon key — la session JWT usa ES256 que puede fallar
    const authToken = dbConfig.supabaseAnonKey || '';

    const session = typeof Auth !== 'undefined' && Auth.session ? Auth.session() : null;

    const resp = await fetch(`${cfg.supabaseFunctionsUrl}/stripe-checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': authToken,
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        amount: totalCentavos,
        currency: 'mxn',
        eventTitle: event?.title || 'Evento Ticketazo',
        eventId: _eventId,
        qty: _qty,
        userId: session?.dbUserId || null,
      }),
    });

    if (!resp.ok) {
      let errMsg = 'No se pudo iniciar la sesión de pago.';
      try {
        const errData = await resp.json();
        if (errData?.error) errMsg = errData.error;
        if (errData?.message) errMsg = errData.message;
      } catch (_) {}
      throw new Error(errMsg);
    }

    const data = await resp.json();
    if (!data?.clientSecret) throw new Error('Respuesta de pago inválida del servidor.');
    return data; // { clientSecret, paymentIntentId }
  }

  // ── UI helpers ──────────────────────────────────────────────────────────────
  async function open(eventId) {
    _eventId = eventId;
    _qty = 0;
    _selectedTier = 'GA';
    _selectedSeats = [];
    _seatPriceMap  = {};
    _seatCategoryMap = {};
    _seatsioSessionInit = false;
    _cardElement = null;

    // Asegurar lista de eventos actualizada (mapas / keys) antes de validar boletaje.
    try {
      if (typeof DB !== 'undefined' && DB.fetchAllEvents) {
        const realEvents = await DB.fetchAllEvents();
        if (Array.isArray(realEvents) && realEvents.length) {
          EVENTS.length = 0;
          EVENTS.push(...realEvents);
        }
      }
    } catch (_e) {}

    const config = _getConfig();
    const seated = _isSeatedEvent();
    if (!config.price || (!seated && !config.capacity)) {
      alert('Este evento no tiene boletaje disponible por el momento.');
      _eventId = null;
      return;
    }

    _qty = seated ? 0 : 1;

    _render('tickets');
    document.getElementById('checkout-overlay')?.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    if (typeof SeatsioMaps !== 'undefined' && SeatsioMaps.destroyBuyerChart) {
      SeatsioMaps.destroyBuyerChart();
    }
    document.getElementById('checkout-overlay')?.classList.remove('open');
    document.body.style.overflow = '';
    _eventId = null;
    _qty = 0;
    _selectedSeats = [];
    _seatPriceMap  = {};
    _seatCategoryMap = {};
    _seatsioSessionInit = false;
    _cardElement = null;
  }

  function closeOutside(event) {
    if (event.target === document.getElementById('checkout-overlay')) close();
  }

  function _progressBar(activeStep) {
    const steps = [
      { label: 'Boletos' },
      { label: 'Pago' },
      { label: 'Listo' },
    ];

    let html = '<div class="ck-progress">';
    steps.forEach((step, index) => {
      const state = index < activeStep ? 'done' : index === activeStep ? 'active' : '';
      html += `<div class="ck-step ${state}">
        <div class="ck-step-circle">${index < activeStep ? '<span class="material-symbols-outlined" style="font-size:13px">check</span>' : index + 1}</div>
        <div class="ck-step-label">${step.label}</div>
      </div>`;
      if (index < steps.length - 1) html += `<div class="ck-step-line ${index < activeStep ? 'done' : ''}"></div>`;
    });
    html += '</div>';
    return html;
  }

  function _render(step) {
    const body = document.getElementById('checkout-body');
    if (!body) return;

    if (step !== 'tickets' && typeof SeatsioMaps !== 'undefined' && SeatsioMaps.destroyBuyerChart) {
      SeatsioMaps.destroyBuyerChart();
    }

    if (step === 'tickets') body.innerHTML = _stepTickets();
    if (step === 'confirm') {
      body.innerHTML = _stepConfirm();
      // Montar Stripe Elements después de que el DOM esté listo
      setTimeout(_mountCardElement, 80);
    }
    if (step === 'success') body.innerHTML = _stepSuccess();

    if (step === 'tickets' && _isSeatedEvent()) {
      setTimeout(() => _mountSeatsioChart(), 100);
    }
  }

  function _header(event) {
    const dateLabel = new Date(event.date).toLocaleDateString('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    return `
      <div class="ck-header">
        <div class="ck-event-img" style="background-image:url('${event.image}')"></div>
        <div class="ck-event-info">
          <div class="ck-event-title">${event.title}</div>
          <div class="ck-event-meta">${event.artist}</div>
          <div class="ck-event-meta">${dateLabel}</div>
          <div class="ck-event-meta">${event.venue ? `${event.venue}, ` : ''}${event.city}</div>
        </div>
      </div>`;
  }

  function _stepTickets() {
    const event = _getEvent();
    if (!event) return '<p>Evento no encontrado.</p>';

    const config = _getConfig();
    const seated = _isSeatedEvent();
    const subtotal = config.price * _qty;

    const tierSection = (!seated && event.prices && Object.keys(event.prices).length > 0)
      ? Object.entries(event.prices).map(([tier, price]) => `
            <label style="display:flex;align-items:center;padding:12px;border:${_selectedTier === tier ? '2px' : '1px'} solid transparent;border-radius:12px;margin-bottom:10px;cursor:pointer;background: linear-gradient(var(--bg-surface-2), var(--bg-surface-2)) padding-box, ${_selectedTier === tier ? 'linear-gradient(to right, var(--color-pink), var(--color-purple)) border-box' : 'linear-gradient(var(--border-default), var(--border-default)) border-box'};">
              <input type="radio" name="ck_tier" value="${tier}" ${_selectedTier === tier ? 'checked' : ''} onchange="Checkout.changeTier('${tier}')" style="margin-right:14px;accent-color:var(--color-pink);width:18px;height:18px;">
              <div style="flex:1">
                <div style="font-weight:700;color:var(--text-primary);font-size:1rem">${tier === 'GA' ? 'General (GA)' : tier}</div>
                <div style="font-size:.8rem;color:var(--text-secondary)">Acceso ${tier} al evento</div>
              </div>
              <div style="font-weight:700;font-size:1.1rem;color:var(--text-primary)">$${price.toLocaleString()}</div>
            </label>
          `).join('')
      : (!seated ? `
          <div class="ck-ticket-config">
            <div class="ck-ticket-config-copy">
              <div class="ck-ticket-config-title">Boleto general</div>
              <div class="ck-ticket-config-meta">Precio único por persona</div>
            </div>
            <div class="ck-ticket-config-price">$${config.price.toLocaleString()}</div>
          </div>
        ` : `
          <div class="ck-ticket-config">
            <div class="ck-ticket-config-copy">
              <div class="ck-ticket-config-title">Precios por zona</div>
              <div class="ck-ticket-config-meta">El precio depende de la zona del asiento</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;text-align:right">
              ${event.prices && Object.keys(event.prices).length > 0
                ? Object.entries(event.prices).map(([zone, price]) =>
                    `<div style="font-size:.85rem"><span style="color:var(--text-secondary);margin-right:8px">${zone === 'GA' ? 'General' : zone}</span><strong>$${price.toLocaleString()}</strong></div>`
                  ).join('')
                : `<div style="font-weight:700;font-size:1.1rem">$${config.price.toLocaleString()}/asiento</div>`
              }
            </div>
          </div>
        `);

    const capacitySection = seated ? '' : `
        <div class="ck-ticket-capacity">
          <div class="ck-ticket-capacity-row">
            <span>Capacidad total</span>
            <strong>${config.capacity.toLocaleString()} personas</strong>
          </div>
          <div class="ck-ticket-capacity-row">
            <span>Disponibles ahora</span>
            <strong>${config.remainingKnown ? `${config.remaining.toLocaleString()} boletos` : 'Consultando...'}</strong>
          </div>
        </div>`;

    const qtySection = seated ? '' : `
        <div class="ck-qty-row">
          <div class="ck-qty-label">Cantidad de boletos</div>
          <div class="ck-qty-ctrl">
            <button class="ck-qty-btn" onclick="Checkout.changeQty(-1)">-</button>
            <span class="ck-qty-val" id="ck-qty-val">${_qty}</span>
            <button class="ck-qty-btn" onclick="Checkout.changeQty(1)">+</button>
          </div>
        </div>`;

    const mapSection = seated ? `
        <div class="ck-section-title" style="margin-top:8px">
          <span class="material-symbols-outlined" style="font-size:16px">event_seat</span>
          Mapa de asientos
        </div>
        <p class="ck-seat-hint" id="ck-seat-hint">Selecciona tus asientos en el plano.</p>
        <div id="seatsio-chart-mount"></div>
        <div class="ck-qty-row" style="margin-top:10px;opacity:.85">
          <div class="ck-qty-label">Boletos (según asientos)</div>
          <div class="ck-qty-ctrl" style="pointer-events:none;opacity:.9">
            <span class="ck-qty-val" id="ck-qty-val">${_qty}</span>
          </div>
        </div>
        ` : '';

    return `
      ${_progressBar(0)}
      ${_header(event)}
      <div class="ck-body">
        <div class="ck-section-title">
          <span class="material-symbols-outlined" style="font-size:16px">confirmation_number</span>
          ${seated ? 'Selecciona tus asientos' : 'Selecciona tu tipo de boleto y cantidad'}
        </div>

        ${tierSection}

        ${capacitySection}

        ${seated ? mapSection : qtySection}

        ${!seated ? mapSection : ''}

        <div class="ck-subtotal">
          Subtotal: <strong>$${(_isSeatedEvent() ? _getSeatedTotal() : subtotal).toLocaleString()}</strong>
        </div>

        <button class="ck-btn-primary" onclick="Checkout.goConfirm()" ${(!seated && config.remainingKnown && config.remaining <= 0) || (seated && _qty <= 0) ? 'disabled' : ''}>
          Continuar
          <span class="material-symbols-outlined" style="font-size:18px;vertical-align:middle;margin-left:6px">arrow_forward</span>
        </button>
      </div>`;
  }

  function _stepConfirm() {
    const event = _getEvent();
    const config = _getConfig();
    const total = _isSeatedEvent() ? _getSeatedTotal() : config.price * _qty;
    const seated = _isSeatedEvent();

    if (!event) return '<p>Evento no encontrado.</p>';

    const stripeAvailable = !!(window.Stripe && window.TICKETAZO_CONFIG?.stripePk);

    return `
      ${_progressBar(1)}
      <div class="ck-body">
        <div class="ck-back" onclick="Checkout._render('tickets')">
          <span class="material-symbols-outlined" style="font-size:17px">arrow_back</span>
          ${seated ? 'Volver al mapa' : 'Cambiar cantidad'}
        </div>

        <div class="ck-section-title">
          <span class="material-symbols-outlined" style="font-size:16px">receipt_long</span>
          Resumen de compra
        </div>

        <div class="ck-summary">
          <div class="ck-summary-row"><span>Evento</span><strong>${event.title}</strong></div>
          ${!seated ? `<div class="ck-summary-row"><span>Tipo de boleto</span><strong>${event.prices ? (_selectedTier === 'GA' ? 'General (GA)' : _selectedTier) : 'General'}</strong></div>` : ''}
          ${seated && _selectedSeats.length ? `<div class="ck-summary-row"><span>Asientos</span><strong>${_selectedSeats.join(', ')}</strong></div>` : ''}
          ${seated
            ? Object.entries(
                _selectedSeats.reduce((acc, lbl) => {
                  const cat = _seatCategoryMap[lbl] || 'GA';
                  const price = _seatPriceMap[lbl] || _getConfig().price;
                  acc[cat] = acc[cat] || { count: 0, price };
                  acc[cat].count++;
                  return acc;
                }, {})
              ).map(([zone, { count, price }]) =>
                `<div class="ck-summary-row"><span>${zone === 'GA' ? 'General' : zone} × ${count}</span><strong>$${(price * count).toLocaleString()} MXN</strong></div>`
              ).join('')
            : `<div class="ck-summary-row"><span>Precio por boleto</span><strong>$${config.price.toLocaleString()} MXN</strong></div>
               <div class="ck-summary-row"><span>Cantidad</span><strong>${_qty} boleto${_qty > 1 ? 's' : ''}</strong></div>`
          }
          <div class="ck-summary-divider"></div>
          <div class="ck-summary-row ck-total"><span>Total</span><strong>$${total.toLocaleString()} MXN</strong></div>
        </div>

        <div class="ck-section-title">
          <span class="material-symbols-outlined" style="font-size:16px">credit_card</span>
          Datos de pago
        </div>

        <div class="ck-card-form">
          ${stripeAvailable ? `
            <div class="ck-stripe-container">
              <label class="ck-stripe-label">Tarjeta de crédito o débito</label>
              <div id="stripe-card-element" class="ck-stripe-element"></div>
            </div>
            <div class="ck-secure-note">
              <span class="material-symbols-outlined" style="font-size:14px;color:#22c55e">lock</span>
              Pago seguro procesado por Stripe · Datos cifrados con TLS
            </div>
          ` : `
            <div class="ck-stripe-unavailable">
              <span class="material-symbols-outlined" style="font-size:28px;color:#ff4d6d;display:block;margin-bottom:8px">error_outline</span>
              El sistema de pagos no está disponible en este momento.<br>
              <small>Verifica tu conexión a internet e intenta recargar la página.</small>
            </div>
          `}
        </div>

        <div id="ck-err" class="ck-err hidden"></div>

        <button class="ck-btn-primary" onclick="Checkout.pay()" ${!stripeAvailable ? 'disabled' : ''}>
          <span class="material-symbols-outlined" style="font-size:18px;vertical-align:middle;margin-right:6px">payments</span>
          Pagar $${total.toLocaleString()} MXN
        </button>
      </div>`;
  }

  function _stepSuccess() {
    const event = _getEvent();
    const config = _getConfig();
    const total  = _isSeatedEvent() ? _getSeatedTotal() : config.price * _qty;
    if (!event) return '<p>Compra realizada.</p>';

    return `
      ${_progressBar(2)}
      <div class="ck-success">
        <div class="ck-success-icon">
          <span class="material-symbols-outlined" style="font-size:52px;color:#22c55e" filled>check_circle</span>
        </div>
        <h2 class="ck-success-title">¡Pago exitoso!</h2>
        <p class="ck-success-sub">Tu pago fue procesado por Stripe. Los boletos han sido registrados en tu cuenta.</p>

        <div class="ck-ticket">
          <div class="ck-ticket-header">
            <div class="ck-ticket-logo">
              <span class="material-symbols-outlined" style="font-size:20px;color:#fff">confirmation_number</span>
            </div>
            <div>
              <div class="ck-ticket-event">${event.title}</div>
              <div class="ck-ticket-artist">${event.artist}</div>
            </div>
          </div>
          <div class="ck-ticket-detail">
            <div class="ck-ticket-row"><span>Fecha</span><strong>${new Date(event.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</strong></div>
            <div class="ck-ticket-row"><span>Lugar</span><strong>${event.venue || event.city}</strong></div>
            <div class="ck-ticket-row"><span>Boletos</span><strong>${_qty}</strong></div>
            <div class="ck-ticket-row"><span>Total pagado</span><strong>$${total.toLocaleString()} MXN</strong></div>
          </div>
          <div class="ck-ticket-footer">
            <button class="ck-ticket-link" onclick="Checkout.goToTickets()">Ver boletos con QR</button>
          </div>
        </div>

        <button class="ck-btn-primary" onclick="Checkout.goToTickets()" style="margin-bottom:8px;">
          Ver mis boletos
        </button>
        <button class="ck-btn-secondary" onclick="Checkout.close()">
          Cerrar
        </button>
      </div>`;
  }

  // ── Controles de cantidad / tier ─────────────────────────────────────────────
  function changeQty(delta) {
    if (_isSeatedEvent()) return;
    const config = _getConfig();
    const max = Math.max(1, Math.min(10, config.remaining || 1));
    _qty = Math.max(1, Math.min(_qty + delta, max));

    document.getElementById('ck-qty-val').textContent = _qty;
    const subtotal = document.querySelector('.ck-subtotal');
    if (subtotal) subtotal.innerHTML = `Subtotal: <strong>$${(config.price * _qty).toLocaleString()}</strong>`;
  }

  function goConfirm() {
    const config = _getConfig();
    if (!_isSeatedEvent() && config.remainingKnown && config.remaining <= 0) return;
    if (_isSeatedEvent()) {
      if (!_selectedSeats.length) {
        alert('Selecciona al menos un asiento en el mapa.');
        return;
      }
      _qty = _selectedSeats.length;
    }
    _render('confirm');
  }

  // ── Pago con Stripe ──────────────────────────────────────────────────────────
  async function pay() {
    const stripe = _initStripe();
    const errorEl = document.getElementById('ck-err');
    const button = document.querySelector('#checkout-body .ck-btn-primary');

    function showErr(message) {
      if (errorEl) {
        errorEl.textContent = message;
        errorEl.classList.remove('hidden');
        errorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    function setLoading(isLoading, customText) {
      if (!button) return;
      const config = _getConfig();
      const t = config.price * _qty;
      button.disabled = isLoading;
      button.innerHTML = isLoading
        ? `<span class="ck-spinner"></span> ${customText || 'Procesando...'}`
        : `<span class="material-symbols-outlined" style="font-size:18px;vertical-align:middle;margin-right:6px">payments</span>Pagar $${t.toLocaleString()} MXN`;
    }

    if (!stripe) {
      showErr('El sistema de pago no está disponible. Recarga la página e intenta de nuevo.');
      return;
    }
    if (!_cardElement) {
      showErr('El formulario de tarjeta no está listo. Espera un momento e intenta de nuevo.');
      return;
    }

    if (errorEl) errorEl.classList.add('hidden');
    setLoading(true, 'Iniciando pago...');

    const config = _getConfig();
    const total = _isSeatedEvent() ? _getSeatedTotal() : config.price * _qty;
    const totalCentavos = Math.round(total * 100);
    const session = typeof Auth !== 'undefined' && Auth.session ? Auth.session() : null;

    try {
      // Paso 1: Crear PaymentIntent en el servidor
      setLoading(true, 'Preparando cobro...');
      const { clientSecret, paymentIntentId } = await _createPaymentIntent(totalCentavos);

      // Paso 2: Confirmar pago con Stripe.js (el usuario ingresó los datos en Stripe Elements)
      setLoading(true, 'Procesando tarjeta...');
      const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: _cardElement,
          billing_details: {
            name: session?.name || 'Cliente Ticketazo',
            email: session?.email || undefined,
          },
        },
      });

      if (stripeError) {
        // Stripe devuelve el mensaje en español si locale = 'es'
        throw new Error(stripeError.message);
      }

      if (paymentIntent?.status !== 'succeeded') {
        throw new Error('El pago no fue aprobado. Intenta con otra tarjeta.');
      }

      // Paso 3: Registrar boleto(s) en la base de datos agrupados por zona/precio
      setLoading(true, 'Registrando boletos...');
      if (typeof Profile !== 'undefined' && Profile.addTickets) {
        if (_isSeatedEvent() && _selectedSeats.length) {
          // Agrupa asientos por categoría so each zone gets the correct unit price
          const groups = {};
          _selectedSeats.forEach(lbl => {
            const cat   = _seatCategoryMap[lbl] || 'GA';
            const price = _seatPriceMap[lbl]    || config.price;
            if (!groups[cat]) groups[cat] = { seats: [], price };
            groups[cat].seats.push(lbl);
          });
          for (const [tier, { seats, price }] of Object.entries(groups)) {
            await Profile.addTickets(_eventId, seats.length, price, tier, paymentIntent.id, seats);
          }
        } else {
          await Profile.addTickets(_eventId, _qty, config.price, _selectedTier, paymentIntent.id, null);
        }
      }

      // Paso 3b: Marcar asientos como ocupados en seats.io para que no se puedan volver a comprar
      if (_isSeatedEvent() && _selectedSeats.length && typeof SeatsioMaps !== 'undefined' && SeatsioMaps.bookSeats) {
        const ev = _getEvent();
        const eventKey = ev?.seatsioEventKey || '';
        if (eventKey) {
          setLoading(true, 'Confirmando asientos...');
          try {
            await SeatsioMaps.bookSeats(eventKey, _selectedSeats);
          } catch (bookErr) {
            console.warn('[Checkout] No se pudo marcar asientos en seats.io:', bookErr);
          }
        }
      }

      // Paso 4: Mostrar pantalla de éxito
      _render('success');

    } catch (err) {
      console.error('[Checkout] Error en el pago con Stripe:', err);
      showErr(err.message || 'Ocurrió un error al procesar el pago. Intenta de nuevo.');
      setLoading(false);
    }
  }

  function goToTickets() {
    close();
    if (typeof Profile !== 'undefined' && typeof Profile.open === 'function') {
      Profile.open();
      return;
    }
    App.navigate('profile');
  }

  // Mantener fmtCard/fmtExp por si algo en el HTML los referencia (no-op)
  function fmtCard(input) {
    input.value = input.value.replace(/\D/g, '').slice(0, 16).replace(/(.{4})(?=\d)/g, '$1 ');
  }

  function fmtExp(input) {
    const clean = input.value.replace(/\D/g, '').slice(0, 4);
    input.value = clean.length > 2 ? `${clean.slice(0, 2)}/${clean.slice(2)}` : clean;
  }

  return {
    open,
    close,
    closeOutside,
    changeQty,
    changeTier: (tier) => {
      _selectedTier = tier;
      if (_isSeatedEvent()) {
        _selectedSeats = [];
        _qty = 0;
        _seatsioSessionInit = false;
      }
      _render('tickets');
    },
    goConfirm,
    pay,
    goToTickets,
    fmtCard,
    fmtExp,
    _render,
  };
})();

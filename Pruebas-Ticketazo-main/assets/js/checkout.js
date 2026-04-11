/**
 * checkout.js
 * Flujo simple de compra de boletos.
 * Paso 1: Cantidad
 * Paso 2: Pago
 * Paso 3: Confirmacion
 */

window.Checkout = (() => {
  let _eventId = null;
  let _qty = 1;

  function _getEvent() {
    return EVENTS.find(event => event.id === _eventId) || null;
  }

  function _getConfig() {
    const event = _getEvent();
    const config = typeof Zones !== 'undefined' && Zones.getTicketConfig
      ? Zones.getTicketConfig(_eventId)
      : { price: event?.ticketPrice || 0, capacity: event?.ticketCapacity || 0 };
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

  function open(eventId) {
    _eventId = eventId;
    _qty = 1;

    const config = _getConfig();
    if (!config.price || !config.capacity) {
      alert('Este evento no tiene boletaje disponible por el momento.');
      _eventId = null;
      return;
    }

    _render('tickets');
    document.getElementById('checkout-overlay')?.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    document.getElementById('checkout-overlay')?.classList.remove('open');
    document.body.style.overflow = '';
    _eventId = null;
    _qty = 1;
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

    if (step === 'tickets') body.innerHTML = _stepTickets();
    if (step === 'confirm') body.innerHTML = _stepConfirm();
    if (step === 'success') body.innerHTML = _stepSuccess();
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
    const subtotal = config.price * _qty;

    return `
      ${_progressBar(0)}
      ${_header(event)}
      <div class="ck-body">
        <div class="ck-section-title">
          <span class="material-symbols-outlined" style="font-size:16px">confirmation_number</span>
          Selecciona tu cantidad
        </div>

        <div class="ck-ticket-config">
          <div class="ck-ticket-config-copy">
            <div class="ck-ticket-config-title">Boleto general</div>
            <div class="ck-ticket-config-meta">Precio unico por persona</div>
          </div>
          <div class="ck-ticket-config-price">$${config.price.toLocaleString()}</div>
        </div>

        <div class="ck-ticket-capacity">
          <div class="ck-ticket-capacity-row">
            <span>Capacidad total</span>
            <strong>${config.capacity.toLocaleString()} personas</strong>
          </div>
          <div class="ck-ticket-capacity-row">
            <span>Disponibles ahora</span>
            <strong>${config.remainingKnown ? `${config.remaining.toLocaleString()} boletos` : 'Consultando...'}</strong>
          </div>
        </div>

        <div class="ck-qty-row">
          <div class="ck-qty-label">Cantidad de boletos</div>
          <div class="ck-qty-ctrl">
            <button class="ck-qty-btn" onclick="Checkout.changeQty(-1)">-</button>
            <span class="ck-qty-val" id="ck-qty-val">${_qty}</span>
            <button class="ck-qty-btn" onclick="Checkout.changeQty(1)">+</button>
          </div>
        </div>

        <div class="ck-subtotal">
          Subtotal: <strong>$${subtotal.toLocaleString()}</strong>
        </div>

        <button class="ck-btn-primary" onclick="Checkout.goConfirm()" ${config.remainingKnown && config.remaining <= 0 ? 'disabled' : ''}>
          Continuar
          <span class="material-symbols-outlined" style="font-size:18px;vertical-align:middle;margin-left:6px">arrow_forward</span>
        </button>
      </div>`;
  }

  function _stepConfirm() {
    const event = _getEvent();
    const config = _getConfig();
    const total = config.price * _qty;

    if (!event) return '<p>Evento no encontrado.</p>';

    return `
      ${_progressBar(1)}
      <div class="ck-body">
        <div class="ck-back" onclick="Checkout._render('tickets')">
          <span class="material-symbols-outlined" style="font-size:17px">arrow_back</span>
          Cambiar cantidad
        </div>

        <div class="ck-section-title">
          <span class="material-symbols-outlined" style="font-size:16px">receipt_long</span>
          Resumen de compra
        </div>

        <div class="ck-summary">
          <div class="ck-summary-row"><span>Evento</span><strong>${event.title}</strong></div>
          <div class="ck-summary-row"><span>Precio por boleto</span><strong>$${config.price.toLocaleString()}</strong></div>
          <div class="ck-summary-row"><span>Cantidad</span><strong>${_qty} boleto${_qty > 1 ? 's' : ''}</strong></div>
          <div class="ck-summary-row"><span>Disponibles</span><strong>${config.remainingKnown ? config.remaining.toLocaleString() : 'Consultando...'}</strong></div>
          <div class="ck-summary-divider"></div>
          <div class="ck-summary-row ck-total"><span>Total</span><strong>$${total.toLocaleString()}</strong></div>
        </div>

        <div class="ck-section-title">
          <span class="material-symbols-outlined" style="font-size:16px">credit_card</span>
          Datos de pago
        </div>

        <div class="ck-card-form">
          <div class="ck-field">
            <label>Numero de tarjeta</label>
            <input type="text" id="ck-card-num" placeholder="0000 0000 0000 0000" maxlength="19"
              oninput="Checkout.fmtCard(this)" class="ck-input"/>
          </div>
          <div class="ck-field-row">
            <div class="ck-field">
              <label>Titular</label>
              <input type="text" id="ck-card-name" placeholder="Como en la tarjeta" class="ck-input"/>
            </div>
            <div class="ck-field ck-field--sm">
              <label>Vence</label>
              <input type="text" id="ck-card-exp" placeholder="MM/AA" maxlength="5"
                oninput="Checkout.fmtExp(this)" class="ck-input"/>
            </div>
            <div class="ck-field ck-field--sm">
              <label>CVC</label>
              <input type="text" id="ck-card-cvc" placeholder="..." maxlength="4"
                oninput="this.value=this.value.replace(/\\D/g,'')" class="ck-input"/>
            </div>
          </div>
          <div class="ck-secure-note">
            <span class="material-symbols-outlined" style="font-size:14px;color:#22c55e">lock</span>
            Pago simulado · Tus datos no se almacenan
          </div>
        </div>

        <div id="ck-err" class="ck-err hidden"></div>

        <button class="ck-btn-primary" onclick="Checkout.pay()">
          <span class="material-symbols-outlined" style="font-size:18px;vertical-align:middle;margin-right:6px">payments</span>
          Pagar $${total.toLocaleString()}
        </button>
      </div>`;
  }

  function _stepSuccess() {
    const event = _getEvent();
    const config = _getConfig();
    const total = config.price * _qty;
    if (!event) return '<p>Compra realizada.</p>';

    return `
      ${_progressBar(2)}
      <div class="ck-success">
        <div class="ck-success-icon">
          <span class="material-symbols-outlined" style="font-size:52px;color:#22c55e" filled>check_circle</span>
        </div>
        <h2 class="ck-success-title">Compra exitosa</h2>
        <p class="ck-success-sub">Tus boletos han sido registrados en tu cuenta.</p>

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
            <div class="ck-ticket-row"><span>Total</span><strong>$${total.toLocaleString()}</strong></div>
          </div>
          <div class="ck-ticket-footer">
            <button class="ck-ticket-link" onclick="Checkout.goToTickets()">Ver boletos</button>
          </div>
        </div>

        <button class="ck-btn-primary" onclick="Checkout.goToTickets()" style="margin-bottom:8px;">
          Ver boletos
        </button>
        <button class="ck-btn-secondary" onclick="Checkout.close()">
          Cerrar
        </button>
      </div>`;
  }

  function changeQty(delta) {
    const config = _getConfig();
    const max = Math.max(1, Math.min(10, config.remaining || 1));
    _qty = Math.max(1, Math.min(_qty + delta, max));

    document.getElementById('ck-qty-val').textContent = _qty;
    const subtotal = document.querySelector('.ck-subtotal');
    if (subtotal) subtotal.innerHTML = `Subtotal: <strong>$${(config.price * _qty).toLocaleString()}</strong>`;
  }

  function goConfirm() {
    const config = _getConfig();
    if (config.remainingKnown && config.remaining <= 0) return;
    _render('confirm');
  }

  function fmtCard(input) {
    input.value = input.value.replace(/\D/g, '').slice(0, 16).replace(/(.{4})(?=\d)/g, '$1 ');
  }

  function fmtExp(input) {
    const clean = input.value.replace(/\D/g, '').slice(0, 4);
    input.value = clean.length > 2 ? `${clean.slice(0, 2)}/${clean.slice(2)}` : clean;
  }

  function pay() {
    const number = document.getElementById('ck-card-num')?.value.replace(/\s/g, '');
    const name = document.getElementById('ck-card-name')?.value.trim();
    const exp = document.getElementById('ck-card-exp')?.value.trim();
    const cvc = document.getElementById('ck-card-cvc')?.value.trim();
    const errorEl = document.getElementById('ck-err');

    function showErr(message) {
      errorEl.textContent = message;
      errorEl.classList.remove('hidden');
    }

    if (number.length < 16) {
      showErr('Ingresa un numero de tarjeta valido (16 digitos).');
      return;
    }
    if (!name) {
      showErr('Ingresa el nombre del titular.');
      return;
    }
    if (exp.length < 5) {
      showErr('Ingresa la fecha de vencimiento (MM/AA).');
      return;
    }
    if (cvc.length < 3) {
      showErr('Ingresa el CVC (3 o 4 digitos).');
      return;
    }

    errorEl.classList.add('hidden');
    const button = document.querySelector('.ck-btn-primary');
    if (button) {
      button.disabled = true;
      button.textContent = 'Procesando...';
    }

    const config = _getConfig();
    setTimeout(() => {
      void (async () => {
        try {
          if (typeof Profile !== 'undefined' && Profile.addTickets) {
            await Profile.addTickets(_eventId, _qty, config.price);
          }
          _render('success');
        } catch (err) {
          console.error('[Checkout] Error registrando la compra:', err);
          showErr('No pudimos registrar la compra en la base de datos. Intenta de nuevo.');
          if (button) {
            button.disabled = false;
            button.innerHTML = `<span class="material-symbols-outlined" style="font-size:18px;vertical-align:middle;margin-right:6px">payments</span>Pagar $${(config.price * _qty).toLocaleString()}`;
          }
        }
      })();
    }, 1200);
  }

  function goToTickets() {
    close();
    if (typeof Profile !== 'undefined' && typeof Profile.open === 'function') {
      Profile.open();
      return;
    }
    App.navigate('profile');
  }

  return {
    open,
    close,
    closeOutside,
    changeQty,
    goConfirm,
    pay,
    goToTickets,
    fmtCard,
    fmtExp,
    _render,
  };
})();

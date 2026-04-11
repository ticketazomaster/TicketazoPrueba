window.DashboardViews = (() => {
  function _fixedTierRow(tier) {
    return `
      <div class="db-tier-row" data-tier="${tier.key}">
        <div class="db-tier-badge">
          <span class="db-tier-dot" style="background:${tier.color}"></span>
          <div class="db-tier-copy">
            <div class="db-tier-name">${tier.label}</div>
            <div class="db-tier-note">${tier.note}</div>
          </div>
        </div>
        <div class="db-field db-field--compact">
          <label class="db-label">Precio</label>
          <input class="db-input" type="number" min="0" value="${tier.price}" />
        </div>
        <div class="db-field db-field--compact">
          <label class="db-label">Capacidad</label>
          <input class="db-input" type="number" min="1" value="${tier.capacity}" />
        </div>
      </div>`;
  }

  function renderCreateForm(ctx) {
    if (ctx.role === 'organizer' && !ctx.hasCard) {
      return `
        <div class="db-page-header"><div><h1>Crear Nuevo Evento</h1></div></div>
        <div class="db-card" style="text-align:center; padding: 40px 20px;">
          <div style="font-size:3rem; margin-bottom:16px;"><span class="material-symbols-outlined" style="font-size:48px; color:#ca8a04;">account_balance</span></div>
          <div style="font-weight:700; font-size:1.1rem; color:#1e293b; margin-bottom:8px;">Se requiere cuenta bancaria</div>
          <div style="font-size:0.88rem; color:#64748b; margin-bottom:20px; max-width:400px; margin-left:auto; margin-right:auto;">
            Para poder crear y publicar eventos, primero debes registrar tu cuenta bancaria (CLABE) en tu perfil. Los pagos de boletaje se depositaran ahi.
          </div>
          <button class="db-btn db-btn-primary" onclick="Profile.open()">
            <span class="material-symbols-outlined" style="font-size:16px;vertical-align:middle;margin-right:6px">manage_accounts</span>
            Registrar Cuenta Bancaria
          </button>
        </div>`;
    }

    return `
      <div class="db-page-header"><div><h1>Crear Nuevo Evento</h1><p>Define informacion y niveles de boletos.</p></div></div>
      <div class="db-card"><div class="db-card-head"><div class="db-card-title">Informacion General</div></div>
        <div class="db-card-body"><div class="db-grid2">
          <div class="db-field"><label class="db-label">Nombre del Evento</label><input class="db-input" type="text" placeholder="Ej. Most Wanted Tour"/></div>
          <div class="db-field"><label class="db-label">Artista / Grupo</label><input class="db-input" type="text" placeholder="Nombre del artista"/></div>
          <div class="db-field"><label class="db-label">Nombre de Gira <span style="color:#9ca3af;font-weight:400">- opcional</span></label><input class="db-input" type="text" placeholder="Ej. Most Wanted Tour 2026"/></div>
          <div class="db-field"><label class="db-label">Categoria</label><select class="db-select"><option value="">Selecciona...</option>${ctx.categories.map(category => `<option>${category}</option>`).join('')}</select></div>
          <div class="db-field"><label class="db-label">Fecha</label><input class="db-input" type="date"/></div>
          <div class="db-field"><label class="db-label">Hora</label><input class="db-input" type="time" value="20:00"/></div>
          <div class="db-field"><label class="db-label">Ciudad</label><input class="db-input" type="text" placeholder="Ciudad"/></div>
          <div class="db-field"><label class="db-label">Recinto</label><input class="db-input" type="text" placeholder="Ej. Foro Sol"/></div>
        </div><label class="db-checkbox" style="margin-top:6px"><input type="checkbox"/><span>Solo para adultos (+18)</span></label>
        </div></div>
      <div class="db-card"><div class="db-card-head"><div class="db-card-title">Imagen Promocional</div></div>
        <div class="db-card-body">
          <div class="db-upload" id="db-upload-area" onclick="document.getElementById('db-file-input').click()" ondragover="event.preventDefault(); this.classList.add('dragover')" ondragleave="this.classList.remove('dragover')" ondrop="Zones.handleDrop(event, this)">
            <input type="file" id="db-file-input" style="display:none" accept="image/*" onchange="Zones.handleFileSelect(this, document.getElementById('db-upload-area'))"/>
            <div class="db-upload-icon">${ctx.uploadIcon}</div>
            <div class="db-upload-text">Arrastra o haz clic para subir imagen</div>
            <div class="db-upload-hint">JPG, PNG, WEBP - Max. 10 MB</div>
          </div>
        </div>
      </div>
      <div class="db-card"><div class="db-card-head db-create-ticket-head"><div class="db-card-title"><span style="display:inline-flex;margin-right:6px;vertical-align:text-bottom">${ctx.ticketIcon}</span> Niveles de Boletos</div><span class="db-create-ticket-note">Solo se permiten VIP, Oro y General. El tesorero aprueba los precios.</span></div>
        <div class="db-card-body">
          <div class="db-tier-list" id="new-zone-rows">${ctx.fixedTicketTiers.map(_fixedTierRow).join('')}</div>
        </div></div>
      <div class="db-card"><div class="db-card-head"><div class="db-card-title">Descripcion</div></div>
        <div class="db-card-body"><textarea class="db-textarea" rows="4" placeholder="Describe el evento..."></textarea></div></div>
      <div class="db-create-actions">
        <button class="db-btn db-btn-secondary">Guardar borrador</button>
        <button class="db-btn db-btn-primary" onclick="alert('Enviado al tesorero para revision.')">Crear y enviar <span class="material-symbols-outlined" style="font-size: 14px; margin-left:6px; vertical-align: middle;">arrow_forward</span></button>
      </div>`;
  }

  function renderPayouts(ctx) {
    return `<div class="db-page-header">
        <div>
          <h1>Pagos a Organizadores</h1>
          <p>Consulta la informacion bancaria y distribuye ingresos.</p>
        </div>
      </div>
      ${ctx.rows.map(org => `
        <div class="db-card db-payout-card">
          <div class="db-card-head db-payout-head">
            <div class="db-payout-profile">
              <div class="db-payout-avatar">${ctx.personIcon}</div>
              <div class="db-payout-meta">
                <div class="db-card-title">${org.name}</div>
                <div class="db-payout-email">${org.email}</div>
              </div>
            </div>
          </div>
          <div class="db-card-body">
            <div class="db-payout-bank">
              <div class="db-payout-bank-copy">
                <div class="db-payout-bank-label">Cuenta bancaria registrada</div>
                <div class="db-payout-bank-name">
                  <span class="material-symbols-outlined" style="font-size:14px;color:#8B5CF6">account_balance</span>
                  ${org.bankName}
                </div>
                <div class="db-payout-clabe">${org.clabe}</div>
              </div>
              <button class="db-btn db-btn-secondary db-payout-copy" onclick="Zones.copyBankNumber('${org.clabe}')">
                <span class="material-symbols-outlined" style="font-size:16px">content_copy</span>
                Copiar CLABE
              </button>
            </div>
            <div class="db-payout-stats">
              <div class="db-stat blue">
                <div class="db-stat-icon">${ctx.bankIcon}</div>
                <div>
                  <div class="db-stat-label">Ingresos Brutos</div>
                  <div class="db-stat-value">${org.grossLabel}</div>
                </div>
              </div>
              <div class="db-stat pink">
                <div class="db-stat-icon">%</div>
                <div>
                  <div class="db-stat-label">Comision 5%</div>
                  <div class="db-stat-value db-payout-minus">${org.feeLabel}</div>
                </div>
              </div>
              <div class="db-stat green">
                <div class="db-stat-icon">${ctx.walletIcon}</div>
                <div>
                  <div class="db-stat-label">A Transferir</div>
                  <div class="db-stat-value db-payout-plus">${org.payoutLabel}</div>
                </div>
              </div>
            </div>
            <div class="db-payout-events-label">Eventos generadores de saldo:</div>
            <div class="db-payout-events">
              ${org.events.map(eventName => `<span class="db-payout-event"><span>${ctx.ticketIcon}</span>${eventName}</span>`).join('')}
            </div>
          </div>
        </div>`).join('')}`;
  }

  function renderRefunds(ctx) {
    if (!ctx.rows.length) {
      return `<div class="db-page-header"><div><h1>Reembolsos</h1><p>Aqui apareceran las solicitudes que envien los clientes.</p></div></div>
        <div class="db-empty"><div class="db-empty-icon"></div><div class="db-empty-text">Aun no hay solicitudes de reembolso.</div></div>`;
    }

    return `<div class="db-page-header">
        <div>
          <h1>Reembolsos</h1>
          <p>Solicitudes enviadas por clientes para revision del tesorero.</p>
        </div>
        <span class="db-badge pending">${ctx.summary.pending} pendiente${ctx.summary.pending === 1 ? '' : 's'}</span>
      </div>
      <div class="db-stats">
        <div class="db-stat pink"><div class="db-stat-icon">${ctx.replyIcon}</div><div><div class="db-stat-label">Pendientes</div><div class="db-stat-value">${ctx.summary.pending}</div></div></div>
        <div class="db-stat green"><div class="db-stat-icon">${ctx.approvedIcon}</div><div><div class="db-stat-label">Aprobados</div><div class="db-stat-value">${ctx.summary.approved}</div></div></div>
        <div class="db-stat purple"><div class="db-stat-icon">${ctx.rejectedIcon}</div><div><div class="db-stat-label">Rechazados</div><div class="db-stat-value">${ctx.summary.rejected}</div></div></div>
      </div>
      <div class="db-card">
        <div class="db-table-wrap">
          <table class="db-table">
            <thead>
              <tr>
                <th>Solicitud</th>
                <th>Cliente</th>
                <th>Evento</th>
                <th>Monto</th>
                <th>Motivo</th>
                <th>Estado</th>
                <th>Accion</th>
              </tr>
            </thead>
            <tbody>
              ${ctx.rows.map(refund => `
                <tr>
                  <td>
                    <code style="font-size:.75rem;color:#8A2BE2">${refund.id}</code>
                    <div style="font-size:.7rem;color:#94a3b8;margin-top:4px">${refund.dateLabel}</div>
                  </td>
                  <td>
                    <div style="font-weight:700;color:#0f172a;font-size:.8rem">${refund.userName}</div>
                    <div style="font-size:.72rem;color:#64748b;margin-top:3px">${refund.userEmail}</div>
                  </td>
                  <td>
                    <div style="font-weight:700;color:#0f172a;font-size:.8rem">${refund.eventTitle}</div>
                    <div style="font-size:.72rem;color:#64748b;margin-top:3px">Zona: ${refund.zoneLabel}</div>
                  </td>
                  <td style="font-weight:700">${refund.amountLabel}</td>
                  <td style="min-width:220px">
                    <div style="font-size:.78rem;line-height:1.45;color:#334155">${refund.reason}</div>
                  </td>
                  <td><span class="db-badge ${refund.statusClass}">${refund.statusLabel}</span></td>
                  <td>${refund.actionHtml}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  function renderOverview(ctx) {
    return `<div class="db-page-header"><div><h1>Centro de Control</h1><p>Supervision global.</p></div><div style="background:rgba(138,43,226,.08);color:#8A2BE2;padding:6px 14px;border-radius:9px;font-size:.78rem;font-weight:700;border:1px solid rgba(138,43,226,.15)">Operativa</div></div>
      <div class="db-stats">
        <div class="db-stat blue"><div class="db-stat-icon">${ctx.groupIcon}</div><div><div class="db-stat-label">Usuarios</div><div class="db-stat-value">45,231</div></div></div>
        <div class="db-stat pink"><div class="db-stat-icon">${ctx.notificationIcon}</div><div><div class="db-stat-label">Alertas</div><div class="db-stat-value">2</div></div></div>
        <div class="db-stat purple"><div class="db-stat-icon">${ctx.pendingActionsIcon}</div><div><div class="db-stat-label">Eventos Pendientes</div><div class="db-stat-value">${ctx.pendingEvents.length}</div></div></div>
      </div>
      <div class="db-card"><div class="db-card-head"><div class="db-card-title">Solicitudes Pendientes</div></div><div class="db-card-body">
        ${ctx.pendingEvents.length ? ctx.pendingEvents.map(ev => `<div style="display:flex;align-items:center;justify-content:space-between;padding:11px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:9px;margin-bottom:7px;flex-wrap:wrap;gap:7px"><div style="display:flex;align-items:center;gap:9px"><img src="${ev.image}" style="width:36px;height:36px;border-radius:7px;object-fit:cover"/><div><div style="font-size:.82rem;font-weight:600;color:#0f172a">${ev.title}</div><div style="font-size:.7rem;color:#64748b">${ev.organizerId || 'eber.higuera@gmail.com'}</div></div></div><button class="db-btn db-btn-primary" style="font-size:.73rem;padding:6px 12px" onclick="Zones.switchTab('review',document.getElementById('tab-review'))">Revisar -></button></div>`).join('') : `<div class="db-empty"><div class="db-empty-icon"></div><div class="db-empty-text">Sin solicitudes</div></div>`}
      </div></div>`;
  }

  return {
    renderCreateForm,
    renderPayouts,
    renderRefunds,
    renderOverview,
  };
})();

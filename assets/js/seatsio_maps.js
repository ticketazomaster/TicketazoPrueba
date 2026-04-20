/**
 * seats.io – diseñador embebido y mapa de compra.
 * Publicar en seats.io solo puede hacerse desde un servidor (CORS); la Edge Function `seatsio-publish` hace ese paso.
 * Aquí: auto-publicación con debounce tras cada guardado del diseñador + publicación final al cerrar.
 */

window.SeatsioMaps = (() => {
  let _designer = null;
  let _buyerChart = null;
  let _lastDesignerChartKey = null;
  let _chartUpdateUiTimer = null;
  let _publishDebounceTimer = null;
  let _publishInFlight = false;

  function _regionCdn() {
    const r = (window.TICKETAZO_CONFIG && window.TICKETAZO_CONFIG.seatsioRegion) || 'na';
    const regionUrl = `https://cdn-${r}.seatsio.net/chart.js`;
    // CDN global (evita fallos si la región configurada no coincide con la cuenta)
    const globalUrl = 'https://cdn.seatsio.net/chart.js';
    return { regionUrl, globalUrl };
  }

  function _setDraftStatus(text, isError) {
    const el = document.getElementById('seatsio-draft-status');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isError ? '#b91c1c' : '#64748b';
  }

  function loadChartJs() {
    return new Promise((resolve, reject) => {
      // Ya cargado correctamente
      if (
        typeof window.seatsio !== 'undefined' &&
        (window.seatsio.SeatingChart ||
          window.seatsio.SeatingChartDesigner ||
          window.seatsio.EmbeddedDesigner)
      ) {
        resolve();
        return;
      }
      // Script ya en DOM — esperar su evento load
      const existing = document.querySelector('script[data-seatsio-chart="1"]');
      if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('seats.io chart.js fallo')));
        return;
      }
      const r = (window.TICKETAZO_CONFIG && window.TICKETAZO_CONFIG.seatsioRegion) || 'na';
      const urls = [
        `https://cdn-${r}.seatsio.net/chart.js`,
        'https://cdn.seatsio.net/chart.js',
      ];
      let i = 0;
      const s = document.createElement('script');
      s.async = true;
      s.setAttribute('data-seatsio-chart', '1');
      s.onload = () => resolve();
      s.onerror = () => {
        i++;
        if (i < urls.length) { s.src = urls[i]; }
        else { reject(new Error('No se pudo cargar seats.io chart.js')); }
      };
      s.src = urls[i];
      document.head.appendChild(s);
    });
  }

  function _clearPublishTimers() {
    if (_chartUpdateUiTimer) clearTimeout(_chartUpdateUiTimer);
    _chartUpdateUiTimer = null;
    if (_publishDebounceTimer) clearTimeout(_publishDebounceTimer);
    _publishDebounceTimer = null;
  }

  function destroyDesigner() {
    try {
      if (_designer && typeof _designer.destroy === 'function') _designer.destroy();
    } catch (_e) {}
    _designer = null;
    _clearPublishTimers();
    _lastDesignerChartKey = null;
    const mount = document.getElementById('seatsio-designer-mount');
    if (mount) mount.innerHTML = '';
  }

  function destroyBuyerChart() {
    try {
      if (_buyerChart && typeof _buyerChart.destroy === 'function') _buyerChart.destroy();
    } catch (_e) {}
    _buyerChart = null;
  }

  function closeDesigner() {
    void _closeDesignerAsync();
  }

  async function _closeDesignerAsync() {
    _clearPublishTimers();
    destroyDesigner();
    document.getElementById('seatsio-designer-overlay')?.classList.remove('open');
  }

  function _escapeHtml(t) {
    const d = document.createElement('div');
    d.textContent = t == null ? '' : String(t);
    return d.innerHTML;
  }

  async function _persistSeatMapRow(chartKey, defaultName, opts = {}, preferredName = '', seatsioEventKey = '') {
    const silent = !!opts.silent;
    if (!chartKey || typeof DB === 'undefined' || !DB.insertSeatMap) return null;

    let adminId = null;
    try {
      if (typeof Auth !== 'undefined' && Auth.session && DB.findAdministratorByEmail) {
        const sess = Auth.session();
        const adm = await DB.findAdministratorByEmail(sess.email);
        adminId = adm?.id || null;
      }
    } catch (_e) {}

    let row = null;
    try {
      const nombreFinal = (preferredName || '').trim() || `${defaultName} – ${String(chartKey).slice(0, 20)}`;
      row = await DB.insertSeatMap({
        nombre: nombreFinal,
        seatsioChartKey: chartKey,
        seatsioEventKey: seatsioEventKey || undefined,
        createdByAdminId: adminId,
      });
    } catch (err) {
      const msg = String(err?.message || err || '');
      const dup = msg.includes('duplicate') || msg.includes('unique') || err?.code === '23505';
      if (dup && DB.client) {
        const sb = DB.client();
        const tbl = DB.getConfig?.().tables?.seatMaps || 'mapa_asiento';
        const { data } = await sb.from(tbl).select('id,nombre,seatsio_chart_key,seatsio_event_key').eq('seatsio_chart_key', chartKey).maybeSingle();
        if (data) row = data;
      }
      if (!row) {
        console.error(err);
        if (!silent) alert('No se pudo guardar el mapa en Ticketazo: ' + (err.message || err));
        return null;
      }
    }

    const hid = document.getElementById('db-seat-map-db-id');
    const sel = document.getElementById('db-seat-map-existing');
    if (hid) hid.value = String(row.id);
    if (sel) {
      const existing = sel.querySelector(`option[value="${row.id}"]`);
      if (!existing) {
        const opt = document.createElement('option');
        opt.value = String(row.id);
        opt.textContent = `${row.nombre} – ${row.seatsio_chart_key}`;
        opt.dataset.chartKey = row.seatsio_chart_key;
        sel.appendChild(opt);
      }
      sel.value = String(row.id);
      // Disparar evento para que se actualice la nota y capacidad detectada
      sel.dispatchEvent(new Event('change'));
    }
    const note = document.getElementById('db-seat-map-new-status');
    if (note) {
      note.textContent = `Mapa publicado y guardado: ${row.nombre} (listo para compradores)`;
      note.classList.remove('hidden');
    }
    if (row?.id && seatsioEventKey && DB.updateSeatMapSeatsioEventKey) {
      try {
        await DB.updateSeatMapSeatsioEventKey(row.id, seatsioEventKey);
      } catch (_e) {}
    }
    return row;
  }

  async function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** Bases posibles …/functions/v1 (evita 404 si falta /v1 o sobra /seatsio-publish en config). */
  function _functionsInvokeBases() {
    const cfg = window.TICKETAZO_CONFIG || {};
    const db = typeof DB !== 'undefined' && DB.getConfig ? DB.getConfig() : {};
    const list = [];
    let t = String(cfg.supabaseFunctionsUrl || '').trim();
    if (t) {
      t = t.replace(/\/+$/, '').replace(/\/seatsio-publish$/i, '');
      if (!/\/functions\/v1$/i.test(t)) {
        const root = t.replace(/\/functions.*$/i, '').replace(/\/+$/, '');
        t = `${root}/functions/v1`;
      }
      list.push(t);
    }
    const sup = String(db.supabaseUrl || '').replace(/\/+$/, '');
    if (sup) list.push(`${sup}/functions/v1`);
    return [...new Set(list.filter(Boolean))];
  }

  async function _postSeatsioPublish(bases, authToken, body, maxAttempts = 3) {
    const slug = 'seatsio-publish';
    let lastErr = null;
    let last404 = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      for (const base of bases) {
        const invokeUrl = `${String(base).replace(/\/$/, '')}/${slug}`;
        try {
          const resp = await fetch(invokeUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: authToken,
              Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify(body || {}),
          });
          if (resp.status !== 404) {
            return resp;
          }
          last404 = resp;
        } catch (e) {
          lastErr = e;
        }
      }
      if (attempt < maxAttempts) await _sleep(350 * attempt);
    }

    if (last404) return last404;
    throw lastErr || new Error('fetch');
  }

  /**
   * Publica en seats.io (Edge Function) y persiste fila en Supabase.
   * @param {{ silent?: boolean }} opts silent=no alerts (auto-guardado / cierre)
   */
  async function _publishAndPersistOnce(chartKey, opts = {}) {
    const silent = !!opts.silent;
    const dbConfig = typeof DB !== 'undefined' && DB.getConfig ? DB.getConfig() : {};
    const authToken = dbConfig.supabaseAnonKey || '';
    const defaultName = (document.getElementById('db-new-title')?.value || '').trim() || 'Mapa sin nombre';
    const bases = _functionsInvokeBases();

    if (!chartKey) {
      return { ok: false, message: 'Sin chartKey.' };
    }
    if (!authToken) {
      const m = 'Falta la anon key de Supabase (db.js).';
      if (!silent) alert(m);
      return { ok: false, message: m };
    }
    if (!bases.length) {
      const m = 'Falta supabaseFunctionsUrl en TICKETAZO_CONFIG o supabaseUrl en db.js.';
      if (!silent) alert(m);
      return { ok: false, message: m };
    }

    if (_publishInFlight) {
      return { ok: false, message: 'busy' };
    }
    _publishInFlight = true;

    try {
      const resp = await _postSeatsioPublish(bases, authToken, { chartKey, ensureEvent: true }, 3);

      const data = await resp.json().catch(() => ({}));
      if (resp.status === 404 && !data?.seatsio) {
        const refHint = (dbConfig.supabaseUrl || '').match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] || 'tu-project-ref';
        const m = `Respuesta 404 al llamar seatsio-publish. En el Dashboard → Edge Functions debe existir en el proyecto ${refHint} (el mismo que en db.js).`;
        if (!silent) {
          alert(
            `${m}\n\nSi la función sí aparece en el panel, recarga con Ctrl+F5.\n\nRedespliega:\n  npx supabase functions deploy seatsio-publish\n\nSecrets: SEATSIO_SECRET_KEY, SEATSIO_REGION`,
          );
        }
        return { ok: false, message: m };
      }

      if (resp.ok && data.ok) {
        await _persistSeatMapRow(
          chartKey,
          defaultName,
          { silent },
          String(data?.name || ''),
          String(data?.eventKey || ''),
        );
        _setDraftStatus('Listo: mapa publicado y guardado. Ya puedes cerrar.', false);
        return { ok: true };
      }

      let msg = 'No se pudo publicar.';
      if (Array.isArray(data?.seatsio?.messages)) {
        msg = data.seatsio.messages.join('\n');
      } else if (data?.seatsio?.errors?.[0]?.message) {
        msg = data.seatsio.errors[0].message;
      } else if (data?.error) {
        msg = data.error;
      }
      if (msg.toLowerCase().includes('chart not found')) {
        msg += '\n\nValida que el chart exista y que SEATSIO_SECRET_KEY (Edge Function) sea de la misma cuenta/workspace que seatsioSecretKey/seatsioPublicKey del frontend.';
      }
      _setDraftStatus(msg, true);
      if (!silent) {
        alert('Seats.io / Supabase:\n\n' + msg);
      }
      return { ok: false, message: msg };
    } catch (e) {
      const m = e?.message || String(e);
      _setDraftStatus(m, true);
      if (!silent) {
        alert('Error de red: ' + m);
      }
      return { ok: false, message: m };
    } finally {
      _publishInFlight = false;
    }
  }

  function _scheduleDebouncedAutoPublish(chartKey) {
    if (!chartKey) return;
    if (_publishDebounceTimer) clearTimeout(_publishDebounceTimer);
    _publishDebounceTimer = setTimeout(() => {
      _publishDebounceTimer = null;
      void (async () => {
        _setDraftStatus('Publicando último borrador…', false);
        const r = await _publishAndPersistOnce(chartKey, { silent: true });
        if (!r.ok && r.message !== 'busy') {
          _setDraftStatus(
            'No se pudo publicar solo: ' + (r.message || 'error') + ' – usa "Publicar ahora" o despliega la función.',
            true,
          );
        }
      })();
    }, 3200);
  }

  /**
   * Publicación manual (mismo flujo, con alertas si falla).
   */
  async function publishDraftAndSave() {
    const chartKey = _lastDesignerChartKey;
    if (!chartKey) {
      alert('Espera a que el diseñador guarde el plano o elige el tipo de escenario.');
      return;
    }
    if (_publishDebounceTimer) {
      clearTimeout(_publishDebounceTimer);
      _publishDebounceTimer = null;
    }
    const btn = document.getElementById('seatsio-btn-publish');
    const btnLabel = 'Publicar ahora';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '…';
    }
    _setDraftStatus('Publicando…', false);
    try {
      const r = await _publishAndPersistOnce(chartKey, { silent: false });
      if (r.ok) {
        closeDesigner();
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = btnLabel;
      }
    }
  }

  async function openDesigner() {
    const secret = window.TICKETAZO_CONFIG?.seatsioSecretKey;
    if (!secret || !String(secret).trim()) {
      alert('Configura seatsioSecretKey en TICKETAZO_CONFIG.');
      return;
    }

    const overlay = document.getElementById('seatsio-designer-overlay');
    const mount = document.getElementById('seatsio-designer-mount');
    if (!overlay || !mount) return;

    destroyDesigner();
    overlay.classList.add('open');
    _setDraftStatus('Cargando diseñador de seats.io…', false);

    // El SeatingChartDesigner está incluido en el mismo chart.js
    try {
      await loadChartJs();
    } catch (e) {
      mount.innerHTML = `<div style="padding:24px;color:#dc2626;font-family:monospace;font-size:.9rem">
        <strong>Error cargando el SDK de seats.io.</strong><br>
        ${_escapeHtml(e?.message || String(e))}<br><br>
        Verifica tu conexión a internet y que el dominio <code>cdn-na.seatsio.net</code> sea accesible.
        </div>`;
      return;
    }

    // Detectar clase correcta del designer (el nombre puede variar por versión del SDK)
    const DesignerCtor = window.seatsio?.SeatingChartDesigner
      || window.seatsio?.EmbeddedDesigner
      || window.seatsio?.EmbeddableDesigner
      || null;

    if (!DesignerCtor) {
      const available = Object.keys(window.seatsio || {}).join(', ');
      mount.innerHTML = `<div style="padding:24px;color:#dc2626;font-family:monospace;font-size:.9rem">
        <strong>SeatingChartDesigner no encontrado en el SDK de seats.io.</strong><br>
        Clases disponibles: <code>${available || '(ninguna)'}</code><br><br>
        Intenta recargar la pagina o verifica la version del SDK en la consola.
        </div>`;
      return;
    }

    _setDraftStatus(
      'Edita tu mapa y cuando termines presiona "Publicar ahora". Solo ahí se publica y se guarda en Ticketazo.',
      false,
    );

    // El mount necesita altura explícita en px para que el iframe de seats.io se renderice
    // (height:100% dentro de flex+min-height:0 puede colapsar a 0)
    const modalH = overlay.querySelector('.seatsio-designer-modal')?.clientHeight || 700;
    const footerH = overlay.querySelector('.seatsio-designer-footer')?.offsetHeight || 52;
    const designerH = Math.max(400, modalH - footerH - 10);
    mount.style.height = designerH + 'px';
    mount.style.overflow = 'hidden';
    mount.innerHTML = `<div id="designer" style="width:100%;height:${designerH}px"></div>`;

    try {
      _designer = new DesignerCtor({
        divId: 'designer',
        secretKey: secret,
        language: 'es',
        openLatestDrawing: true,
        onChartCreated(chartKey) {
          if (chartKey) {
            _lastDesignerChartKey = chartKey;
            _setDraftStatus('Mapa creado. Edita y al final presiona Publicar ahora.', false);
          }
        },
        onChartUpdated(chartKey) {
          if (chartKey) _lastDesignerChartKey = chartKey;
          if (_chartUpdateUiTimer) clearTimeout(_chartUpdateUiTimer);
          _chartUpdateUiTimer = setTimeout(() => {
            _setDraftStatus('Borrador guardado en seats.io. Cuando termines presiona Publicar ahora.', false);
          }, 500);
        },
        onChartPublished: async (chartKey) => {
          const key = chartKey || _lastDesignerChartKey;
          if (key) {
            await _publishAndPersistOnce(key, { silent: false });
            _setDraftStatus('Listo.', false);
          }
          destroyDesigner();
          document.getElementById('seatsio-designer-overlay')?.classList.remove('open');
        },
      });
      _designer.render();
    } catch (designerErr) {
      console.error('[SeatsioMaps] Error al iniciar el disenador:', designerErr);
      mount.innerHTML = `<div style="padding:24px;color:#dc2626;font-family:monospace;font-size:.9rem">
        <strong>Error al iniciar el disenador:</strong> ${_escapeHtml(designerErr.message || String(designerErr))}<br><br>
        <em>SDK disponible: ${Object.keys(window.seatsio || {}).join(', ') || '(vacio)'}</em><br><br>
        Revisa la consola del navegador (F12) para mas detalles.
        </div>`;
    }
  }

  function initCreateForm() {
    const wrapExisting = document.getElementById('db-seat-map-existing-wrap');
    const wrapNew = document.getElementById('db-seat-map-new-wrap');
    const hid = document.getElementById('db-seat-map-db-id');
    const modes = document.querySelectorAll('input[name="db-seat-map-mode"]');
    const capField = document.getElementById('db-capacity-field');
    const extraTiers = document.getElementById('db-extra-tier-fields');
    const ticketNote = document.getElementById('db-create-ticket-note');

    const syncMode = () => {
      const mode = document.querySelector('input[name="db-seat-map-mode"]:checked')?.value || 'none';
      if (wrapExisting) wrapExisting.classList.toggle('hidden', mode !== 'existing');
      if (wrapNew) wrapNew.classList.toggle('hidden', mode !== 'new');
      if (mode === 'none' && hid) hid.value = '';
      if (mode === 'existing') {
        const sel = document.getElementById('db-seat-map-existing');
        if (hid && sel) hid.value = sel.value || '';
      }
      const seated = mode === 'existing' || mode === 'new';
      // Ocultar capacidad cuando hay mapa (se auto-detecta del plano; el usuario no debe poner 0 a mano)
      if (capField) capField.classList.toggle('hidden', seated);
      // VIP / PLATINUM siempre visibles
      if (extraTiers) extraTiers.classList.remove('hidden');
      if (ticketNote) {
        if (!seated) {
          ticketNote.textContent = 'Capacidad total compartida y precios por tipo de boleto.';
        } else {
          // Mantener el texto si ya muestra datos del plano; solo cambia en el primer switch
          if (!ticketNote.textContent.includes('asientos')) {
            ticketNote.textContent = 'Con mapa: la capacidad se detecta automáticamente del plano. Define precios GA, VIP, PLATINUM.';
          }
        }
      }
    };

    modes.forEach(m => m.addEventListener('change', syncMode));
    const sel = document.getElementById('db-seat-map-existing');

    // Al cambiar el mapa seleccionado: actualizar hidden input, auto-rellenar capacidad y mostrar nota
    if (sel) {
      sel.addEventListener('change', async () => {
        if (hid) hid.value = sel.value || '';
        const selectedOpt = sel.options[sel.selectedIndex];
        const chartKey    = selectedOpt?.dataset?.chartKey || '';
        const noteEl      = document.getElementById('db-create-ticket-note');
        const capEl       = document.getElementById('db-new-capacity');

        if (!chartKey) {
          // Sin mapa válido seleccionado – limpiar
          if (capEl) capEl.value = '';
          if (noteEl) noteEl.textContent = 'Con mapa: la capacidad se detecta automáticamente del plano. Define precios GA, VIP, PLATINUM.';
          return;
        }

        // Consultar plano
        if (noteEl) noteEl.textContent = '⏳ Detectando asientos del plano…';
        const info = await fetchChartSeatCount(chartKey);

        if (info && info.totalSeats > 0) {
          if (capEl) capEl.value = String(info.totalSeats);
          const cats = (info.categories || [])
            .filter(c => c.count > 0)
            .map(c => `${c.label}: ${c.count}`)
            .join(', ');
          if (noteEl) {
            noteEl.textContent = `✅ Plano: ${info.totalSeats} asientos detectados${cats ? ` (${cats})` : ''}. Precios por zona activos.`;
          }
        } else {
          // La consulta falló – pedir al organizador que ingrese la capacidad
          if (capEl) {
            capEl.value = '';
            // Hacer visible el campo para que pueda ingresar manualmente
            if (capField) capField.classList.remove('hidden');
          }
          if (noteEl) {
            noteEl.textContent = '⚠️ No se pudo detectar los asientos automáticamente. Ingresa la capacidad manualmente.';
          }
        }
      });
    }
    syncMode();

    if (typeof DB !== 'undefined' && DB.fetchSeatMapsForSession && typeof Auth !== 'undefined' && Auth.session) {
      const s = Auth.session();
      (async () => {
        try {
          if (sel) sel.innerHTML = '<option value="">Cargando mapas desde seats.io…</option>';
          let dbMaps = await DB.fetchSeatMapsForSession(s.email, s.role);
          
          // Consultar a la API si existen más mapas
          const config = window.TICKETAZO_CONFIG;
          if (config?.supabaseFunctionsUrl && DB.getConfig) {
            const dbCfg = DB.getConfig();
            const authToken = dbCfg.supabaseAnonKey || '';
            const res = await fetch(`${config.supabaseFunctionsUrl}/seatsio-publish`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', apikey: authToken, Authorization: `Bearer ${authToken}` },
              body: JSON.stringify({ action: 'listCharts' })
            }).catch(() => null);
            
            if (res && res.ok) {
              const data = await res.json();
              if (data.ok && Array.isArray(data.charts)) {
                for (const chart of data.charts) {
                  const exists = dbMaps.find(m => m.seatsio_chart_key === chart.id);
                  if (!exists && chart.status !== 'ARCHIVED') {
                    let newRow = await DB.insertSeatMap({
                      nombre: chart.name || chart.id,
                      seatsioChartKey: chart.id
                    }).catch(() => null);
                    
                    if (!newRow) {
                      newRow = { id: chart.id, nombre: (chart.name || chart.id), seatsio_chart_key: chart.id };
                    }
                    dbMaps.push(newRow);
                  }
                }
              }
            }
          }
          
          if (!sel) return;
          const preserve = hid?.value || '';
          sel.innerHTML = '<option value="">Selecciona un mapa guardado…</option>' + dbMaps.map(m => (
            `<option value="${m.id}" data-chart-key="${_escapeHtml(m.seatsio_chart_key)}">${_escapeHtml(m.nombre)} – ${_escapeHtml(m.seatsio_chart_key)}</option>`
          )).join('');
          
          if (preserve) {
            sel.value = preserve;
            sel.dispatchEvent(new Event('change'));
          }
        } catch (e) {
          console.warn('[SeatsioMaps] sincronizar mapas:', e);
        }
      })();
    }
  }

  async function mountBuyerChart(divId, chartOrOpts, opts = {}) {
    const pk = window.TICKETAZO_CONFIG?.seatsioPublicKey;
    const chartKey = typeof chartOrOpts === 'string' ? chartOrOpts : (chartOrOpts?.chartKey || '');
    const eventKey = typeof chartOrOpts === 'object' ? (chartOrOpts?.eventKey || '') : '';
    if (!pk || (!chartKey && !eventKey)) return null;

    destroyBuyerChart();
    await loadChartJs();

    const max = Math.max(1, Number(opts.maxObjects || 8));
    const cfg = {
      divId,
      // seats.io actual usa workspaceKey (publicKey quedó deprecado).
      workspaceKey: pk,
      onObjectSelected: opts.onObjectSelected || (() => {}),
      onObjectDeselected: opts.onObjectDeselected || (() => {}),
      onChartRenderingFailed: (chart) => {
        try {
          chart?.destroy?.();
        } catch (_e) {}
        const el = document.getElementById(divId);
        if (el) {
          el.innerHTML = `<p class="ck-seat-hint warn" style="padding:16px">
            No se pudo cargar el mapa. Revisa que esté <strong>publicado</strong> y que las keys de seats.io sean del mismo workspace.
            <br><small>eventKey: ${_escapeHtml(String(eventKey || ''))}</small>
            <br><small>chartKey: ${_escapeHtml(String(chartKey || ''))}</small>
          </p>`;
        }
        let detail = '';
        try {
          detail = JSON.stringify(chart, (_k, v) => (typeof v === 'function' ? '[fn]' : v));
        } catch (_e) {
          detail = String(chart);
        }
        console.warn('[seats.io] onChartRenderingFailed', { eventKey, chartKey, chart: detail });
      },
    };
    if (eventKey) cfg.event = eventKey;
    else cfg.chart = chartKey;
    if (typeof max === 'number' && max > 0) {
      cfg.maxSelectedObjects = max;
    }
    cfg.session = 'start';

    _buyerChart = new window.seatsio.SeatingChart(cfg);
    _buyerChart.render();
    return _buyerChart;
  }

  /**
   * Crea (o reutiliza) el evento de seats.io ligado al chart. El renderer de compra usa `event`.
   */
  async function ensureSeatsioEventForChart(chartKey, preferredEventKey = '') {
    const dbConfig = typeof DB !== 'undefined' && DB.getConfig ? DB.getConfig() : {};
    const authToken = dbConfig.supabaseAnonKey || '';
    const bases = _functionsInvokeBases();
    if (!chartKey || !authToken || !bases.length) return '';

    const resp = await _postSeatsioPublish(
      bases,
      authToken,
      { chartKey, ensureEvent: true, publishOnly: true, eventKey: preferredEventKey || undefined },
      2,
    );
    const data = await resp.json().catch(() => ({}));
    if (resp.ok && data?.ok && data?.eventKey) return String(data.eventKey);
    return '';
  }

  /**
   * Marca asientos como ocupados (book) en seats.io a través de la Edge Function.
   * Se llama después de que el pago de Stripe es aprobado.
   * @param {string} eventKey  – clave del evento seats.io
   * @param {string[]} objects – array de IDs/labels de asientos a reservar
   */
  async function bookSeats(eventKey, objects) {
    if (!eventKey || !Array.isArray(objects) || !objects.length) return { ok: false };
    const dbConfig = typeof DB !== 'undefined' && DB.getConfig ? DB.getConfig() : {};
    const authToken = dbConfig.supabaseAnonKey || '';
    const bases = _functionsInvokeBases();
    if (!authToken || !bases.length) return { ok: false };

    try {
      const slug = 'seatsio-publish';
      const invokeUrl = `${String(bases[0]).replace(/\/$/, '')}/${slug}`;
      const resp = await fetch(invokeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: authToken,
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ action: 'book', eventKey, objects }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.ok) return { ok: true };
      console.warn('[seats.io] bookSeats error:', data);
      return { ok: false, message: data?.error || 'Error al reservar asientos' };
    } catch (e) {
      console.warn('[seats.io] bookSeats fetch error:', e);
      return { ok: false, message: e?.message || String(e) };
    }
  }

  /**
   * Consulta la Edge Function para obtener total de asientos y categorías del plano.
   * Requiere que el chart esté publicado en seats.io.
   */
  async function fetchChartSeatCount(chartKey) {
    if (!chartKey) return null;
    const dbConfig  = typeof DB !== 'undefined' && DB.getConfig ? DB.getConfig() : {};
    const authToken = dbConfig.supabaseAnonKey || '';
    const bases     = _functionsInvokeBases();
    if (!authToken || !bases.length) return null;
    try {
      const slug      = 'seatsio-publish';
      const invokeUrl = `${String(bases[0]).replace(/\/$/, '')}/${slug}`;
      const resp = await fetch(invokeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: authToken, Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ action: 'chartInfo', chartKey }),
      });
      const data = await resp.json().catch(() => ({}));
      if (data.ok) return data; // { ok, totalSeats, categories }
      return null;
    } catch (e) {
      console.warn('[SeatsioMaps] fetchChartSeatCount error:', e);
      return null;
    }
  }

  return {
    loadChartJs,
    openDesigner,
    closeDesigner,
    destroyDesigner,
    initCreateForm,
    mountBuyerChart,
    ensureSeatsioEventForChart,
    destroyBuyerChart,
    publishDraftAndSave,
    bookSeats,
    fetchChartSeatCount,
  };
})();

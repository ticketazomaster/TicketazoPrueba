/**
 * auth.js — Autenticación real con Supabase.
 * Se encarga de la sesión, roles y protección de rutas.
 */
const Auth = (() => {
  // ── Estado interno ────────────────────────────────────────────────────────
  let _session = { id: '', name: '', role: '', email: '', dbUserId: null, adminId: null };
  let _sbReady  = false;
  let _sb       = null;
  let _applying = false;
  let _pendingApply = null;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function _normalizeRole(raw) {
    const r = (raw || '').toString().trim().toLowerCase();
    if (['admin', 'administrador'].includes(r)) return 'admin';
    if (['organizer', 'organizador'].includes(r)) return 'organizer';
    if (['treasurer', 'tesorero'].includes(r)) return 'treasurer';
    return 'user';
  }

  async function _fetchRole(sbUser) {
    if (!sbUser || !sbUser.email) return 'user';
    try {
      const { data, error } = await _sb.from('administradores').select('rol').eq('email', sbUser.email).maybeSingle();
      if (!error && data?.rol) return _normalizeRole(data.rol);
    } catch (err) { console.warn("[Auth] Error consultando rol:", err); }

    const eml = sbUser.email.toLowerCase();
    if (eml.includes('tesorero')) return 'treasurer';
    if (eml.includes('organizador')) return 'organizer';
    if (eml.includes('admin') || eml.includes('eber')) return 'admin';
    return 'user';
  }

  async function _syncDbIdentity(email, name) {
    if (typeof DB === 'undefined' || !DB.syncIdentity) {
      return { userId: null, adminId: null, adminRole: '' };
    }

    try {
      return await DB.syncIdentity({ email, name });
    } catch (err) {
      console.warn('[Auth] No se pudo sincronizar la identidad con la BD:', err);
      return { userId: null, adminId: null, adminRole: '' };
    }
  }

  // ── Modal & Vistas ────────────────────────────────────────────────────────
  function openModal() {
    document.getElementById('modal-overlay')?.classList.add('open');
    _goView('login');
  }
  function closeModal() { document.getElementById('modal-overlay')?.classList.remove('open'); }
  function closeOutside(e) { if (e.target === document.getElementById('modal-overlay')) closeModal(); }

  function _goView(view) {
    const body = document.getElementById('modal-body');
    if (!body) return;
    const stepsBar = document.getElementById('steps-bar');
    if (stepsBar) stepsBar.classList.add('hidden');
    body.innerHTML = VIEWS[view]?.() ?? '';
  }

  const VIEWS = {
    login: () => `
      <h2 class="modal-title">Inicia Sesión</h2>
      <p class="modal-sub">Accede a tu cuenta de Ticketazo.</p>
      <div class="field"><label>Correo Electrónico</label>
        <div class="field-wrap"><span class="field-icon">${Icons.mail}</span>
          <input type="email" id="l-email" placeholder="ejemplo@gmail.com"/></div>
      </div>
      <div class="field"><label>Contraseña</label>
        <div class="field-wrap"><span class="field-icon">${Icons.lockB}</span>
          <input type="password" id="l-pass" placeholder="••••••••"/>
          <button class="eye-btn" type="button" onmousedown="Auth.showPass('l-pass',true)" onmouseup="Auth.showPass('l-pass',false)" onmouseleave="Auth.showPass('l-pass',false)">
            <span class="material-symbols-outlined" style="font-size:16px;opacity:0.5;vertical-align:middle;">visibility</span>
          </button>
        </div>
      </div>
      <div class="field-error hidden" id="login-err"><span></span></div>
      <button class="btn btn-primary w-full" id="btn-do-login" onclick="Auth.doLogin()">Ingresar</button>
      <div class="modal-divider">o</div>
      <p class="modal-switch">¿No tienes cuenta? <a onclick="Auth._goView('reg1')">Regístrate aquí</a></p>`,
    
    reg1: () => `
      <h2 class="modal-title">Crea tu Cuenta</h2>
      <div class="field"><label>Nombre Completo</label>
        <input type="text" id="r-name" class="modal-input" placeholder="Tu nombre"/></div>
      <div class="field"><label>Correo Electrónico</label>
        <input type="email" id="r-email" class="modal-input" placeholder="tu@correo.com"/></div>
      <div class="field"><label>Contraseña</label>
        <div class="field-wrap"><input type="password" id="r-pass" class="modal-input" placeholder="••••••••"/>
          <button class="eye-btn" type="button" onmousedown="Auth.showPass('r-pass',true)" onmouseup="Auth.showPass('r-pass',false)" onmouseleave="Auth.showPass('r-pass',false)">
            <span class="material-symbols-outlined" style="font-size:16px;opacity:0.5;vertical-align:middle;">visibility</span>
          </button>
        </div>
      </div>
      <div class="field-error hidden" id="reg1-err"><span></span></div>
      <button class="btn btn-primary w-full" id="btn-do-register" onclick="Auth.reg1Next()">Crear Cuenta</button>
      <p class="modal-switch">¿Ya tienes cuenta? <a onclick="Auth._goView('login')">Inicia sesión</a></p>`,

    regDone: () => `
      <div style="text-align:center;padding:20px 0">
        <div style="font-size:3rem;margin-bottom:15px">📧</div>
        <h2 class="modal-title">Verifica tu correo</h2>
        <p class="modal-sub">Te enviamos un enlace de confirmación. Haz clic en él para poder activar tu cuenta.</p>
        <button class="btn btn-primary w-full" style="margin-top:20px" onclick="Auth.closeModal()">Entendido</button>
      </div>`
  };

  // ── Lógica de Sesión ──────────────────────────────────────────────────────
  async function _applySession(sbSession, isExplicitLogin = false) {
    if (_applying) {
      _pendingApply = {
        session: sbSession,
        isExplicitLogin: Boolean(_pendingApply?.isExplicitLogin || isExplicitLogin)
      };
      return;
    }
    _applying = true;

    try {
      if (!sbSession?.user) {
        _session = { id: '', name: '', role: '', email: '', dbUserId: null, adminId: null };
        if (typeof Profile !== 'undefined' && Profile.onSessionChanged) Profile.onSessionChanged(_session);
        if (typeof App !== 'undefined') App.updateNav();
        if (typeof Zones !== 'undefined') Zones.init();
        // No cerrar el modal aquí: durante el arranque inicial de Supabase
        // este camino puede ejecutarse mientras el usuario ya está intentando loguearse.
        // Si lo cerramos, el modal "rebota" y los errores quedan ocultos.
        return;
      }

      // ───────────────────────────────────────────────────────────────────────
      // REQUISITO: El usuario DEBE haber confirmado su correo
      // ───────────────────────────────────────────────────────────────────────
      const confirmed = sbSession.user.email_confirmed_at;
      if (!confirmed) {
        await _sb.auth.signOut();
        _session = { id: '', name: '', role: '', email: '', dbUserId: null, adminId: null };
        if (typeof Profile !== 'undefined' && Profile.onSessionChanged) Profile.onSessionChanged(_session);
        if (isExplicitLogin) {
          _goView('login');
          setTimeout(() => _showErr('login-err', 'MANDATORIO: Debes confirmar tu correo electrónico antes de entrar.'), 100);
        }
        if (typeof App !== 'undefined') App.updateNav();
        return;
      }

      const role = await _fetchRole(sbSession.user);
      const name = sbSession.user.user_metadata?.full_name || sbSession.user.email?.split('@')[0] || 'Usuario';
      const identity = await _syncDbIdentity(sbSession.user.email, name);
      const normalizedRole = _normalizeRole(identity.adminRole || role);

      _session = {
        id: sbSession.user.id || '',
        name,
        role: normalizedRole,
        email: sbSession.user.email,
        dbUserId: identity.userId || null,
        adminId: identity.adminId || null,
      };
      if (typeof Profile !== 'undefined' && Profile.onSessionChanged) Profile.onSessionChanged(_session);
      
      closeModal();
      if (typeof App !== 'undefined') App.updateNav();
      if (typeof Zones !== 'undefined') Zones.init();
      
      if (document.getElementById('page-profile')?.classList.contains('active')) {
        if (typeof Profile !== 'undefined') Profile.render();
      }
    } catch (err) {
      console.error("[Auth] Error aplicando sesión:", err);
    } finally {
      _applying = false;
      if (_pendingApply) {
        const nextApply = _pendingApply;
        _pendingApply = null;
        queueMicrotask(() => { void _applySession(nextApply.session, nextApply.isExplicitLogin); });
      }
    }
  }

  // ── Acciones Públicas ─────────────────────────────────────────────────────
  async function doLogin() {
    const emailStr = document.getElementById('l-email')?.value || '';
    const email = emailStr.trim();
    const pass  = document.getElementById('l-pass')?.value || '';
    
    if (!email || !pass) { 
      _showErr('login-err', 'Ingresa correo y contraseña'); 
      return; 
    }

    _hideErr('login-err');
    _setBusy('btn-do-login', true);

    try {
      if (!_sbReady) { 
        console.warn("[Auth] Intento de login pero Supabase no está listo.");
        _showErr('login-err', 'Servicio inicializando. Intenta en un segundo.'); 
        return; 
      }
      
      console.log(`[Auth] Intentando iniciar sesión para: ${email}`);
      const { data, error } = await _sb.auth.signInWithPassword({ email, password: pass });
      
      if (error) {
        console.error("[Auth] Error retornado por Supabase:", error);
        
        let msg = 'Error al iniciar sesión.';
        if (error.status === 400 || (error.message && error.message.toLowerCase().includes('credential'))) {
           msg = 'Credenciales incorrectas.';
        } else if (error.message && error.message.includes('confirm')) {
           msg = 'Verifica tu correo antes de entrar.';
        } else if (error.message) {
           msg = error.message; // Fallback to whatever Supabase says
        }
        
        _showErr('login-err', msg);
      } else if (data && data.session) {
        console.log("[Auth] Inicio de sesión exitoso. Aplicando sesión...");
        await _applySession(data.session, true);
      } else {
        console.warn("[Auth] Login finalizado sin error, pero no hay sesión generada.", data);
        _showErr('login-err', 'Error interno: No se generó la sesión.');
      }
    } catch (err) {
      console.error("[Auth] Error de conexión (Excepción capturada):", err);
      _showErr('login-err', 'Error de conexión con el servidor.');
    } finally {
      _setBusy('btn-do-login', false);
    }
  }

  async function reg1Next() {
    const name  = document.getElementById('r-name')?.value.trim();
    const email = document.getElementById('r-email')?.value.trim();
    const pass  = document.getElementById('r-pass')?.value;
    if (!name || !email || !pass) { _showErr('reg1-err', 'Completa todos los campos.'); return; }
    if (pass.length < 8) { _showErr('reg1-err', 'La contraseña debe tener al menos 8 caracteres.'); return; }

    _setBusy('btn-do-register', true);
    try {
      const { data, error } = await _sb.auth.signUp({
        email, password: pass,
        options: { data: { full_name: name }, emailRedirectTo: window.location.href }
      });
      if (error) {
        _showErr('reg1-err', error.message);
      } else {
        _goView('regDone');
      }
    } catch (err) { _showErr('reg1-err', 'Error al registrar.'); }
    finally { _setBusy('btn-do-register', false); }
  }

  async function logout() {
    try {
      if (_sb) await _sb.auth.signOut();
    } catch(err) {
      console.warn('[Auth] Ignorando error al cerrar sesión:', err);
    }
    _session = { id: '', name: '', role: '', email: '', dbUserId: null, adminId: null };
    window.location.reload();
  }

  // ── Utils ─────────────────────────────────────────────────────────────────
  function _showErr(id, msg) {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('hidden'); const span = el.querySelector('span'); if (span) span.textContent = msg; }
  }
  function _hideErr(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('hidden');
    const span = el.querySelector('span');
    if (span) span.textContent = '';
  }
  function _setBusy(id, busy) { const btn = document.getElementById(id); if (btn) btn.disabled = busy; }
  function showPass(id, show) { const el = document.getElementById(id); if (el) el.type = show ? 'text' : 'password'; }

  // ── Inicialización ────────────────────────────────────────────────────────
  (async () => {
    try {
      _sb = typeof DB !== 'undefined' && DB.client ? DB.client() : null;
      if (!_sb && window.supabase?.createClient) {
        const { createClient } = window.supabase;
        _sb = createClient('https://urumaghjardjgdveblxa.supabase.co', 'sb_publishable_hpITakDbpUWFx3Tv9AJg-A_MnyJOtd0');
      }
      if (!_sb) throw new Error('No se pudo inicializar Supabase.');
      _sbReady = true;
      _sb.auth.onAuthStateChange((event, session) => {
        // Evita ejecutar trabajo async pesado dentro del callback interno de Supabase.
        // En móvil puede provocar que el login parezca "rebotar" o no termine de aplicar.
        setTimeout(() => { void _applySession(session, event === 'SIGNED_IN'); }, 0);
      });
      const { data: { session } } = await _sb.auth.getSession();
      if (session) await _applySession(session, false);
    } catch (e) { console.error("[Auth] Error Supabase:", e); }
  })();

  return {
    openModal, closeModal, closeOutside, _goView,
    doLogin, reg1Next, logout, showPass,
    isLoggedIn: () => !!_session.name,
    session: () => _session
  };
})();

/**
 * app.js — Controlador principal.
 */
window.App = (() => {
  let _current = 'home';
  let _prev    = 'home';

  // ── Navegación ──────────────────────────
  function navigate(page) {
    document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
    document.getElementById(`page-${page}`)?.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'auto' });
    _prev    = _current;
    _current = page;

    if (page !== 'ticket') {
      const url = new URL(window.location.href);
      if (url.searchParams.has('ticket')) {
        url.searchParams.delete('ticket');
        history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      }
    }

    // El dashboard y el ticket tienen layout especial.
    const isDash = page === 'dashboard';
    const isTicket = page === 'ticket';
    const mobileMenu = document.getElementById('mobile-menu');
    mobileMenu?.classList.remove('open');
    document.getElementById('navbar')?.style.setProperty('display', (isDash || isTicket) ? 'none' : '');
    mobileMenu?.style.setProperty('display', (isDash || isTicket) ? 'none' : '');
    document.getElementById('main-footer')?.style.setProperty('display', (isDash || isTicket) ? 'none' : '');
    if (typeof Zones !== 'undefined' && typeof Zones.closeSidebar === 'function') {
      Zones.closeSidebar();
    }
    // Force body background to match dashboard when on dashboard
    document.body.style.background = isDash ? '#f8fafc' : (isTicket ? '#f4f4f5' : '');
    document.body.style.overflow = (isDash && window.innerWidth > 900) ? 'hidden' : '';
  }

  function goBack() {
    navigate(_prev === _current ? 'home' : _prev);
  }

  // ── Navbar ──────────────────────────────
  function updateNav() {
    const sess        = Auth.session();
    const logged      = Auth.isLoggedIn();
    const hasDashRole = ['organizer','treasurer','admin'].includes(sess.role);

    const $ = id => document.getElementById(id);
    const show = id => $( id)?.classList.remove('hidden');
    const hide = id => $( id)?.classList.add('hidden');

    logged ? hide('btn-login')  : show('btn-login');
    logged ? show('btn-logout') : hide('btn-logout');
    logged ? hide('mob-login')  : show('mob-login');
    logged ? show('mob-logout') : hide('mob-logout');

    logged ? show('btn-home-nav') : hide('btn-home-nav');

    const navName = $('nav-username');
    if (navName) {
      navName.textContent = logged ? sess.name.split(' ')[0] : '';
      logged ? navName.classList.remove('hidden') : navName.classList.add('hidden');
    }

    logged ? show('mob-profile') : hide('mob-profile');

    const showDash = logged && hasDashRole;
    showDash ? show('btn-dashboard') : hide('btn-dashboard');
    showDash ? show('mob-dashboard') : hide('mob-dashboard');
  }

  function toggleMobile() {
    document.getElementById('mobile-menu')?.classList.toggle('open');
  }

  window.addEventListener('scroll', () => {
    document.getElementById('navbar')?.classList.toggle('scrolled', window.scrollY > 20);
  }, { passive: true });

  // ── Footer ──────────────────────────────
  function _buildFooter() {
    const footer = document.getElementById('main-footer');
    if (!footer) return;
    footer.innerHTML = `
      <div class="footer-main">
        <div>
          <div class="footer-brand-logo" onclick="App.navigate('home')">
            <div class="footer-brand-icon">${Icons.ticket}</div>Ticketazo
          </div>
          <p class="footer-brand-desc">La plataforma líder en México para comprar boletos a los mejores eventos.</p>
          <div class="footer-socials">
            <a class="footer-social" href="#" aria-label="Instagram">${Icons.instagram}</a>
            <a class="footer-social" href="#" aria-label="Twitter">${Icons.twitter}</a>
            <a class="footer-social" href="#" aria-label="Facebook">${Icons.facebook}</a>
            <a class="footer-social" href="#" aria-label="YouTube">${Icons.youtube}</a>
          </div>
        </div>
        <div>
          <div class="footer-col-title">Nosotros</div>
          <div class="footer-links">
            ${['¿Quiénes somos?','Misión y visión','Nuestro equipo','Blog y noticias','Trabaja con nosotros','Prensa']
              .map(l => `<a class="footer-link" href="#">${l}</a>`).join('')}
          </div>
        </div>
        <div>
          <div class="footer-col-title">Ayuda</div>
          <div class="footer-links">
            ${['Centro de ayuda','Preguntas frecuentes','Politica de cancelaciones','Terminos y condiciones','Aviso de privacidad','Organizadores']
              .map(l => `<a class="footer-link" href="#">${l}</a>`).join('')}
          </div>
        </div>
        <div>
          <div class="footer-col-title">Contáctanos</div>
          <div class="footer-contact-item">
            <div class="footer-contact-icon" style="color:var(--color-pink)">${Icons.mail}</div>
            <div><div class="footer-contact-label">Correo</div>
              <div class="footer-contact-val"><a href="mailto:hola@ticketazo.mx">hola@ticketazo.mx</a></div></div>
          </div>
          <div class="footer-contact-item">
            <div class="footer-contact-icon" style="color:var(--color-blue)">${Icons.phone}</div>
            <div><div class="footer-contact-label">Teléfono</div>
              <div class="footer-contact-val"><a href="tel:+528001234567">800 123 4567</a></div>
              <div class="footer-contact-hours">Lun–Vie 9:00–18:00</div></div>
          </div>
          <div class="footer-secure">
            <div class="footer-secure-icon">${Icons.lock}</div>
            <div><div class="footer-secure-title">Compra 100% segura</div>
              <div class="footer-secure-sub">Pago encriptado SSL</div></div>
          </div>
        </div>
      </div>
      <div class="footer-bottom">
        <div class="footer-bottom-inner">
          <p>© ${new Date().getFullYear()} Ticketazo. Todos los derechos reservados.</p>
          <div class="footer-legal">
            <a href="#">Términos</a><a href="#">Privacidad</a><a href="#">Cookies</a>
          </div>
          <p class="footer-love">Hecho con <span style="color:var(--color-pink);display:inline-flex;vertical-align:middle;margin:0 2px">${Icons.heart}</span> en México</p>
        </div>
      </div>`;
  }

  async function _loadRealEvents() {
    if (typeof DB === 'undefined' || !DB.fetchAllEvents) return;
    try {
      const realEvents = await DB.fetchAllEvents();
      if (!Array.isArray(realEvents) || !realEvents.length) return;

      EVENTS.length = 0;
      EVENTS.push(...realEvents);

      if (Array.isArray(CITIES)) {
        const cities = [...new Set(EVENTS.map(event => event.city).filter(Boolean))].sort();
        CITIES.length = 0;
        CITIES.push(...cities);
      }
    } catch (err) {
      console.warn('[App] No se pudieron cargar eventos reales:', err);
    }
  }

  // ── Init ────────────────────────────────
  async function init() {
    _buildFooter();
    await _loadRealEvents();
    Zones.init();
    Carousel.init();
    Grid.init();
    updateNav();
    Profile.maybeOpenSharedTicketFromUrl?.();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { navigate, goBack, updateNav, toggleMobile };
})();

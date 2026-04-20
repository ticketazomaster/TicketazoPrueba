/**
 * search.js
 * Barra de búsqueda con sugerencias de artistas y ciudades.
 */

const Search = (() => {
  let query = '';

  function handle(value) {
    query = value.trim();
    const clearBtn = document.getElementById('search-clear');
    if (clearBtn) clearBtn.classList.toggle('hidden', !value);
    showDropdown();
    Grid.build();
  }

  function showDropdown() {
    const q   = document.getElementById('search-input')?.value.toLowerCase().trim();
    const box = document.getElementById('search-dropdown');
    if (!box) return;

    if (!q) { box.classList.add('hidden'); return; }

    const results = [
      ...ARTISTS
        .filter(a => a.name.toLowerCase().includes(q))
        .map(a => ({
          type: 'artist',
          label: a.name,
          sub: a.isOnTour
            ? `En gira · ${EVENTS.filter(e => e.artistId === a.id && e.status === 'active').length} fechas disponibles`
            : a.genre,
          id: a.id,
        })),
      ...CITIES
        .filter(c => c.toLowerCase().includes(q))
        .map(c => ({
          type: 'city',
          label: c,
          sub: `${EVENTS.filter(e => e.city === c && e.status === 'active').length} eventos disponibles`,
          id: c,
        })),
    ].slice(0, 6);

    if (!results.length) { box.classList.add('hidden'); return; }

    box.innerHTML = results.map(r => `
      <button class="suggestion-item" onmousedown="Search.pick('${r.type}','${r.id}','${r.label}')">
        <div class="sug-icon sug-icon--${r.type}">${r.type === 'artist' ? Icons.mic : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>'}</div>
        <div>
          <div class="sug-label">${r.label}</div>
          <div class="sug-sub">${r.sub}</div>
        </div>
        <span class="sug-badge sug-badge--${r.type}">${r.type === 'artist' ? 'Artista' : 'Ciudad'}</span>
      </button>`).join('');

    box.classList.remove('hidden');
  }

  function hideDropdown() {
    document.getElementById('search-dropdown')?.classList.add('hidden');
  }

  function pick(type, id, label) {
    hideDropdown();
    if (type === 'artist') {
      Pages.openArtist(id);
    } else {
      const input = document.getElementById('search-input');
      if (input) input.value = label;
      query = label;
      Grid.build();
    }
  }

  function clear() {
    query = '';
    const input = document.getElementById('search-input');
    if (input) input.value = '';
    document.getElementById('search-clear')?.classList.add('hidden');
    hideDropdown();
    Grid.build();
  }

  function getQuery() { return query; }

  // Close dropdown when clicking outside
  document.addEventListener('click', e => {
    if (!e.target.closest('#search-wrap')) hideDropdown();
  });

  return { handle, showDropdown, hideDropdown, pick, clear, getQuery };
})();

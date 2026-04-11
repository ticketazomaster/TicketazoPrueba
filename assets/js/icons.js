const Icons = {
  // Helper interno para generar el tag material symbol
  _icon: (name, size=20, color='inherit') => `<span class="material-symbols-outlined" style="font-size: ${size}px; color: ${color}; vertical-align: middle;">${name}</span>`,
  
  // Helper para redes sociales usando SVGs
  _svg: (path, size=18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;">${path}</svg>`,

  ticket:   `<span class="material-symbols-outlined" style="font-size: 20px; vertical-align: middle;">local_activity</span>`,
  search:   `<span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle;">search</span>`,
  star:     `<span class="material-symbols-outlined" style="font-size: 16px; vertical-align: middle;">star</span>`,
  close:    `<span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle;">close</span>`,
  chart:    `<span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle;">bar_chart</span>`,
  filter:   `<span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle;">filter_alt</span>`,
  menu:     `<span class="material-symbols-outlined" style="font-size: 24px; vertical-align: middle;">menu</span>`,
  mic:      `<span class="material-symbols-outlined" style="font-size: 16px; vertical-align: middle;">mic</span>`,
  users:    `<span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle;">group</span>`,
  mail:     `<span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle;">mail</span>`,
  phone:    `<span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle;">phone</span>`,
  lock:     `<span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle;">lock</span>`,
  
  // Redes Sociales (SVGs directos)
  instagram:`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/></svg>`,
  twitter:  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"/></svg>`,
  facebook: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>`,
  youtube:  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M2.5 7.17C2.5 7.17 2.5 4 12 4s9.5 3.17 9.5 3.17c0 0 .5 2.83.5 4.83v1c0 2-.5 4.83-.5 4.830 0 0-9.5 3.17-9.5 3.17s-9.5-3.17-9.5-3.17C2 16.83 2 14 2 12v-1c0-2 .5-4.83.5-4.83Z"/><path d="m10 15 5-3-5-3v6Z"/></svg>`,
  
  arrowLeft:`<span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle;">arrow_back</span>`,
  chevronLeft:`<span class="material-symbols-outlined" style="font-size: 24px; vertical-align: middle;">chevron_left</span>`,
  chevronRight:`<span class="material-symbols-outlined" style="font-size: 24px; vertical-align: middle;">chevron_right</span>`,
  heart:    `<span class="material-symbols-outlined" style="font-size: 16px; vertical-align: middle; font-variation-settings: 'FILL' 1;">favorite</span>`,
  heartOutline: `<span class="material-symbols-outlined" style="font-size: 16px; vertical-align: middle; font-variation-settings: 'FILL' 0;">favorite</span>`,
  card:     `<span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle;">credit_card</span>`,
  message:  `<span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle;">chat</span>`,

  // Versiones negras para fondo claro
  ticketB:  `<span class="material-symbols-outlined" style="font-size: 20px; color: currentColor; vertical-align: middle;">local_activity</span>`,
  mailB:    `<span class="material-symbols-outlined" style="font-size: 18px; color: currentColor; vertical-align: middle;">mail</span>`,
  phoneB:   `<span class="material-symbols-outlined" style="font-size: 18px; color: currentColor; vertical-align: middle;">phone</span>`,
  lockB:    `<span class="material-symbols-outlined" style="font-size: 18px; color: currentColor; vertical-align: middle;">lock</span>`,
};


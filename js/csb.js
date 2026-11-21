// Vivi Belluno – funzioni comuni del sito (solo lettura dei dati pubblici).
// Eventi e gruppi si leggono dal database con l'API REST pubblica di Firestore, senza account:
// sono gli stessi dati che chiunque vede nell'app senza entrare. Nessun cookie, nessun dato personale.
(function () {
  'use strict';
  var BASE = 'https://firestore.googleapis.com/v1/projects/che-succede-belluno/databases/(default)/documents';
  var STORE = 'https://play.google.com/store/apps/details?id=it.chesuccedebelluno.app';
  var TZ = 'Europe/Rome';

  // ---------- Lettura dal database ----------
  function decode(v) {
    if (!v) return null;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('timestampValue' in v) return new Date(v.timestampValue);
    if ('nullValue' in v) return null;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
    if ('mapValue' in v) return fields(v.mapValue.fields);
    return null;
  }
  function fields(f) {
    var o = {};
    Object.keys(f || {}).forEach(function (k) { o[k] = decode(f[k]); });
    return o;
  }
  function docOf(d) {
    var o = fields(d.fields);
    o.id = d.name.split('/').pop();
    return o;
  }
  function post(path, body) {
    return fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { if (!r.ok) throw new Error('db ' + r.status); return r.json(); });
  }
  function query(q) {
    return post(':runQuery', { structuredQuery: q }).then(function (rows) {
      return rows.filter(function (x) { return x.document; }).map(function (x) { return docOf(x.document); });
    });
  }
  function getDoc(path) {
    return fetch(BASE + '/' + path).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('db ' + r.status);
      return r.json().then(docOf);
    });
  }
  /// Chi organizza: il gruppo, oppure (eventi della redazione, senza gruppo) il nome scritto a mano.
  function organizer(e) { return e.groupId ? (e.groupName || '') : (e.organizerText || e.groupName || ''); }
  function select(names) { return { fields: names.map(function (n) { return { fieldPath: n }; }) }; }

  var EVENT_FIELDS = ['title', 'category', 'type', 'start', 'end', 'durationMinutes', 'place', 'town', 'price',
    'groupId', 'groupName', 'organizerText', 'days', 'cancelled', 'hidden', 'signupUrl', 'maxParticipants', 'description',
    'family', 'ageMin'];

  function eventsWhere(field, op, value) {
    return query({
      select: select(EVENT_FIELDS),
      from: [{ collectionId: 'events' }],
      where: { fieldFilter: { field: { fieldPath: field }, op: op, value: value } },
      limit: 500
    });
  }

  /// Eventi non ancora finiti (anche quelli su più giorni già iniziati), senza foto: arrivano dopo.
  function upcomingEvents() {
    var now = new Date();
    var yesterday = new Date(now.getTime() - 36 * 3600 * 1000);
    return Promise.all([
      eventsWhere('start', 'GREATER_THAN_OR_EQUAL', { timestampValue: yesterday.toISOString() }),
      eventsWhere('end', 'GREATER_THAN_OR_EQUAL', { timestampValue: now.toISOString() })
    ]).then(function (lists) {
      var byId = {};
      lists[0].concat(lists[1]).forEach(function (e) { byId[e.id] = e; });
      return visible(Object.keys(byId).map(function (k) { return byId[k]; }));
    });
  }

  function groupEvents(groupId) {
    return eventsWhere('groupId', 'EQUAL', { stringValue: groupId }).then(visible);
  }

  function visible(list) {
    var now = Date.now();
    return list.filter(function (e) {
      return e.start instanceof Date && !e.hidden && !e.cancelled && endTime(e).getTime() > now;
    }).sort(function (a, b) {
      return listDay(a).localeCompare(listDay(b)) || a.start - b.start;
    });
  }

  /// Miniature (foto piccole) degli eventi mostrati, chieste a parte per non scaricarle tutte subito.
  function thumbs(ids) {
    if (!ids.length) return Promise.resolve({});
    var chunks = [];
    for (var i = 0; i < ids.length; i += 25) chunks.push(ids.slice(i, i + 25));
    return Promise.all(chunks.map(function (c) {
      return post(':batchGet', {
        documents: c.map(function (id) { return BASE.replace('https://firestore.googleapis.com/v1/', '') + '/events/' + id; }),
        mask: { fieldPaths: ['thumb'] }
      }).catch(function () { return []; });
    })).then(function (parts) {
      var out = {};
      parts.forEach(function (rows) {
        rows.forEach(function (r) {
          if (r.found && r.found.fields && r.found.fields.thumb) out[r.found.name.split('/').pop()] = r.found.fields.thumb.stringValue;
        });
      });
      return out;
    });
  }

  function groups() {
    var mask = ['name', 'town', 'category', 'categories', 'type', 'verified', 'hidden', 'followerCount', 'image']
      .map(function (k) { return 'mask.fieldPaths=' + k; }).join('&');
    return fetch(BASE + '/groups?pageSize=300&' + mask).then(function (r) {
      if (!r.ok) throw new Error('db ' + r.status);
      return r.json();
    }).then(function (j) {
      return (j.documents || []).map(docOf).filter(function (g) { return !g.hidden && g.name; })
        .sort(function (a, b) { return a.name.localeCompare(b.name, 'it'); });
    });
  }

  // ---------- Sezioni e tipi (come nell'app) ----------
  var CATS = {
    sport: { name: 'Sport', color: '#0C8549', emoji: '🏃' },
    sagre: { name: 'Sagre e feste', color: '#BF6C00', emoji: '🍽️' },
    musica: { name: 'Musica e serate', color: '#8E3FD8', emoji: '🎵' },
    cultura: { name: 'Cultura', color: '#2C6BED', emoji: '🎭' }
  };
  var TYPE_EMOJI = {
    'Corsa e trail': '🏃', 'Montagna': '🥾', 'Bici': '🚴', 'Pallavolo': '🏐', 'Calcio': '⚽', 'Basket': '🏀',
    'Padel e tennis': '🎾', 'Fitness': '🏋️', 'Sport invernali': '⛷️', 'Danza': '💃', 'Altro sport': '🏅',
    'Sagra': '🍽️', 'Festa di paese': '🎉', 'Mercatino': '🛍️', 'Altra festa': '🎊',
    'Concerto': '🎤', 'Serata': '🌙', 'Festival': '🎶', 'Ballo': '💃', 'Altra musica': '🎵',
    'Mostra': '🖼️', 'Teatro': '🎭', 'Cinema': '🎬', 'Incontro': '💬', 'Spettacolo di danza': '🩰', 'Altra cultura': '🎨'
  };
  function cat(id) { return CATS[id] || CATS.sport; }
  function emoji(e) { return TYPE_EMOJI[e.type] || cat(e.category).emoji; }

  // ---------- Zone della provincia (come nell'app, lib/util/zones.dart) ----------
  var ZONES = [
    ['belluno', 'Belluno e dintorni', ['Belluno', 'Ponte nelle Alpi', 'Limana', 'Longarone', 'Soverzene']],
    ['alpago', 'Alpago', ['Alpago', "Chies d'Alpago", 'Tambre']],
    ['valbelluna', 'Valbelluna', ['Borgo Valbelluna', 'Sedico', 'Sospirolo', 'Santa Giustina', 'San Gregorio nelle Alpi', 'Cesiomaggiore']],
    ['feltrino', 'Feltrino', ['Feltre', 'Pedavena', 'Fonzaso', 'Arsiè', 'Lamon', 'Sovramonte', 'Seren del Grappa', 'Setteville']],
    ['agordino', 'Agordino', ['Agordo', 'Gosaldo', 'La Valle Agordina', 'Rivamonte Agordino', 'Taibon Agordino', 'Voltago Agordino',
      'Cencenighe Agordino', 'San Tomaso Agordino', 'Vallada Agordina', "Canale d'Agordo", 'Falcade', 'Alleghe', 'Rocca Pietore',
      'Colle Santa Lucia', 'Selva di Cadore', 'Livinallongo del Col di Lana']],
    ['zoldo', 'Val di Zoldo', ['Val di Zoldo', 'Zoppè di Cadore']],
    ['cadore', 'Cadore', ['Pieve di Cadore', 'Calalzo di Cadore', 'Domegge di Cadore', 'Lozzo di Cadore', 'Lorenzago di Cadore',
      'Vigo di Cadore', 'Auronzo di Cadore', 'Perarolo di Cadore', 'Valle di Cadore', 'Cibiana di Cadore', 'Ospitale di Cadore',
      'Borca di Cadore', 'San Vito di Cadore', 'Vodo Cadore']],
    ['comelico', 'Comelico', ['Comelico Superiore', 'Danta di Cadore', 'San Nicolò di Comelico', 'San Pietro di Cadore', 'Santo Stefano di Cadore']],
    ['cortina', "Cortina d'Ampezzo", ["Cortina d'Ampezzo"]]
  ].map(function (z) { return { id: z[0], name: z[1], towns: z[2] }; });
  function zoneOfTown(t) { return ZONES.filter(function (z) { return z.towns.indexOf(t) >= 0; })[0] || null; }
  /// Filtro "Dove": '' = tutto, 'z:<zona>' = una zona, altrimenti un comune.
  function inWhere(e, w) {
    if (!w) return true;
    if (w.indexOf('z:') === 0) { var z = zoneOfTown(e.town); return !!z && z.id === w.slice(2); }
    return e.town === w;
  }
  /// Per chi è: "Famiglie", "14+", "16+", "18+" (come nell'app)
  function ageMin(e) { return [14, 16, 18].indexOf(e.ageMin) >= 0 ? e.ageMin : 0; }

  // ---------- Date (sempre ora italiana) ----------
  function ymd(d) { return d.toLocaleDateString('en-CA', { timeZone: TZ }); } // 2026-11-14
  function addDays(s, n) {
    var p = s.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n, 12));
    return d.toISOString().slice(0, 10);
  }
  function weekday(s) { var p = s.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)).getUTCDay(); }
  function endTime(e) {
    if (e.end instanceof Date) return e.end;
    return new Date(e.start.getTime() + (e.durationMinutes || 60) * 60000);
  }
  /// Orari per giorno (eventi su più giorni): solo i giorni aperti, in ordine. [] = non indicati.
  function openDays(e) {
    if (!multiDay(e) || !Array.isArray(e.days)) return [];
    return e.days.filter(function (d) { return d && typeof d.d === 'string' && !d.closed; })
      .sort(function (a, b) { return a.d < b.d ? -1 : 1; });
  }
  /// Il giorno aperto di oggi o il prossimo.
  function nextOpenDay(e) {
    var t = ymd(new Date());
    return openDays(e).filter(function (d) { return d.d >= t; })[0] || null;
  }
  function hoursLabel(d) {
    if (d.closed) return 'Chiuso';
    if (d.from && d.to) return d.from + '–' + d.to;
    if (d.from) return 'dalle ' + d.from;
    if (d.to) return 'fino alle ' + d.to;
    return 'orario non indicato';
  }
  var WD = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  var MS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  function monthShort(s) { return MS[Number(s.slice(5, 7)) - 1]; }
  function dayName(s) { var p = s.split('-').map(Number); return WD[weekday(s)] + ' ' + p[2]; }
  function listDay(e) {
    var t = ymd(new Date()), n = nextOpenDay(e), d = n ? n.d : ymd(e.start);
    return d < t ? t : d;
  }
  function time(d) { return d.toLocaleTimeString('it-IT', { hour: 'numeric', minute: '2-digit', timeZone: TZ }); }
  function dayLong(s) {
    var p = s.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2], 12));
    return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  }
  function dayShort(d) { return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', timeZone: TZ }).replace('.', ''); }
  function dayHeader(s) {
    var t = ymd(new Date());
    var name = dayLong(s);
    if (s === t) return 'Oggi · ' + name;
    if (s === addDays(t, 1)) return 'Domani · ' + name;
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  function multiDay(e) { return e.end instanceof Date && ymd(e.end) !== ymd(e.start); }
  /// "ore 7:30", "dalle 11:00" (più giorni: "14–15 nov · dalle 11:00")
  function whenShort(e) {
    if (multiDay(e)) {
      var a = dayShort(e.start), b = dayShort(e.end);
      var same = a.split(' ')[1] === b.split(' ')[1];
      var n = nextOpenDay(e);
      if (n) return (same ? a.split(' ')[0] : a) + '–' + b + ' · ' +
        (n.d === ymd(new Date()) ? 'oggi' : WD[weekday(n.d)].toLowerCase()) + ' ' + hoursLabel(n);
      return (same ? a.split(' ')[0] : a) + '–' + b + ' · dalle ' + time(e.start);
    }
    if (endTime(e) > new Date() && e.start <= new Date()) return 'In corso · fino alle ' + time(endTime(e));
    return 'ore ' + time(e.start) + (e.end instanceof Date ? '–' + time(e.end) : '');
  }
  var ML = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  /// "Sab 21 novembre · 17:00", "Oggi · 17:00–19:00", "Dal 21 al 29 novembre · dalle 10:00"
  function whenLong(e) {
    var a = ymd(e.start), t = ymd(new Date());
    var pa = a.split('-').map(Number);
    if (multiDay(e)) {
      var b = ymd(e.end), pb = b.split('-').map(Number);
      var range = 'Dal ' + pa[2] + (pa[1] === pb[1] ? '' : ' ' + ML[pa[1] - 1]) + ' al ' + pb[2] + ' ' + ML[pb[1] - 1];
      return range + (openDays(e).length ? '' : ' · dalle ' + time(e.start));
    }
    var day = a === t ? 'Oggi' : a === addDays(t, 1) ? 'Domani' : dayName(a) + ' ' + ML[pa[1] - 1];
    return day + ' · ' + time(e.start) + (e.end instanceof Date && e.end > e.start ? '–' + time(e.end) : '');
  }
  function priceLabel(p) {
    if (typeof p !== 'number' || p < 0) return '';
    if (p === 0) return 'Gratis';
    var c = Math.round(p * 100);
    return (c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2).replace('.', ',')) + ' €';
  }

  // ---------- Filtri (come nell'app) ----------
  function plain(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' '); }
  function covers(e, from, to) { // giorni [from, to) in formato yyyy-mm-dd
    var od = openDays(e);
    if (od.length) return od.some(function (d) { return d.d >= from && d.d < to; });
    return ymd(e.start) < to && ymd(endTime(e)) >= from;
  }
  function filter(list, f) {
    var today = ymd(new Date());
    var toSat = (6 - weekday(today) + 7) % 7;
    var sat = weekday(today) === 0 ? addDays(today, -1) : addDays(today, toSat);
    var words = plain(f.q).split(' ').filter(Boolean);
    return list.filter(function (e) {
      if (f.cat && e.category !== f.cat) return false;
      if (f.town && !inWhere(e, f.town)) return false;
      if (f.free && e.price !== 0) return false;
      if (f.family && !e.family) return false;
      if (words.length) {
        var text = plain([e.title, e.place, e.town, e.type, organizer(e), cat(e.category).name, e.description].join(' '));
        if (!words.every(function (w) { return text.indexOf(w) >= 0; })) return false;
      }
      if (f.time === 'today') return covers(e, today, addDays(today, 1));
      if (f.time === 'weekend') return covers(e, sat, addDays(sat, 2));
      if (f.time === 'week') return covers(e, today, addDays(today, 7));
      return true;
    });
  }

  // ---------- Disegno ----------
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  /// Solo link web veri (niente javascript: e simili): i testi li scrivono gli utenti.
  function safeUrl(input, platform) {
    var s = (input || '').trim();
    if (!s) return '';
    if (platform && s.indexOf('.') < 0 && s.indexOf('/') < 0) {
      s = s.replace(/^@/, '');
      return platform === 'instagram' ? 'https://instagram.com/' + encodeURIComponent(s) : 'https://facebook.com/' + encodeURIComponent(s);
    }
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
    try {
      var u = new URL(s);
      return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '';
    } catch (e) { return ''; }
  }
  function tile(e) {
    var t = el('div', 'tile');
    t.style.background = 'linear-gradient(135deg,' + cat(e.category).color + ',' + cat(e.category).color + 'cc)';
    t.appendChild(el('span', '', emoji(e)));
    return t;
  }
  function eventCard(e) {
    var a = el('a', 'ev');
    a.href = '/e/?id=' + encodeURIComponent(e.id);
    a.style.setProperty('--c', cat(e.category).color);
    var pic = el('div', 'pic');
    pic.appendChild(tile(e));
    pic.dataset.id = e.id;
    a.appendChild(pic);
    var body = el('div', 'body');
    body.appendChild(el('p', 'when', whenShort(e)));
    body.appendChild(el('h3', '', e.title || 'Evento'));
    var place = [e.place, e.town].filter(Boolean).join(', ');
    if (place) body.appendChild(el('p', 'where', place));
    if (organizer(e)) body.appendChild(el('p', 'who', organizer(e)));
    var tags = el('div', 'tags');
    var pr = priceLabel(e.price);
    if (pr) tags.appendChild(el('span', 'tag' + (pr === 'Gratis' ? ' free' : ''), pr));
    if (e.family) tags.appendChild(el('span', 'tag fam', 'Famiglie'));
    else if (ageMin(e) >= 16) tags.appendChild(el('span', 'tag age', ageMin(e) + '+'));
    if (e.signupUrl) tags.appendChild(el('span', 'tag', 'Su iscrizione'));
    tags.appendChild(el('span', 'tag', e.type || cat(e.category).name));
    body.appendChild(tags);
    a.appendChild(body);
    return a;
  }
  /// Elenco per giorno; le foto arrivano dopo, solo per gli eventi mostrati.
  function renderEvents(box, list, empty) {
    box.innerHTML = '';
    if (!list.length) { box.appendChild(el('p', 'empty', empty)); return; }
    var last = '';
    var grid = null;
    list.forEach(function (e) {
      var d = listDay(e);
      if (d !== last) {
        box.appendChild(el('h2', 'day', dayHeader(d)));
        grid = el('div', 'evlist');
        box.appendChild(grid);
        last = d;
      }
      grid.appendChild(eventCard(e));
    });
    thumbs(list.slice(0, 120).map(function (e) { return e.id; })).then(function (map) {
      box.querySelectorAll('.pic').forEach(function (p) {
        var b64 = map[p.dataset.id];
        if (!b64 || !/^[A-Za-z0-9+/=]+$/.test(b64)) return;
        var img = el('img');
        img.alt = '';
        img.loading = 'lazy';
        img.src = 'data:image/jpeg;base64,' + b64;
        p.innerHTML = '';
        p.appendChild(img);
      });
    });
  }
  function avatar(g, size) {
    var box = el('div', 'avatar');
    box.style.width = box.style.height = size + 'px';
    if (g.image && /^[A-Za-z0-9+/=]+$/.test(g.image)) {
      var img = el('img');
      img.alt = '';
      img.src = 'data:image/jpeg;base64,' + g.image;
      box.appendChild(img);
    } else {
      box.style.background = cat(g.category).color;
      box.appendChild(el('span', '', TYPE_EMOJI[g.type] || cat(g.category).emoji));
    }
    return box;
  }
  // Icone semplici (uguali su ogni telefono, a differenza delle emoji: su iPhone 📅 mostra "17 luglio")
  var ICONS = {
    date: 'M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z',
    time: 'M12 2C6.47 2 2 6.48 2 12s4.47 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z',
    place: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
    price: 'M15 18.5c-2.51 0-4.68-1.42-5.76-3.5H15l1-2H8.58c-.05-.33-.08-.66-.08-1s.03-.67.08-1H15l1-2H9.24C10.32 6.92 12.5 5.5 15 5.5c1.61 0 3.09.59 4.23 1.57L21 5.3C19.41 3.87 17.3 3 15 3c-3.92 0-7.24 2.51-8.48 6H3l-1 2h4.06c-.04.33-.06.66-.06 1s.02.67.06 1H3l-1 2h4.52c1.24 3.49 4.56 6 8.48 6 2.31 0 4.41-.87 6-2.3l-1.78-1.77c-1.13.98-2.6 1.57-4.22 1.57z',
    people: 'M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
    flag: 'M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z'
  };
  function icon(name) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS(ns, 'path');
    path.setAttribute('d', ICONS[name] || ICONS.flag);
    svg.appendChild(path);
    return svg;
  }
  function verifiedBadge() {
    var s = el('span', 'verified', '✓');
    s.title = 'Organizzatore verificato';
    s.setAttribute('aria-label', 'Organizzatore verificato');
    return s;
  }

  window.CSB = {
    STORE: STORE, upcomingEvents: upcomingEvents, groupEvents: groupEvents, groups: groups, getDoc: getDoc,
    cat: cat, CATS: CATS, emoji: emoji, filter: filter, renderEvents: renderEvents, eventCard: eventCard,
    whenLong: whenLong, organizer: organizer, dayHours: function (e) {
      var days = (multiDay(e) && Array.isArray(e.days) ? e.days : []).filter(function (d) { return d && typeof d.d === 'string'; })
        .sort(function (a, b) { return a.d < b.d ? -1 : 1; });
      // Giorni consecutivi con lo stesso orario su una riga
      var groups = [];
      days.forEach(function (d) {
        var g = groups[groups.length - 1], last = g && g[g.length - 1];
        if (last && addDays(last.d, 1) === d.d && !!last.closed === !!d.closed &&
            (d.closed || (last.from === d.from && last.to === d.to))) g.push(d); else groups.push([d]);
      });
      return groups.map(function (g) {
        var a = g[0].d, b = g[g.length - 1].d, ma = a.slice(5, 7), mb = b.slice(5, 7);
        var label = groups.length === 1 && !g[0].closed ? 'Tutti i giorni' :
          (g.length === 1 ? dayName(a) + ' ' + monthShort(a) :
            dayName(a) + (ma === mb ? '' : ' ' + monthShort(a)) + ' – ' + dayName(b) + ' ' + monthShort(b));
        return label + ': ' + hoursLabel(g[0]);
      });
    }, priceLabel: priceLabel, endTime: endTime, el: el, safeUrl: safeUrl, avatar: avatar,
    verifiedBadge: verifiedBadge, tile: tile, ymd: ymd, ZONES: ZONES, zoneOfTown: zoneOfTown, ageMin: ageMin, icon: icon,
    ios: document.documentElement.classList.contains('ios')
  };
})();

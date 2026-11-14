// Che Succede Belluno – funzioni comuni del sito (solo lettura dei dati pubblici).
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
  function select(names) { return { fields: names.map(function (n) { return { fieldPath: n }; }) }; }

  var EVENT_FIELDS = ['title', 'category', 'type', 'start', 'end', 'durationMinutes', 'place', 'town', 'price',
    'groupId', 'groupName', 'cancelled', 'hidden', 'signupUrl', 'maxParticipants', 'description'];

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
  function listDay(e) { var t = ymd(new Date()), d = ymd(e.start); return d < t ? t : d; }
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
      return (same ? a.split(' ')[0] : a) + '–' + b + ' · dalle ' + time(e.start);
    }
    if (endTime(e) > new Date() && e.start <= new Date()) return 'In corso · fino alle ' + time(endTime(e));
    return 'ore ' + time(e.start) + (e.end instanceof Date ? '–' + time(e.end) : '');
  }
  function whenLong(e) {
    var s = dayLong(ymd(e.start));
    var txt;
    if (multiDay(e)) txt = 'dal ' + dayShort(e.start) + ' al ' + dayShort(e.end) + ', dalle ' + time(e.start);
    else txt = s + ' · ore ' + time(e.start) + (e.end instanceof Date ? '–' + time(e.end) : '');
    return txt.charAt(0).toUpperCase() + txt.slice(1);
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
    return ymd(e.start) < to && ymd(endTime(e)) >= from;
  }
  function filter(list, f) {
    var today = ymd(new Date());
    var toSat = (6 - weekday(today) + 7) % 7;
    var sat = weekday(today) === 0 ? addDays(today, -1) : addDays(today, toSat);
    var words = plain(f.q).split(' ').filter(Boolean);
    return list.filter(function (e) {
      if (f.cat && e.category !== f.cat) return false;
      if (f.town && e.town !== f.town) return false;
      if (f.free && e.price !== 0) return false;
      if (words.length) {
        var text = plain([e.title, e.place, e.town, e.type, e.groupName, cat(e.category).name, e.description].join(' '));
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
    if (e.groupName) body.appendChild(el('p', 'who', e.groupName));
    var tags = el('div', 'tags');
    var pr = priceLabel(e.price);
    if (pr) tags.appendChild(el('span', 'tag' + (pr === 'Gratis' ? ' free' : ''), pr));
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
  function verifiedBadge() {
    var s = el('span', 'verified', '✓');
    s.title = 'Organizzatore verificato';
    s.setAttribute('aria-label', 'Organizzatore verificato');
    return s;
  }

  window.CSB = {
    STORE: STORE, upcomingEvents: upcomingEvents, groupEvents: groupEvents, groups: groups, getDoc: getDoc,
    cat: cat, CATS: CATS, emoji: emoji, filter: filter, renderEvents: renderEvents, eventCard: eventCard,
    whenLong: whenLong, priceLabel: priceLabel, endTime: endTime, el: el, safeUrl: safeUrl, avatar: avatar,
    verifiedBadge: verifiedBadge, tile: tile, ymd: ymd
  };
})();

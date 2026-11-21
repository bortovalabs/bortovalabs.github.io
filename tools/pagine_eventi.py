"""Crea una pagina per ogni evento in arrivo: /e/<codice>.html

Serve per l'anteprima nei messaggi (WhatsApp, Telegram, Facebook): chi riceve il link vede
titolo, data, luogo e foto dell'evento. I programmi che preparano l'anteprima non eseguono
JavaScript, quindi i dati devono essere già scritti nella pagina.

Legge solo dati pubblici (gli eventi li può leggere chiunque, anche senza account) e salta
gli eventi nascosti. Le pagine degli eventi passati da più di 30 giorni vengono tolte: il link
continua a funzionare grazie a 404.html, che rimanda alla pagina generale /e/?id=...

Lo esegue GitHub Actions (.github/workflows/pagine-eventi.yml) ogni ora.
"""
import base64
import html
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

PROGETTO = 'che-succede-belluno'
SITO = 'https://bortovalabs.github.io'
CARTELLA = os.path.join(os.path.dirname(__file__), '..', 'e')
TZ = ZoneInfo('Europe/Rome')
GIORNI = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica']
MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto',
        'settembre', 'ottobre', 'novembre', 'dicembre']


def query(campo, dopo):
    """Eventi con [campo] (start o end) dopo [dopo], al massimo 500."""
    url = f'https://firestore.googleapis.com/v1/projects/{PROGETTO}/databases/(default)/documents:runQuery'
    chiave = os.environ.get('FIREBASE_API_KEY', '').strip()
    if chiave:
        url += '?key=' + chiave
    corpo = {'structuredQuery': {
        'from': [{'collectionId': 'events'}],
        'where': {'fieldFilter': {'field': {'fieldPath': campo}, 'op': 'GREATER_THAN_OR_EQUAL',
                                  'value': {'timestampValue': dopo.strftime('%Y-%m-%dT%H:%M:%SZ')}}},
        'limit': 500,
    }}
    req = urllib.request.Request(url, data=json.dumps(corpo).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        risposte = json.load(r)
    return {x['document']['name'].split('/')[-1]: x['document'].get('fields', {})
            for x in risposte if 'document' in x}


def testo(f, k):
    return (f.get(k) or {}).get('stringValue', '')


def data(f, k):
    v = (f.get(k) or {}).get('timestampValue')
    if not v:
        return None
    return datetime.fromisoformat(v.replace('Z', '+00:00')).astimezone(TZ)


def numero(f, k):
    v = f.get(k) or {}
    if 'integerValue' in v:
        return float(v['integerValue'])
    if 'doubleValue' in v:
        return float(v['doubleValue'])
    return None


def dati_strutturati(eid, f, titolo, s, e, foto, gruppo, annullato):
    """Scheda schema.org/Event per Google (risultati "Eventi" nella ricerca)."""
    if not s:
        return ''
    luogo = testo(f, 'place') or testo(f, 'town') or 'Provincia di Belluno'
    posto = {'@type': 'Place', 'name': luogo,
             'address': {'@type': 'PostalAddress', 'addressLocality': testo(f, 'town') or 'Belluno',
                         'addressRegion': 'BL', 'addressCountry': 'IT'}}
    lat, lng = numero(f, 'lat'), numero(f, 'lng')
    if lat is not None and lng is not None:
        posto['geo'] = {'@type': 'GeoCoordinates', 'latitude': lat, 'longitude': lng}
    fine = e or s + timedelta(minutes=int(numero(f, 'durationMinutes') or 0) or 180)
    ev = {
        '@context': 'https://schema.org',
        '@type': 'Event',
        'name': titolo,
        'startDate': s.isoformat(),
        'endDate': fine.isoformat(),
        'eventStatus': 'https://schema.org/EventCancelled' if annullato else 'https://schema.org/EventScheduled',
        'eventAttendanceMode': 'https://schema.org/OfflineEventAttendanceMode',
        'location': posto,
        'image': [foto],
        'url': f'{SITO}/e/{eid}',
    }
    descrizione = testo(f, 'description').strip()
    if descrizione:
        ev['description'] = descrizione[:500]
    if gruppo:
        org = {'@type': 'Organization', 'name': gruppo}
        if re.fullmatch(r'[A-Za-z0-9_-]{1,64}', testo(f, 'groupId')):
            org['url'] = f'{SITO}/g/{testo(f, "groupId")}'
        ev['organizer'] = org
    prezzo = numero(f, 'price')
    if prezzo is not None and prezzo >= 0:
        ev['isAccessibleForFree'] = prezzo == 0
        ev['offers'] = {'@type': 'Offer', 'price': f'{prezzo:.2f}', 'priceCurrency': 'EUR',
                        'availability': 'https://schema.org/InStock',
                        'url': testo(f, 'signupUrl') if testo(f, 'signupUrl').startswith('https://') else f'{SITO}/e/{eid}'}
    testo_json = json.dumps(ev, ensure_ascii=False).replace('<', '\\u003c')
    return f'<script type="application/ld+json">{testo_json}</script>'


def quando(s, e):
    giorno = lambda d: f'{GIORNI[d.weekday()]} {d.day} {MESI[d.month - 1]}'
    t = f'{giorno(s)} · {s:%H:%M}'
    if e:
        t += f'–{e:%H:%M}' if e.date() == s.date() else f' – {giorno(e)} {e:%H:%M}'
    return t[0].upper() + t[1:]


def pagina(modello, eid, f):
    titolo = testo(f, 'title') or 'Evento'
    s, e = data(f, 'start'), data(f, 'end')
    luogo = ', '.join(x for x in (testo(f, 'place'), testo(f, 'town')) if x)
    # Eventi della redazione (senza gruppo): chi organizza è scritto a mano
    gruppo = testo(f, 'groupName') if testo(f, 'groupId') else (testo(f, 'organizerText') or testo(f, 'groupName'))
    annullato = (f.get('cancelled') or {}).get('booleanValue', False)
    righe = [x for x in (('ANNULLATO · ' if annullato else '') + (quando(s, e) if s else ''), luogo, gruppo) if x]
    descrizione = ' · '.join(righe)
    foto = f'{SITO}/og.png'
    miniatura = testo(f, 'thumb') or ''
    if miniatura and len(miniatura) < 200_000:
        os.makedirs(os.path.join(CARTELLA, 'img'), exist_ok=True)
        with open(os.path.join(CARTELLA, 'img', eid + '.jpg'), 'wb') as out:
            out.write(base64.b64decode(miniatura))
        foto = f'{SITO}/e/img/{eid}.jpg'
    esc = lambda x: html.escape(x, quote=True)
    corpo = ''.join([
        f'<img class="photo" src="/e/img/{eid}.jpg" alt="">' if foto.endswith('.jpg') else '',
        '<span class="badge">Annullato</span>' if annullato else '',
        f'<h1>{esc(titolo)}</h1>',
        f'<p class="group">{esc(gruppo)}</p>' if gruppo else '',
        f'<p class="meta">{esc(quando(s, e))}</p>' if s else '',
        f'<p class="meta">{esc(luogo)}</p>' if luogo else '',
        f'<p class="desc">{esc(testo(f, "description")[:1500])}</p>' if testo(f, 'description') else '',
    ])
    p = modello
    p = p.replace('<title>Evento · Vivi Belluno</title>', f'<title>{esc(titolo)} · Vivi Belluno</title>')
    p = p.replace('content="Un evento su Vivi Belluno"', f'content="{esc(titolo)}"')
    p = p.replace('content="Sport, sagre, musica e cultura in provincia di Belluno."', f'content="{esc(descrizione)}"')
    p = p.replace('content="https://bortovalabs.github.io/og.png"', f'content="{foto}"')
    p = re.sub(r'<!--EVENTO-->.*<!--/EVENTO-->', lambda _: f'<div id="ev">{corpo}</div>', p, flags=re.S)
    # Per Google: indirizzo principale della pagina e scheda dell'evento
    testa = f'<link rel="canonical" href="{SITO}/e/{eid}">' + dati_strutturati(eid, f, titolo, s, e, foto, gruppo, annullato)
    p = p.replace('</head>', testa + '</head>', 1)
    return p


def mappa_del_sito(eventi_in_arrivo):
    """sitemap.xml: le pagine fisse e gli eventi non ancora finiti (per Google)."""
    righe = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for indirizzo in ['/', '/gruppi/', '/privacy.html', '/termini.html']:
        righe.append(f'<url><loc>{SITO}{indirizzo}</loc></url>')
    for eid in sorted(eventi_in_arrivo):
        righe.append(f'<url><loc>{SITO}/e/{eid}</loc></url>')
    righe.append('</urlset>')
    with open(os.path.join(CARTELLA, '..', 'sitemap.xml'), 'w', encoding='utf-8') as out:
        out.write('\n'.join(righe) + '\n')


def main():
    adesso = datetime.now(timezone.utc)
    eventi = query('start', adesso - timedelta(days=1))
    eventi.update(query('end', adesso - timedelta(days=30)))
    with open(os.path.join(CARTELLA, 'index.html'), encoding='utf-8') as f:
        modello = f.read()
    tenuti = set()
    in_arrivo = set()
    for eid, campi in eventi.items():
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', eid) or (campi.get('hidden') or {}).get('booleanValue'):
            continue
        s = data(campi, 'start')
        if s and s < adesso.astimezone(TZ) - timedelta(days=30) and not data(campi, 'end'):
            continue
        with open(os.path.join(CARTELLA, eid + '.html'), 'w', encoding='utf-8') as out:
            out.write(pagina(modello, eid, campi))
        tenuti.add(eid)
        fine = data(campi, 'end') or (s + timedelta(hours=3) if s else None)
        if fine and fine > adesso and not (campi.get('cancelled') or {}).get('booleanValue'):
            in_arrivo.add(eid)
    mappa_del_sito(in_arrivo)
    # Via le pagine (e le foto) degli eventi passati o eliminati
    for nome in os.listdir(CARTELLA):
        if nome.endswith('.html') and nome != 'index.html' and nome[:-5] not in tenuti:
            os.remove(os.path.join(CARTELLA, nome))
    cartella_img = os.path.join(CARTELLA, 'img')
    if os.path.isdir(cartella_img):
        for nome in os.listdir(cartella_img):
            if nome[:-4] not in tenuti:
                os.remove(os.path.join(cartella_img, nome))
    print(f'Pagine evento: {len(tenuti)}')


if __name__ == '__main__':
    sys.exit(main())

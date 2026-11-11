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
    gruppo = testo(f, 'groupName')
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
        f'<p class="meta">📅 {esc(quando(s, e))}</p>' if s else '',
        f'<p class="meta">📍 {esc(luogo)}</p>' if luogo else '',
    ])
    p = modello
    p = p.replace('<title>Evento · Che Succede Belluno</title>', f'<title>{esc(titolo)} · Che Succede Belluno</title>')
    p = p.replace('content="Un evento su Che Succede Belluno"', f'content="{esc(titolo)}"')
    p = p.replace('content="Sport, sagre, musica e cultura in provincia di Belluno."', f'content="{esc(descrizione)}"')
    p = p.replace('content="https://bortovalabs.github.io/og.png"', f'content="{foto}"')
    p = re.sub(r'<!--EVENTO-->.*<!--/EVENTO-->', lambda _: f'<div id="ev">{corpo}</div>', p, flags=re.S)
    return p


def main():
    adesso = datetime.now(timezone.utc)
    eventi = query('start', adesso - timedelta(days=1))
    eventi.update(query('end', adesso - timedelta(days=30)))
    with open(os.path.join(CARTELLA, 'index.html'), encoding='utf-8') as f:
        modello = f.read()
    tenuti = set()
    for eid, campi in eventi.items():
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', eid) or (campi.get('hidden') or {}).get('booleanValue'):
            continue
        s = data(campi, 'start')
        if s and s < adesso.astimezone(TZ) - timedelta(days=30) and not data(campi, 'end'):
            continue
        with open(os.path.join(CARTELLA, eid + '.html'), 'w', encoding='utf-8') as out:
            out.write(pagina(modello, eid, campi))
        tenuti.add(eid)
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

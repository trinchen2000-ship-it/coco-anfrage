const express = require('express');
const multer  = require('multer');
const path = require('path');
const crypto = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));

// ── Resend E-Mail ───────────────────────────────────────────────
async function sendMail({ to, subject, html, attachments = [] }) {
  const body = {
    from:        'Coco Colours <info@coco-colours.de>',
    to:          Array.isArray(to) ? to : [to],
    subject,
    html,
  };
  if (attachments.length > 0) {
    body.attachments = attachments.map(a => ({
      filename: a.filename,
      content:  a.content.toString('base64'),
    }));
  }
  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error: ${err}`);
  }
  return res.json();
}

// ── Dropbox Helper ──────────────────────────────────────────────
const DROPBOX_TOKEN = process.env.DROPBOX_TOKEN;

async function dropboxUpload(filePath, buffer) {
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${DROPBOX_TOKEN}`,
      'Dropbox-API-Arg': JSON.stringify({
        path: filePath,
        mode: 'overwrite',
        autorename: true
      }),
      'Content-Type': 'application/octet-stream'
    },
    body: buffer
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Dropbox upload failed: ${err}`);
  }
  return res.json();
}

async function dropboxMove(fromPath, toPath) {
  const res = await fetch('https://api.dropboxapi.com/2/files/move_v2', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${DROPBOX_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from_path: fromPath,
      to_path: toPath,
      autorename: true
    })
  });
  if (!res.ok) throw new Error(`Dropbox move failed: ${await res.text()}`);
  return res.json();
}

// Dateien im Arbeitsspeicher halten (keine Disk-Speicherung auf Railway nötig)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB pro Datei
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/webp','image/gif','image/heic'];
    cb(null, allowed.includes(file.mimetype));
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ── Admin: Dropbox Transfer Seite ───────────────────────────────
app.get('/dropbox-transfer', (req, res) => {
  const { id, name } = req.query;
  res.send(`<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>In Dropbox übertragen · Coco Colours</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;1,300&family=Josefin+Sans:wght@300;400&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--black:#090810;--card:#141220;--border:rgba(180,150,100,.2);--border-h:rgba(180,150,100,.45);--gold:#c9a472;--gold-l:#e8cfa0;--text:#e8e0d5;--muted:#8a8090;--r:6px}
body{background:var(--black);color:var(--text);font-family:'Josefin Sans',sans-serif;font-weight:300;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem}
.card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:2.5rem 2rem;max-width:440px;width:100%}
h1{font-family:'Cormorant Garamond',serif;font-size:1.5rem;font-weight:300;color:var(--gold-l);letter-spacing:.15em;text-transform:uppercase;margin-bottom:.3rem}
.sub{font-size:.65rem;letter-spacing:.3em;color:var(--muted);text-transform:uppercase;margin-bottom:2rem}
.anfrage-info{background:rgba(201,164,114,.06);border:1px solid rgba(201,164,114,.18);border-radius:var(--r);padding:.9rem 1rem;font-size:.78rem;color:var(--muted);margin-bottom:1.8rem;line-height:1.7}
.anfrage-info strong{color:var(--gold-l);font-weight:400}
label{display:block;font-size:.62rem;letter-spacing:.28em;text-transform:uppercase;color:var(--muted);margin-bottom:.45rem;margin-top:1rem}
input,select{width:100%;padding:.72rem .9rem;background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:var(--r);color:var(--text);font-family:'Josefin Sans',sans-serif;font-size:.82rem;font-weight:300;-webkit-appearance:none}
input:focus,select:focus{outline:none;border-color:var(--gold)}
select option{background:#14121e}
.btn{display:block;width:100%;margin-top:1.8rem;padding:.85rem;background:transparent;border:1px solid var(--gold);border-radius:var(--r);color:var(--gold);font-family:'Josefin Sans',sans-serif;font-size:.7rem;letter-spacing:.3em;text-transform:uppercase;cursor:pointer;transition:background .2s}
.btn:hover{background:rgba(201,164,114,.12)}
.btn:disabled{opacity:.4;cursor:not-allowed}
#msg{display:none;margin-top:1rem;padding:.9rem 1rem;border-radius:var(--r);font-size:.75rem;text-align:center;letter-spacing:.06em}
.ok{background:rgba(90,158,122,.1);border:1px solid rgba(90,158,122,.3);color:#8ecfb0}
.err{background:rgba(192,90,106,.1);border:1px solid rgba(192,90,106,.3);color:#e8a0aa}
</style>
</head>
<body>
<div class="card">
  <h1>Bilder übertragen</h1>
  <p class="sub">Anfrage → Dropbox</p>
  <div class="anfrage-info">
    <strong>Anfrage:</strong> ${name || 'Unbekannt'}<br>
    <strong>Dropbox-Ordner:</strong> /Anfragen-Eingang/${id}/
  </div>
  <form id="tf">
    <input type="hidden" name="id" value="${id}">
    <label>Artist</label>
    <select name="artist" required>
      <option value="">— Bitte wählen —</option>
      <option>Trine</option>
      <option>Franzi</option>
      <option>Juli</option>
      <option>Daniel</option>
      <option>Christian</option>
      <option>Aleks</option>
    </select>
    <label>Termin (Datum)</label>
    <input type="date" name="termin" required>
    <label>Vorname Kunde</label>
    <input type="text" name="vorname" value="${(name||'').split(' ')[0]}" required>
    <label>Nachname Kunde</label>
    <input type="text" name="nachname" value="${(name||'').split(' ')[1]||''}" required>
    <button type="submit" class="btn" id="sbtn">📁 In Dropbox verschieben</button>
  </form>
  <div id="msg"></div>
</div>
<script>
document.getElementById('tf').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('sbtn');
  const msg = document.getElementById('msg');
  btn.disabled = true;
  btn.textContent = 'Wird verschoben …';
  const fd = new FormData(e.target);
  try {
    const res = await fetch('/dropbox-transfer', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(Object.fromEntries(fd)) });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error);
    msg.className = 'ok'; msg.style.display='block';
    msg.textContent = '✓ Erfolgreich nach ' + j.path + ' verschoben';
    btn.textContent = '✓ Fertig';
  } catch(err) {
    msg.className = 'err'; msg.style.display='block';
    msg.textContent = 'Fehler: ' + err.message;
    btn.disabled=false; btn.textContent='📁 In Dropbox verschieben';
  }
});
</script>
</body>
</html>`);
});

app.post('/dropbox-transfer', async (req, res) => {
  const { id, artist, termin, vorname, nachname } = req.body;
  if (!id || !artist || !termin || !vorname || !nachname) {
    return res.json({ ok: false, error: 'Alle Felder ausfüllen' });
  }

  // Deutschen Monatsnamen ohne Umlaute, z.B. "Maerz 2026"
  const MONATE = [
    'Januar','Februar','Maerz','April','Mai','Juni',
    'Juli','August','September','Oktober','November','Dezember'
  ];
  const d = new Date(termin);
  const monatOrdner = `${MONATE[d.getMonth()]} ${d.getFullYear()}`;

  // Ordnername: YYYY-MM-DD_nachname_vorname (alles klein, Umlaute ersetzen)
  const clean = str => str
    .toLowerCase()
    .replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss')
    .replace(/\s+/g,'_').replace(/[^a-z0-9_-]/g,'');

  const datePart  = termin; // YYYY-MM-DD
  const folderName = `${datePart}_${clean(nachname)}_${clean(vorname)}`;

  const fromPath = `/Anfragen-Eingang/${id}`;
  const toPath   = `/Vorlagen ${artist}/${monatOrdner}/${folderName}`;

  try {
    await dropboxMove(fromPath, toPath);
    res.json({ ok: true, path: toPath });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── E-Mail Transporter ──────────────────────────────────────────
// (wird durch Resend ersetzt – siehe sendMail() oben)

// ── Formular-Submit ─────────────────────────────────────────────
app.post('/submit', upload.array('bilder', 10), async (req, res) => {
  const d = req.body;
  const files = req.files || [];

  // Eindeutige ID für diese Anfrage
  const anfragenId = crypto.randomBytes(6).toString('hex');
  const kundenName = `${d.vorname || ''} ${d.nachname || ''}`.trim();

  // ── Bilder in Dropbox /Anfragen-Eingang/{id}/ hochladen ──
  let dropboxOk = false;
  let transferUrl = '';
  if (files.length > 0 && DROPBOX_TOKEN) {
    try {
      for (const f of files) {
        await dropboxUpload(
          `/Anfragen-Eingang/${anfragenId}/${f.originalname}`,
          f.buffer
        );
      }
      dropboxOk = true;
      const baseUrl = process.env.APP_URL || `https://${req.headers.host}`;
      transferUrl = `${baseUrl}/dropbox-transfer?id=${anfragenId}&name=${encodeURIComponent(kundenName)}`;
    } catch (err) {
      console.error('Dropbox upload error:', err.message);
    }
  }

  // Antwortkanal
  const kontaktText = d.kontakt_art === 'whatsapp'
    ? `WhatsApp: ${d.telefon}`
    : `E-Mail: ${d.email}`;

  // Beratung vor Ort
  const beratungText = d.beratung === 'ja'
    ? '✅ Ja, Beratungstermin gewünscht'
    : 'Nein';

  // Anhänge für Studio-Mail
  const attachments = (req.files || []).map(f => ({
    filename: f.originalname,
    content:  f.buffer,
    contentType: f.mimetype
  }));

  // ── Mail ans Studio ──
  const studioHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
  body { font-family: Georgia, serif; background: #0d0b18; color: #e8e0d5; margin:0; padding:0; }
  .wrap { max-width: 600px; margin: 0 auto; padding: 40px 30px; }
  h1 { font-size: 1.4rem; color: #c9a472; letter-spacing: 0.15em; text-transform: uppercase; border-bottom: 1px solid rgba(201,164,114,0.2); padding-bottom: 12px; }
  .row { display: flex; gap: 8px; margin: 10px 0; font-size: 0.88rem; }
  .label { color: #8a8090; min-width: 160px; }
  .val { color: #e8e0d5; }
  .section { margin: 24px 0 8px; font-size: 0.7rem; letter-spacing: 0.3em; text-transform: uppercase; color: #c9a472; }
  .desc { background: rgba(255,255,255,0.04); border: 1px solid rgba(201,164,114,0.15); border-radius: 6px; padding: 14px; font-size: 0.88rem; line-height: 1.7; color: #e8e0d5; white-space: pre-wrap; }
  .footer { margin-top: 40px; font-size: 0.72rem; color: #8a8090; border-top: 1px solid rgba(201,164,114,0.12); padding-top: 16px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>🖤 Neue Tattoo-Anfrage</h1>

  <p class="section">Kunde</p>
  <div class="row"><span class="label">Name</span><span class="val">${d.vorname} ${d.nachname}</span></div>
  <div class="row"><span class="label">Geburtsdatum</span><span class="val">${d.geburtsdatum || '—'}</span></div>
  <div class="row"><span class="label">Telefon</span><span class="val">${d.telefon || '—'}</span></div>
  <div class="row"><span class="label">E-Mail</span><span class="val">${d.email || '—'}</span></div>
  <div class="row"><span class="label">Bestandskunde</span><span class="val">${d.bestandskunde === 'ja' ? 'Ja' : 'Nein'}</span></div>
  ${d.bestandskunde === 'ja' && d.artist ? `<div class="row"><span class="label">Bisheriger Artist</span><span class="val">${d.artist}</span></div>` : ''}

  <p class="section">Tattoo-Wunsch</p>
  <div class="row"><span class="label">Art</span><span class="val">${d.art || '—'}</span></div>
  <div class="row"><span class="label">Farbe</span><span class="val">${d.farbe || '—'}</span></div>
  <div class="row"><span class="label">Stil</span><span class="val">${d.stil || '—'}</span></div>
  <div class="row"><span class="label">Körperstelle</span><span class="val">${d.koerperstelle || '—'}</span></div>
  ${d.beschreibung ? `<p class="section">Beschreibung</p><div class="desc">${d.beschreibung}</div>` : ''}

  <p class="section">Kontakt & Sonstiges</p>
  <div class="row"><span class="label">Antwort bevorzugt per</span><span class="val">${kontaktText}</span></div>
  <div class="row"><span class="label">Beratung vor Ort</span><span class="val">${beratungText}</span></div>
  ${attachments.length > 0 ? `<div class="row"><span class="label">Anhänge</span><span class="val">${attachments.length} Bild(er) im Anhang</span></div>` : ''}
  ${dropboxOk ? `
  <div style="margin-top:28px;padding:16px 20px;background:rgba(90,158,122,.1);border:1px solid rgba(90,158,122,.3);border-radius:6px;">
    <p style="font-size:0.7rem;letter-spacing:0.2em;text-transform:uppercase;color:#8ecfb0;margin-bottom:10px;">📁 Bilder in Dropbox gespeichert</p>
    <p style="font-size:0.82rem;color:#c8c0bb;margin-bottom:14px;line-height:1.6;">Wenn ein Termin vereinbart wird, klicke den Button um die Bilder in den richtigen Artist-Ordner zu verschieben:</p>
    <a href="${transferUrl}" style="display:inline-block;padding:10px 22px;background:transparent;border:1px solid #c9a472;border-radius:5px;color:#c9a472;font-size:0.7rem;letter-spacing:0.25em;text-transform:uppercase;text-decoration:none;">📁 In Dropbox übertragen</a>
  </div>` : ''}

  <div class="footer">Coco Colours Tattoo &amp; Piercing · anfrage.coco-colours.de</div>
</div>
</body>
</html>`;

  // ── Bestätigungsmail an Kunden ──
  const kundeHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
  body { font-family: Georgia, serif; background: #0d0b18; color: #e8e0d5; margin:0; padding:0; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 40px 30px; }
  .logo { font-size: 1.6rem; letter-spacing: 0.2em; color: #c9a472; text-align:center; margin-bottom: 8px; }
  .sub { font-size: 0.65rem; letter-spacing: 0.35em; color: #8a8090; text-align:center; text-transform:uppercase; margin-bottom: 32px; }
  p { font-size: 0.9rem; line-height: 1.8; color: #c8c0bb; margin: 0 0 16px; }
  .highlight { color: #c9a472; }
  .box { background: rgba(201,164,114,0.06); border: 1px solid rgba(201,164,114,0.2); border-radius: 6px; padding: 16px 20px; margin: 24px 0; font-size: 0.85rem; line-height: 1.8; }
  .footer { margin-top: 40px; font-size: 0.68rem; color: #8a8090; border-top: 1px solid rgba(201,164,114,0.12); padding-top: 16px; text-align:center; }
  a { color: #c9a472; }
</style>
</head>
<body>
<div class="wrap">
  <div class="logo">Coco Colours</div>
  <div class="sub">Tattoo &amp; Piercing · Jena</div>

  <p>Hei <span class="highlight">${d.vorname}</span>,</p>
  <p>deine Anfrage ist bei uns angekommen – vielen Dank! 🖤<br>
  Wir melden uns so schnell wie möglich bei dir.</p>

  <div class="box">
    <strong style="color:#c9a472;font-size:0.7rem;letter-spacing:0.2em;text-transform:uppercase;">Deine Anfrage</strong><br><br>
    Art: ${d.art || '—'}<br>
    Stil: ${d.stil || '—'}<br>
    Farbe: ${d.farbe || '—'}<br>
    Körperstelle: ${d.koerperstelle || '—'}
  </div>

  <p>Falls du noch Fragen hast oder weitere Bilder schicken möchtest, erreichst du uns unter
  <a href="mailto:info@coco-colours.de">info@coco-colours.de</a>.</p>

  <p>Bis bald in Jena,<br><span class="highlight">Dein Coco Colours Team</span></p>

  <div class="footer">
    Coco Colours Tattoo &amp; Piercing · Jena, Thüringen<br>
    <a href="https://www.coco-colours.de">www.coco-colours.de</a>
  </div>
</div>
</body>
</html>`;

  try {
    // An Studio
    await sendMail({
      to:          process.env.RECIPIENT_EMAIL || 'info@coco-colours.de',
      subject:     `Neue Anfrage: ${d.vorname} ${d.nachname} · ${d.art || 'Tattoo'}`,
      html:        studioHtml,
      attachments: attachments.map(a => ({ filename: a.filename, content: a.content })),
    });

    // An Kunde
    if (d.email) {
      await sendMail({
        to:      d.email,
        subject: 'Deine Anfrage bei Coco Colours 🖤',
        html:    kundeHtml,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Mail error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});
// ── Mietschuldenfreiheitsbescheinigung Endpoint ─────────────────

// CORS-Preflight für links.coco-colours.de
app.options('/api/mietfrei', (req, res) => {
  res.set('Access-Control-Allow-Origin', 'https://links.coco-colours.de');
  res.set('Access-Control-Allow-Methods', 'POST');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});

// Endpoint: empfängt PDF + Daten, schickt Mail an Trine
app.post('/api/mietfrei', async (req, res) => {
  res.set('Access-Control-Allow-Origin', 'https://links.coco-colours.de');

  try {
    const { pdfBase64, vermieter, mieter, seitDatum } = req.body;

    if (!pdfBase64 || !vermieter || !mieter) {
      return res.status(400).json({ ok: false, error: 'Felder fehlen' });
    }

    await sendMail({
      to:      process.env.RECIPIENT_EMAIL || 'info@coco-colours.de',
      subject: `Mietschuldenfreiheitsbescheinigung ${mieter} – unterzeichnet`,
      html: `
        <p>Die Mietschuldenfreiheitsbescheinigung wurde unterzeichnet.</p>
        <ul>
          <li><strong>Vermieter:</strong> ${vermieter}</li>
          <li><strong>Mieterin:</strong> ${mieter}</li>
          <li><strong>Mietverhältnis seit:</strong> ${seitDatum}</li>
        </ul>
        <p>Das fertige PDF ist im Anhang.</p>
      `,
      attachments: [{
        filename: `Mietschuldenfreiheitsbescheinigung_${mieter.replace(/\s+/g, '_')}.pdf`,
        content:  Buffer.from(pdfBase64, 'base64')
      }]
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Mietfrei error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`Coco Anfrage läuft auf Port ${PORT}`));

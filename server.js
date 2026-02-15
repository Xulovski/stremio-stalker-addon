import express from "express";
import cors from "cors";
import axios from "axios";

const app = express();

const PORT = process.env.PORT || 8080;

const ADDON_ID = "org.xulovski.stremio.stalker";
const ADDON_NAME = "Stalker IPTV Multi-Portal";

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ================= HELPERS ================= */

function decodeConfig(req) {
  if (!req.query.config) return null;
  try {
    return JSON.parse(
      Buffer.from(req.query.config, "base64").toString("utf8")
    );
  } catch (err) {
    console.error("Erro ao decodificar config:", err.message);
    return null;
  }
}

function normalizePortal(url) {
  if (!url) return "";
  return url
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/c$/, "")
    .replace(/\/portal\.php$/, "");
}

/* ================= PÁGINA DE CONFIGURAÇÃO ================= */

app.get("/configure", (req, res) => {
  res.send(`
  <!DOCTYPE html>
  <html lang="pt">
  <head>
    <meta charset="utf-8">
    <title>Configurar Stalker IPTV</title>
    <style>
      body { font-family: sans-serif; padding: 20px; max-width: 600px; margin: auto; }
      label { display: block; margin-top: 12px; font-weight: bold; }
      input { width: 100%; padding: 10px; margin: 6px 0; box-sizing: border-box; }
      button { width: 100%; padding: 12px; margin: 16px 0; font-size: 16px; cursor: pointer; }
      .server { border: 1px solid #ddd; padding: 16px; margin-bottom: 16px; border-radius: 8px; }
      hr { margin: 24px 0; }
    </style>
  </head>
  <body>
    <h2>Configurar Portais Stalker / Ministra</h2>
    <form method="POST">
      <div id="list">
        <div class="server">
          <label>URL do Portal (ex: http://123.45.67.89:8080/c/):</label>
          <input name="portal[]" required placeholder="http://exemplo.com:porta/c/">
          <label>Endereço MAC (ex: 00:1A:79:XX:XX:XX):</label>
          <input name="mac[]" required pattern="[0-9A-Fa-f:]{17}" placeholder="00:1A:79:XX:XX:XX">
        </div>
      </div>
      <button type="button" onclick="addServer()">+ Adicionar outro portal</button>
      <button type="submit">Guardar e Instalar no Stremio</button>
    </form>

    <script>
      function addServer() {
        const div = document.createElement("div");
        div.className = "server";
        div.innerHTML = \`
          <label>URL do Portal:</label>
          <input name="portal[]" required placeholder="http://exemplo.com:porta/c/">
          <label>Endereço MAC:</label>
          <input name="mac[]" required pattern="[0-9A-Fa-f:]{17}" placeholder="00:1A:79:XX:XX:XX">
        \`;
        document.getElementById("list").appendChild(div);
      }
    </script>
  </body>
  </html>
  `);
});

app.post("/configure", (req, res) => {
  try {
    let portals = Array.isArray(req.body.portal) ? req.body.portal : [req.body.portal];
    let macs = Array.isArray(req.body.mac) ? req.body.mac : [req.body.mac];

    portals = portals.map(p => p?.trim()).filter(Boolean);
    macs = macs.map(m => m?.trim().toUpperCase()).filter(Boolean);

    if (portals.length === 0 || portals.length !== macs.length) {
      return res.status(400).send("Preencha pelo menos um portal e MAC válidos");
    }

    const config = {
      portals: portals.map((p, i) => ({
        portal: normalizePortal(p),
        mac: macs[i]
      }))
    };

    const encoded = Buffer.from(JSON.stringify(config)).toString("base64");

    const host = req.headers.host || `localhost:${PORT}`;
    const installUrl = `stremio://\( {host}/manifest.json?config= \){encoded}`;

    res.redirect(installUrl);
  } catch (err) {
    console.error("Erro ao processar configuração:", err);
    res.status(500).send("Erro ao guardar configuração");
  }
});

/* ================= MANIFEST ================= */

app.get("/manifest.json", (req, res) => {
  const config = decodeConfig(req);

  res.json({
    id: ADDON_ID,
    version: "1.0.2",
    name: ADDON_NAME,
    description: "Suporte a múltiplos portais Stalker/Ministra IPTV",
    resources: ["catalog", "stream"],
    types: ["tv"],
    catalogs: config
      ? config.portals.map((_, i) => ({
          type: "tv",
          id: `stalker_${i}`,
          name: `Portal ${i + 1}`
        }))
      : [],
    behaviorHints: {
      configurable: true,
      configurationRequired: !config
    }
  });
});

/* ================= CATALOGO ================= */

app.get("/catalog/tv/:id.json", async (req, res) => {
  try {
    const config = decodeConfig(req);
    if (!config) return res.json({ metas: [] });

    const index = Number(req.params.id.replace("stalker_", ""));
    const entry = config.portals[index];
    if (!entry) return res.json({ metas: [] });

    const { portal, mac } = entry;

    const handshake = await axios.get(`${portal}/portal.php`, {
      params: { type: "stb", action: "handshake", JsHttpRequest: "1-xml" },
      headers: {
        "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stb-ver/0.2.18 Mobile Safari/533.3",
        "Cookie": `mac=${mac}; stb_lang=pt; timezone=Europe/Lisbon`,
        "X-User-Agent": "Model: MAG250; Link: WiFi"
      },
      timeout: 15000
    });

    const token = handshake.data?.js?.token;
    if (!token) return res.json({ metas: [] });

    const channelsRes = await axios.get(`${portal}/portal.php`, {
      params: { type: "itv", action: "get_all_channels", JsHttpRequest: "1-xml" },
      headers: {
        Authorization: `Bearer ${token}`,
        "Cookie": `mac=${mac}`
      },
      timeout: 15000
    });

    const channels = channelsRes.data?.js?.data || [];

    const metas = channels.map(ch => ({
      id: `stalker:\( {index}: \){ch.id}`,
      type: "tv",
      name: ch.name || "Canal sem nome",
      poster: ch.logo ? `\( {portal}/stalker_portal/misc/logos/320/ \){ch.logo}` : null
    }));

    res.json({ metas });
  } catch (e) {
    console.error("Erro no catálogo:", e.message);
    res.json({ metas: [] });
  }
});

/* ================= STREAM ================= */

app.get("/stream/tv/:id.json", async (req, res) => {
  console.log("Pedido de stream:", req.params.id);

  try {
    const config = decodeConfig(req);
    if (!config) return res.json({ streams: [] });

    const parts = req.params.id.split(":");
    if (parts.length !== 3) return res.json({ streams: [] });

    const [, portalIndex, channelId] = parts;
    const index = Number(portalIndex);
    const entry = config.portals[index];
    if (!entry) return res.json({ streams: [] });

    const { portal, mac } = entry;

    const handshake = await axios.get(`${portal}/portal.php`, {
      params: { type: "stb", action: "handshake", JsHttpRequest: "1-xml" },
      headers: {
        "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stb-ver/0.2.18 Mobile Safari/533.3",
        "Cookie": `mac=${mac}; stb_lang=pt; timezone=Europe/Lisbon`,
        "X-User-Agent": "Model: MAG250; Link: WiFi"
      },
      timeout: 15000
    });

    const token = handshake.data?.js?.token;
    if (!token) return res.json({ streams: [] });

    const create = await axios.get(`${portal}/portal.php`, {
      params: {
        type: "itv",
        action: "create_link",
        cmd: `/ch/${channelId}`,
        JsHttpRequest: "1-xml"
      },
      headers: {
        Authorization: `Bearer ${token}`,
        "Cookie": `mac=${mac}`
      },
      timeout: 15000
    });

    let streamUrl = create.data?.js?.cmd || "";
    streamUrl = streamUrl.replace(/^ffmpeg\s+/i, "").trim();

    if (!streamUrl) return res.json({ streams: [] });

    res.json({
      streams: [{
        name: "Stream IPTV",
        title: "Canal ao vivo",
        url: streamUrl,
        behaviorHints: {
          notWebReady: false,
          isLiveStream: true
        }
      }]
    });
  } catch (e) {
    console.error("Erro no stream:", e.message);
    res.json({ streams: [] });
  }
});

/* ================= INÍCIO ================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Addon Stremio Stalker ativo na porta ${PORT}`);
  console.log(`→ Configuração: http://localhost:${PORT}/configure`);
  console.log(`→ Para telemóvel / outro dispositivo: usa o IP da tua rede (ex: http://192.168.1.xxx:${PORT}/configure)`);
});

import express from "express"
import cors from "cors"
import axios from "axios"

const app = express()

// PORTA PARA O RENDER
const PORT = process.env.PORT || 3000

const ADDON_ID = "org.xulovski.stremio.stalker"
const ADDON_NAME = "Stalker IPTV Multi-Portal"
const USER_AGENT = "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3"

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

/* ================= HELPERS ================= */

function decodeConfig(req) {
  if (!req.query.config) return null
  try {
    return JSON.parse(Buffer.from(req.query.config, "base64").toString("utf8"))
  } catch {
    return null
  }
}

async function getHandshake(portal, mac) {
  try {
    const res = await axios.get(`${portal}/portal.php`, {
      params: {
        action: "handshake",
        type: "stb",
        JsHttpRequest: "1-xml"
      },
      headers: {
        "User-Agent": USER_AGENT,
        "Cookie": `mac=${mac}`
      },
      timeout: 5000
    })
    return res.data?.js?.token || null
  } catch (e) {
    return null
  }
}

/* ================= CONFIG PAGE ================= */

app.get("/configure", (req, res) => {
  res.send(`
  <html>
  <body style="background: #111; color: white; font-family: sans-serif; padding: 20px;">
    <h2>Configurar Stalker IPTV</h2>
    <form method="POST">
      <div id="list">
        <div style="background: #222; padding: 15px; border-radius: 8px; margin-bottom: 10px;">
          Portal URL (ex: http://servidor.com):<br>
          <input name="portal[]" style="width: 100%; margin: 10px 0;" required placeholder="http://..."><br>
          MAC Address:<br>
          <input name="mac[]" style="width: 100%; margin: 10px 0;" required placeholder="00:1A:79:XX:XX:XX"><br>
        </div>
      </div>
      <button type="button" onclick="add()" style="padding: 10px;">+ Adicionar Portal</button><br><br>
      <button type="submit" style="padding: 10px 20px; background: #8126d3; color: white; border: none; border-radius: 5px; cursor: pointer;">Guardar e Instalar no Stremio</button>
    </form>
    <script>
      function add() {
        const div = document.createElement("div")
        div.style = "background: #222; padding: 15px; border-radius: 8px; margin-bottom: 10px;"
        div.innerHTML = \`
          <hr>
          Portal URL:<br>
          <input name="portal[]" style="width: 100%; margin: 10px 0;" required><br>
          MAC Address:<br>
          <input name="mac[]" style="width: 100%; margin: 10px 0;" required><br>
        \`
        document.getElementById("list").appendChild(div)
      }
    </script>
  </body>
  </html>
  `)
})

app.post("/configure", (req, res) => {
  const portals = Array.isArray(req.body.portal) ? req.body.portal : [req.body.portal]
  const macs = Array.isArray(req.body.mac) ? req.body.mac : [req.body.mac]

  const config = {
    portals: portals.map((p, i) => ({
      portal: p.trim().replace(/\/+$/, ""),
      mac: macs[i].trim()
    }))
  }

  const encoded = Buffer.from(JSON.stringify(config)).toString("base64")
  res.redirect(`stremio://${req.headers.host}/manifest.json?config=${encoded}`)
})

/* ================= MANIFEST ================= */

app.get("/manifest.json", (req, res) => {
  const config = decodeConfig(req)
  res.json({
    id: ADDON_ID,
    version: "1.1.0",
    name: ADDON_NAME,
    description: "Addon Stalker IPTV Multi-Portal",
    types: ["tv"],
    resources: ["catalog", "stream"],
    catalogs: config ? config.portals.map((_, i) => ({
      type: "tv",
      id: `stalker_portal_${i}`,
      name: `Servidor ${i + 1}`
    })) : [],
    behaviorHints: { configurable: true, configurationRequired: !config }
  })
})

/* ================= CATALOG ================= */
app.get("/catalog/tv/:id.json", async (req, res) => {
  const config = decodeConfig(req);
  if (!config) return res.json({ metas: [] });

  // Extração robusta do índice do portal
  const index = parseInt(req.params.id.replace("stalker_portal_", ""));
  if (isNaN(index) || !config.portals[index]) return res.json({ metas: [] });

  const { portal, mac } = config.portals[index];
  const token = await getHandshake(portal, mac);
  if (!token) return res.json({ metas: [] });

  try {
    const response = await axios.get(`${portal}/portal.php`, {
      params: { action: "get_all_channels", type: "itv", JsHttpRequest: "1-xml" },
      headers: { "User-Agent": USER_AGENT, "Cookie": `mac=${mac}; authorization=Bearer ${token}` }
    });

    const channels = response.data?.js?.data || [];
    const metas = channels.map(ch => ({
      id: `stalker:${index}:${ch.id}`, // ID único para o Stremio reconhecer
      type: "tv",
      name: ch.name,
      poster: ch.logo ? (ch.logo.startsWith('http') ? ch.logo : `${portal}/${ch.logo}`) : null,
      background: ch.logo,
      description: `Canal: ${ch.name}`
    }));

    res.json({ metas });
  } catch (e) {
    res.json({ metas: [] });
  }
});

/* ================= STREAM ================= */
app.get("/stream/tv/:id.json", async (req, res) => {
  const config = decodeConfig(req);
  if (!config || !req.params.id.startsWith("stalker:")) return res.json({ streams: [] });

  const [ , portalIndex, channelId] = req.params.id.split(":");
  const { portal, mac } = config.portals[parseInt(portalIndex)];

  const token = await getHandshake(portal, mac);
  if (!token) return res.json({ streams: [] });

  try {
    const response = await axios.get(`${portal}/portal.php`, {
      params: { action: "create_link", type: "itv", cmd: `/ch/${channelId}`, JsHttpRequest: "1-xml" },
      headers: { "User-Agent": USER_AGENT, "Cookie": `mac=${mac}; authorization=Bearer ${token}` }
    });

    let streamUrl = response.data?.js?.cmd || "";
    streamUrl = streamUrl.split(" ").pop(); // Limpa prefixos

    if (streamUrl && streamUrl.startsWith("http")) {
      res.json({ streams: [{ name: "Directo", title: "Assistir Agora", url: streamUrl }] });
    } else {
      res.json({ streams: [] });
    }
  } catch (e) {
    res.json({ streams: [] });
  }
});

/* ================= START ================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Addon ativo em: http://0.0.0.0:${PORT}`)
})


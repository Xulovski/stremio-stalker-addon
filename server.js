import express from "express"
import cors from "cors"
import axios from "axios"

const app = express()

const PORT = process.env.PORT || 8080

const ADDON_ID = "org.xulovski.stremio.stalker"
const ADDON_NAME = "Stalker IPTV Multi-Portal"

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

/* ================= HELPERS ================= */

function decodeConfig(req) {
  if (!req.query.config) return null
  try {
    return JSON.parse(
      Buffer.from(req.query.config, "base64").toString("utf8")
    )
  } catch (err) {
    console.error("Erro ao decodificar config:", err.message)
    return null
  }
}

function normalizePortal(url) {
  return url.trim().replace(/\/+$/, "")
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
      body {font-family:sans-serif; padding:20px; max-width:600px; margin:auto;}
      label {display:block; margin-top:12px;}
      input {width:100%; padding:10px; margin:6px 0; box-sizing:border-box;}
      button {width:100%; padding:12px; margin:10px 0; font-size:16px;}
      hr {margin:20px 0;}
    </style>
  </head>
  <body>
    <h2>Configurar Portais Stalker</h2>
    <form method="POST">
      <div id="list">
        <div>
          <label>URL do Portal (ex: http://ip:porta/c/):</label>
          <input name="portal[]" required placeholder="http://exemplo.com/c/">
          <label>Endereço MAC:</label>
          <input name="mac[]" required pattern="[0-9A-Fa-f:]{17}" placeholder="00:1A:79:XX:XX:XX">
        </div>
      </div>
      <button type="button" onclick="add()">+ Adicionar outro servidor</button>
      <button type="submit">Guardar e Instalar no Stremio</button>
    </form>

    <script>
      function add() {
        const div = document.createElement("div")
        div.innerHTML = \`
          <hr>
          <label>URL do Portal:</label>
          <input name="portal[]" required placeholder="http://exemplo.com/c/">
          <label>Endereço MAC:</label>
          <input name="mac[]" required pattern="[0-9A-Fa-f:]{17}" placeholder="00:1A:79:XX:XX:XX">
        \`
        document.getElementById("list").appendChild(div)
      }
    </script>
  </body>
  </html>
  `)
})

app.post("/configure", (req, res) => {
  try {
    let portals = Array.isArray(req.body.portal) ? req.body.portal : [req.body.portal]
    let macs = Array.isArray(req.body.mac) ? req.body.mac : [req.body.mac]

    portals = portals.map(p => p?.trim()).filter(Boolean)
    macs = macs.map(m => m?.trim().toUpperCase()).filter(Boolean)

    if (portals.length === 0 || portals.length !== macs.length) {
      return res.status(400).send("Preencha pelo menos um portal e MAC válidos")
    }

    const config = {
      portals: portals.map((p, i) => ({
        portal: normalizePortal(p),
        mac: macs[i]
      }))
    }

    const encoded = Buffer.from(JSON.stringify(config)).toString("base64")

    const host = req.headers.host || `localhost:${PORT}`
    const installUrl = `stremio://\( {host}/manifest.json?config= \){encoded}`

    res.redirect(installUrl)
  } catch (err) {
    console.error("Erro ao processar configuração:", err)
    res.status(500).send("Erro ao guardar configuração")
  }
})

/* ================= MANIFEST ================= */

app.get("/manifest.json", (req, res) => {
  const config = decodeConfig(req)

  res.json({
    id: ADDON_ID,
    version: "1.0.1",
    name: ADDON_NAME,
    description: "Múltiplos portais Stalker/Ministra IPTV",
    resources: ["catalog", "stream"],
    types: ["channel"],
    catalogs: config
      ? config.portals.map((_, i) => ({
          type: "channel",
          id: `stalker_${i}`,
          name: `Portal ${i + 1}`
        }))
      : [],
    behaviorHints: {
      configurable: true,
      configurationRequired: !config
    }
  })
})

/* ================= CATALOGO ================= */

app.get("/catalog/channel/:id.json", async (req, res) => {
  try {
    const config = decodeConfig(req)
    if (!config) return res.json({ metas: [] })

    const index = Number(req.params.id.replace("stalker_", ""))
    const entry = config.portals[index]
    if (!entry) return res.json({ metas: [] })

    const { portal, mac } = entry

    const handshake = await axios.get(`${portal}/portal.php`, {
      params: { type: "stb", action: "handshake", JsHttpRequest: "1-xml" },
      headers: {
        "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stb-ver/0.2.18 Mobile Safari/533.3",
        "Cookie": `mac=${mac}; stb_lang=pt; timezone=Europe/Lisbon`,
        "X-User-Agent": "Model: MAG250; Link: WiFi"
      },
      timeout: 20000
    })

    const token = handshake.data?.js?.token
    if (!token) return res.json({ metas: [] })

    const channelsRes = await axios.get(`${portal}/portal.php`, {
      params: { type: "itv", action: "get_all_channels", JsHttpRequest: "1-xml" },
      headers: {
        Authorization: `Bearer ${token}`,
        "Cookie": `mac=${mac}`
      },
      timeout: 20000
    })

    const channels = channelsRes.data?.js?.data || []

    const metas = channels.map(ch => ({
      id: `stalker:\( {index}: \){ch.id}`,
      type: "channel",
      name: ch.name || "Sem nome",
      poster: ch.logo ? `\( {portal}/stalker_portal/misc/logos/320/ \){ch.logo}` : null
    }))

    res.json({ metas })
  } catch (e) {
    console.error("Erro no catálogo:", e.message)
    res.json({ metas: [] })
  }
})

/* ================= STREAM ================= */

app.get("/stream/channel/:id.json", async (req, res) => {
  console.log("Pedido de stream:", req.params.id)

  try {
    const config = decodeConfig(req)
    if (!config) return res.json({ streams: [] })

    const [, portalIndex, channelId] = req.params.id.split(":")
    const index = Number(portalIndex)
    const entry = config.portals[index]
    if (!entry) return res.json({ streams: [] })

    const { portal, mac } = entry

    const handshake = await axios.get(`${portal}/portal.php`, {
      params: { type: "stb", action: "handshake", JsHttpRequest: "1-xml" },
      headers: {
        "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stb-ver/0.2.18 Mobile Safari/533.3",
        "Cookie": `mac=${mac}; stb_lang=pt; timezone=Europe/Lisbon`,
        "X-User-Agent": "Model: MAG250; Link: WiFi"
      },
      timeout: 20000
    })

    const token = handshake.data?.js?.token
    if (!token) return res.json({ streams: [] })

    const create = await axios.get(`${portal}/portal.php`, {
      params: {
        type: "itv",
        action: "create_link",
        cmd: `ch${channelId}`,
        JsHttpRequest: "1-xml"
      },
      headers: {
        Authorization: `Bearer ${token}`,
        "Cookie": `mac=${mac}`
      },
      timeout: 20000
    })

    let streamUrl = create.data?.js?.cmd || ""
    streamUrl = streamUrl.replace(/^ffmpeg\s+/i, "").trim()

    if (!streamUrl) return res.json({ streams: [] })

    res.json({
      streams: [{
        name: "Stream IPTV",
        title: "Canal ao vivo",
        url: streamUrl,
        behaviorHints: { isLiveStream: true }
      }]
    })
  } catch (e) {
    console.error("Erro no stream:", e.message)
    res.json({ streams: [] })
  }
})

/* ================= INÍCIO ================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Addon ativo na porta ${PORT}`)
  console.log(`Configuração: http://localhost:${PORT}/configure`)
  console.log(`(para outro dispositivo usa o IP do telemóvel: http://192.168.x.x:${PORT}/configure)`)
})

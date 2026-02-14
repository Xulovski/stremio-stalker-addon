import express from "express"
import cors from "cors"
import axios from "axios"

const app = express()

const PORT = process.env.PORT || 8080  // melhor para Termux

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
    console.error("Decode config error:", err)
    return null
  }
}

function normalizePortal(url) {
  return url.trim().replace(/\/+$/, "")
}

/* ================= CONFIG PAGE ================= */

app.get("/configure", (req, res) => {
  res.send(`
  <!DOCTYPE html>
  <html lang="pt">
  <head><meta charset="utf-8"><title>Configurar Stalker</title>
  <style>body{font-family:sans-serif;padding:20px}input,button{width:100%;margin:10px 0;padding:10px;box-sizing:border-box}</style>
  </head>
  <body>
    <h2>Configurar Portais Stalker IPTV</h2>
    <form method="POST">
      <div id="list">
        <div>
          <label>Portal URL (ex: http://ip:porta/c/):</label><br>
          <input name="portal[]" required placeholder="http://exemplo.com/c/"><br>
          <label>MAC Address:</label><br>
          <input name="mac[]" required pattern="[0-9A-Fa-f:]{17}" placeholder="00:1A:79:XX:XX:XX"><br><br>
        </div>
      </div>
      <button type="button" onclick="add()">+ Adicionar outro servidor</button><br><br>
      <button type="submit">Guardar e Instalar no Stremio</button>
    </form>

    <script>
      function add() {
        const div = document.createElement("div")
        div.innerHTML = \`
          <hr style="margin:20px 0">
          <label>Portal URL:</label><br>
          <input name="portal[]" required placeholder="http://exemplo.com/c/"><br>
          <label>MAC Address:</label><br>
          <input name="mac[]" required pattern="[0-9A-Fa-f:]{17}" placeholder="00:1A:79:XX:XX:XX"><br><br>
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

    portals = portals.filter(Boolean)
    macs = macs.filter(Boolean)

    if (portals.length === 0 || portals.length !== macs.length) {
      return res.status(400).send("Dados incompletos")
    }

    const config = {
      portals: portals.map((p, i) => ({
        portal: normalizePortal(p),
        mac: macs[i].toUpperCase()
      }))
    }

    const encoded = Buffer.from(JSON.stringify(config)).toString("base64")

    const host = req.headers.host || "localhost:8080"
    res.redirect(`stremio://\( {host}/manifest.json?config= \){encoded}`)
  } catch (err) {
    console.error(err)
    res.status(500).send("Erro ao salvar configuração")
  }
})

/* ================= MANIFEST ================= */

app.get("/manifest.json", (req, res) => {
  const config = decodeConfig(req)

  const manifest = {
    id: ADDON_ID,
    version: "1.0.1",
    name: ADDON_NAME,
    description: "Suporte a múltiplos portais Stalker/Ministra IPTV",
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
  }

  res.json(manifest)
})

/* ================= CATALOG ================= */

app.get("/catalog/channel/:id.json", async (req, res) => {
  try {
    const config = decodeConfig(req)
    if (!config) return res.json({ metas: [] })

    const index = Number(req.params.id.replace("stalker_", ""))
    const { portal, mac } = config.portals[index] || {}

    if (!portal || !mac) return res.json({ metas: [] })

    const handshake = await axios.get(`${portal}/portal.php`, {
      params: { type: "stb", action: "handshake", JsHttpRequest: "1-xml" },
      headers: {
        "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stb-ver/0.2.18 Mobile Safari/533.3",
        Cookie: `mac=${mac}; stb_lang=en; timezone=Europe/Lisbon`
      },
      timeout: 15000
    })

    const token = handshake.data?.js?.token
    if (!token) return res.json({ metas: [] })

    const channelsRes = await axios.get(`${portal}/portal.php`, {
      params: { type: "itv", action: "get_all_channels", JsHttpRequest: "1-xml" },
      headers: {
        Authorization: `Bearer ${token}`,
        Cookie: `mac=${mac}`
      }
    })

    const channels = channelsRes.data?.js?.data || []

    const metas = channels.map(ch => ({
      id: `stalker:\( {index}: \){ch.id}`,
      type: "channel",
      name: ch.name || "Canal sem nome",
      poster: ch.logo ? `\( {portal}/stalker_portal/misc/logos/320/ \){ch.logo}` : null
    }))

    res.json({ metas })
  } catch (e) {
    console.error("Catalog error:", e.message)
    res.json({ metas: [] })
  }
})

/* ================= STREAM ================= */

app.get("/stream/channel/:id.json", async (req, res) => {
  console.log("Stream pedido:", req.params.id)

  try {
    const config = decodeConfig(req)
    if (!config) return res.json({ streams: [] })

    const [, portalIndex, channelId] = req.params.id.split(":")
    const index = Number(portalIndex)
    const { portal, mac } = config.portals[index] || {}

    if (!portal || !mac) return res.json({ streams: [] })

    const handshake = await axios.get(`${portal}/portal.php`, {
      params: { type: "stb", action: "handshake", JsHttpRequest: "1-xml" },
      headers: {
        "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stb-ver/0.2.18 Mobile Safari/533.3",
        Cookie: `mac=${mac}`
      }
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
        Cookie: `mac=${mac}`
      }
    })

    let streamUrl = create.data?.js?.cmd || ""
    streamUrl = streamUrl.replace(/^ffmpeg\s+/i, "").trim()

    if (!streamUrl) return res.json({ streams: [] })

    res.json({
      streams: [{
        name: "IPTV Stream",
        title: "Stalker Live",
        url: streamUrl,
        behaviorHints: { isLiveStream: true }
      }]
    })
  } catch (e) {
    console.error("Stream error:", e.message)
    res.json({ streams: [] })
  }
})

/* ================= START ================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Addon rodando em http://localhost:${PORT}`)
  console.log(`Configuração: http://localhost:${PORT}/configure`)
})

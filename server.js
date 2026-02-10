import express from "express"
import cors from "cors"
import axios from "axios"

/* ===================== CONFIG ===================== */

const app = express()
const PORT = process.env.PORT || 3000
const ADDON_ID = "org.xulovski.stremio.stalker"
const ADDON_NAME = "Stalker IPTV (Multi-Portal)"
const BASE_URL = process.env.BASE_URL || "https://stremio-stalker-addon-1.onrender.com"

/* ===================== MIDDLEWARE ===================== */

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

/* ===================== HELPERS ===================== */

function normalizeStalkerUrl(input) {
  let url = input.trim().replace(/\/+$/, "")

  if (url.includes("load.php") || url.includes("portal.php")) {
    return url
  }

  if (url.endsWith("/c")) {
    return url.replace(/\/c$/, "") + "/stalker_portal/server/load.php"
  }

  return url + "/stalker_portal/server/load.php"
}

function decodeConfig(req) {
  if (!req.query.config) return null
  try {
    const json = Buffer.from(req.query.config, "base64").toString("utf8")
    return JSON.parse(json)
  } catch {
    return null
  }
}

/* ===================== STALKER API ===================== */

async function stalkerHandshake(baseUrl, mac) {
  const res = await axios.get(baseUrl, {
    params: { type: "stb", action: "handshake", token: "" },
    headers: {
      "User-Agent": "Mozilla/5.0",
      "X-User-Agent": "Model: MAG250; Link: WiFi",
      "Cookie": `mac=${mac}; stb_lang=en; timezone=GMT`
    }
  })
  return res.data.js.token
}

async function stalkerGetChannels(baseUrl, mac, token) {
  const res = await axios.get(baseUrl, {
    params: { type: "itv", action: "get_all_channels" },
    headers: {
      "Authorization": `Bearer ${token}`,
      "X-User-Agent": "Model: MAG250; Link: WiFi"
    }
  })
  return res.data.js.data || []
}

/* ===================== CONFIG PAGE ===================== */

app.get("/configure", (req, res) => {
  res.send(`
    <html>
      <body>
        <h2>Configurar Stalker IPTV</h2>
        <form method="POST">
          <label>Portal URL</label><br>
          <input name="portal" required /><br><br>

          <label>MAC Address</label><br>
          <input name="mac" required /><br><br>

          <button type="submit">Guardar e Instalar</button>
        </form>
      </body>
    </html>
  `)
})

app.post("/configure", (req, res) => {
  const { portal, mac } = req.body
  if (!portal || !mac) return res.status(400).send("Dados em falta")

  const config = {
    portals: [{ portal, mac }]
  }

  const encoded = Buffer.from(JSON.stringify(config)).toString("base64")

  res.redirect(
    `stremio://${BASE_URL.replace("https://", "")}/manifest.json?config=${encoded}`
  )
})

/* ===================== MANIFEST (DINÂMICO) ===================== */

app.get("/manifest.json", (req, res) => {
  const config = decodeConfig(req)

  res.json({
    id: ADDON_ID,
    version: "1.0.0",
    name: ADDON_NAME,
    description: config
      ? "Stalker IPTV configurado"
      : "Addon configurável para Stalker IPTV",
    types: ["tv"],
    resources: ["catalog", "stream"],
    catalogs: [
      {
        type: "tv",
        id: "stalker_tv",
        name: "Stalker IPTV"
      }
    ],
    behaviorHints: {
      configurable: true,
      configurationRequired: !config
    }
  })
})

/* ===================== CATALOG ===================== */

app.get("/catalog/tv/stalker_tv.json", async (req, res) => {
  try {
    const config = decodeConfig(req)
    if (!config || !config.portals?.length) {
      return res.json({ metas: [] })
    }

    const { portal, mac } = config.portals[0]
    const baseUrl = normalizeStalkerUrl(portal)

    const token = await stalkerHandshake(baseUrl, mac)
    const channels = await stalkerGetChannels(baseUrl, mac, token)

    const metas = channels.map(ch => ({
      id: `stalker:${ch.id}`,
      type: "tv",
      name: ch.name,
      poster: ch.logo || null
    }))

    res.json({ metas })
  } catch (e) {
    console.error("CATALOG ERROR:", e.message)
    res.json({ metas: [] })
  }
})

/* ===================== STREAM ===================== */

app.get("/stream/:type/:id.json", async (req, res) => {
  try {
    const config = decodeConfig(req)
    if (!config || !config.portals?.length) {
      return res.json({ streams: [] })
    }

    const { portal, mac } = config.portals[0]
    const channelId = req.params.id.replace("stalker:", "")
    const base = portal.replace(/\/$/, "")

    // handshake
    const handshake = await axios.get(
      `${base}/portal.php?action=handshake&type=stb&token=&JsHttpRequest=1-xml`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "X-User-Agent": "Model: MAG250; Link: WiFi",
          "Cookie": `mac=${mac}; stb_lang=en; timezone=GMT`
        }
      }
    )

    const token = handshake.data.js.token
    const cookie = handshake.headers["set-cookie"].join("; ")

    // create stream
    const create = await axios.get(
      `${base}/portal.php?action=create_link&type=itv&cmd=ffmpeg%20http://localhost/ch/${channelId}&JsHttpRequest=1-xml`,
      {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Cookie": cookie,
          "X-User-Agent": "Model: MAG250; Link: WiFi"
        }
      }
    )

    const streamUrl = create.data.js.cmd.replace("ffmpeg ", "")

    res.json({
      streams: [
        {
          title: "Stalker IPTV",
          url: streamUrl
        }
      ]
    })
  } catch (e) {
    console.error("STREAM ERROR:", e.message)
    res.json({ streams: [] })
  }
})

/* ===================== START ===================== */

app.listen(PORT, "0.0.0.0", () => {
  console.log("Servidor ativo na porta", PORT)
})

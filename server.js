import express from "express"
import axios from "axios"
import cors from "cors"

/* =========================
   CONFIG
========================= */

const app = express()
const PORT = process.env.PORT || 7000
const ADDON_URL = "https://stremio-stalker-addon-1.onrender.com"

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

/* =========================
   HELPERS
========================= */

function normalizeStalkerUrl(input) {
  let url = input.trim().replace(/\/+$/, "")

  if (url.includes("load.php")) return url
  if (url.includes("portal.php")) return url

  if (url.endsWith("/c")) {
    return url.replace(/\/c$/, "") + "/stalker_portal/server/load.php"
  }

  return url + "/stalker_portal/server/load.php"
}

function getBasePortal(url) {
  return url.replace("/stalker_portal/server/load.php", "")
}

/* =========================
   STALKER API
========================= */

async function stalkerHandshake(baseUrl, mac) {
  const res = await axios.get(baseUrl, {
    params: {
      type: "stb",
      action: "handshake",
      token: "",
      JsHttpRequest: "1-xml"
    },
    headers: {
      "User-Agent": "Mozilla/5.0",
      "X-User-Agent": "Model: MAG250; Link: WiFi",
      "Cookie": `mac=${mac}`
    }
  })

  return {
    token: res.data.js.token,
    cookie: res.headers["set-cookie"]?.join("; ") || ""
  }
}

async function stalkerGetChannels(baseUrl, token) {
  const res = await axios.get(baseUrl, {
    params: {
      type: "itv",
      action: "get_all_channels",
      JsHttpRequest: "1-xml"
    },
    headers: {
      "Authorization": `Bearer ${token}`,
      "X-User-Agent": "Model: MAG250; Link: WiFi"
    }
  })

  return res.data.js.data || []
}

/* =========================
   CONFIG PAGE
========================= */

app.get("/configure", (req, res) => {
  res.send(`
    <html>
      <body>
        <h2>Configurar Stalker IPTV</h2>
        <form method="POST" action="/configure">
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
    302,
    `stremio://${ADDON_URL}/manifest.json?config=${encoded}`
  )
})

/* =========================
   MANIFEST
========================= */

app.get("/manifest.json", (req, res) => {
  res.json({
    id: "org.xulovski.stremio.stalker",
    version: "1.0.0",
    name: "Stalker IPTV (Multi-Portal)",
    description: "Addon Stremio Stalker IPTV",
    types: ["tv"],
    resources: ["catalog", "stream"],
    catalogs: [
      { type: "tv", id: "stalker_tv", name: "Stalker IPTV" }
    ],
    behaviorHints: {
      configurable: true,
      configurationRequired: true
    }
  })
})

/* =========================
   CATALOG
========================= */

app.get("/catalog/tv/stalker_tv.json", async (req, res) => {
  try {
    const { portal, mac } = req.query
    if (!portal || !mac) return res.json({ metas: [] })

    const loadUrl = normalizeStalkerUrl(portal)
    const { token } = await stalkerHandshake(loadUrl, mac)
    const channels = await stalkerGetChannels(loadUrl, token)

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

/* =========================
   STREAM
========================= */

app.get("/stream/:type/:id.json", async (req, res) => {
  try {
    const { portal, mac } = req.query
    if (!portal || !mac) return res.json({ streams: [] })

    const channelId = req.params.id.replace("stalker:", "")
    const loadUrl = normalizeStalkerUrl(portal)
    const basePortal = getBasePortal(loadUrl)

    // 1️⃣ Handshake
    const { token, cookie } = await stalkerHandshake(loadUrl, mac)

    // 2️⃣ Create link
    const create = await axios.get(`${basePortal}/portal.php`, {
      params: {
        action: "create_link",
        type: "itv",
        cmd: `ffmpeg http://localhost/ch/${channelId}`,
        JsHttpRequest: "1-xml"
      },
      headers: {
        "Authorization": `Bearer ${token}`,
        "Cookie": cookie,
        "X-User-Agent": "Model: MAG250; Link: WiFi"
      }
    })

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

/* =========================
   START
========================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log("Servidor ativo na porta", PORT)
}) 

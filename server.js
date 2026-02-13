import express from "express"
import cors from "cors"
import axios from "axios"

const PORT = process.env.PORT || 3000

const app = express()
const PORT = 3000

const ADDON_ID = "org.xulovski.stremio.stalker"
const ADDON_NAME = "Stalker IPTV Multi-Portal"

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

/* ================= HELPERS ================= */

function decodeConfig(req) {
  if (!req.query.config) return null
  try {
    return JSON.parse(Buffer.from(req.query.config, "base64").toString("utf8"))
  } catch (e) {
    return null
  }
}

function normalizePortal(url) {
  return url.trim().replace(/\/+$/, "").replace(/\/c$/, "")
}

/* ================= CONFIG PAGE ================= */

app.get("/configure", (req, res) => {
  res.send(`
    <html>
    <body>
      <h2>Configurar Stalker IPTV</h2>
      <form method="POST">
        <div id="list">
          <div>
            Portal URL:<br>
            <input name="portal[]" required><br>
            MAC Address:<br>
            <input name="mac[]" required><br><br>
          </div>
        </div>
        <button type="button" onclick="add()">Adicionar servidor</button><br><br>
        <button type="submit">Guardar e Instalar</button>
      </form>

      <script>
        function add() {
          const div = document.createElement("div")
          div.innerHTML = \`
            <hr>
            Portal URL:<br>
            <input name="portal[]" required><br>
            MAC Address:<br>
            <input name="mac[]" required><br><br>
          \`
          document.getElementById("list").appendChild(div)
        }
      </script>
    </body>
    </html>
  `)
})

app.post("/configure", (req, res) => {
  const config = {
    portals: req.body.portal.map((p, i) => ({
      portal: normalizePortal(p),
      mac: req.body.mac[i]
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
    version: "1.0.0",
    name: ADDON_NAME,
    description: "Addon IPTV Stalker com múltiplos portais",
    types: ["tv"],
    resources: ["catalog", "stream"],
    catalogs: config
      ? config.portals.map((_, i) => ({
          type: "tv",
          id: `stalker_${i}`,
          name: `Servidor ${i + 1}`
        }))
      : [],
    behaviorHints: {
      configurable: true,
      configurationRequired: !config
    }
  })
})

/* ================= CATALOG ================= */
app.get("/catalog/tv/:id.json", async (req, res) => {
  try {
    const config = decodeConfig(req)
    if (!config) return res.json({ metas: [] })

    const index = Number(req.params.id.replace("stalker_", ""))
    const { portal, mac } = config.portals[index]

    const handshake = await axios.get(`${portal}/portal.php`, {
      params: { action: "handshake", type: "stb", JsHttpRequest: "1-xml" },
      headers: {
        "User-Agent": "Mozilla/5.0",
        "X-User-Agent": "Model: MAG250; Link: WiFi",
        Cookie: `mac=${mac}`
      }
    })

    const token = handshake.data.js.token

    const channelsRes = await axios.get(`${portal}/portal.php`, {
      params: { action: "get_all_channels", type: "itv", JsHttpRequest: "1-xml" },
      headers: {
        Authorization: `Bearer ${token}`,
        "X-User-Agent": "Model: MAG250; Link: WiFi",
        Cookie: `mac=${mac}`
      }
    })

    const channels = channelsRes.data?.js?.data || []

    const metas = channels.map(ch => ({
      id: `stalker:${index}:${ch.id}`, // 👈 CRÍTICO
      type: "tv",                      // 👈 CRÍTICO
      name: ch.name,
      poster: ch.logo || null
    }))

    res.json({ metas })
  } catch (e) {
    console.error("CATALOG ERROR:", e.message)
    res.json({ metas: [] })
  }
})

/* ================= STREAM ================= */
app.get("/stream/tv/:id.json", async (req, res) => {
  console.log("STREAM REQUEST:", req.params.id)

  try {
    const config = decodeConfig(req)
    if (!config) return res.json({ streams: [] })

    const [, portalIndex, channelId] = req.params.id.split(":")
    const { portal, mac } = config.portals[portalIndex]

    const handshake = await axios.get(`${portal}/portal.php`, {
      params: { action: "handshake", type: "stb", JsHttpRequest: "1-xml" },
      headers: {
        "User-Agent": "Mozilla/5.0",
        "X-User-Agent": "Model: MAG250; Link: WiFi",
        Cookie: `mac=${mac}`
      }
    })

    const token = handshake.data.js.token

    const create = await axios.get(`${portal}/portal.php`, {
      params: {
        action: "create_link",
        type: "itv",
        cmd: `ffmpeg http://localhost/ch/${channelId}`,
        JsHttpRequest: "1-xml"
      },
      headers: {
        Authorization: `Bearer ${token}`,
        "X-User-Agent": "Model: MAG250; Link: WiFi",
        Cookie: `mac=${mac}`
      }
    })

    const streamUrl = create.data?.js?.cmd?.replace("ffmpeg ", "")

    console.log("STREAM URL:", streamUrl)

    if (!streamUrl) return res.json({ streams: [] })

    res.json({
      streams: [
        {
          title: "Stalker IPTV",
          url: streamUrl,
          behaviorHints: {
            notWebReady: true
          }
        }
      ]
    })
  } catch (e) {
    console.error("STREAM ERROR:", e.message)
    res.json({ streams: [] })
  }
})

/* ================= START ================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log("Addon Stremio ativo na porta", PORT)
})

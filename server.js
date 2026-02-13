import express from "express"
import cors from "cors"
import axios from "axios"

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

const USER_AGENT = "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3"

/* ================= HELPERS DE AUTENTICAÇÃO ================= */

async function getStalkerToken(portal, mac) {
  try {
    const res = await axios.get(`${portal}/portal.php`, {
      params: { action: "handshake", type: "stb", JsHttpRequest: "1-xml" },
      headers: { "User-Agent": USER_AGENT, "Cookie": `mac=${mac}` }
    })
    return res.data?.js?.token || null
  } catch (e) { return null }
}

function decodeConfig(req) {
  try {
    return JSON.parse(Buffer.from(req.query.config, "base64").toString("utf8"))
  } catch { return null }
}

/* ================= MANIFEST ================= */

app.get("/manifest.json", (req, res) => {
  const config = decodeConfig(req)
  res.json({
    id: "org.xulovski.stremio.stalker",
    version: "1.1.0",
    name: "Stalker IPTV Multi-Portal",
    description: "Canais em direto via Portais Stalker",
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
  const config = decodeConfig(req)
  if (!config) return res.json({ metas: [] })

  const index = parseInt(req.params.id.split("_").pop())
  const { portal, mac } = config.portals[index]

  const token = await getStalkerToken(portal, mac)
  if (!token) return res.json({ metas: [] })

  try {
    const channelsRes = await axios.get(`${portal}/portal.php`, {
      params: { action: "get_all_channels", type: "itv", JsHttpRequest: "1-xml" },
      headers: { 
        "User-Agent": USER_AGENT, 
        "Cookie": `mac=${mac}; authorization=Bearer ${token}` 
      }
    })

    const metas = (channelsRes.data?.js?.data || []).map(ch => ({
      id: `stalker:${index}:${ch.id}`,
      type: "tv",
      name: ch.name,
      poster: ch.logo ? (ch.logo.startsWith('http') ? ch.logo : `${portal}/${ch.logo}`) : null
    }))

    res.json({ metas })
  } catch (e) { res.json({ metas: [] }) }
})

/* ================= STREAM ================= */

app.get("/stream/tv/:id.json", async (req, res) => {
  const config = decodeConfig(req)
  if (!config) return res.json({ streams: [] })

  const [, portalIndex, channelId] = req.params.id.split(":")
  const { portal, mac } = config.portals[portalIndex]

  const token = await getStalkerToken(portal, mac)
  if (!token) return res.json({ streams: [] })

  try {
    const linkRes = await axios.get(`${portal}/portal.php`, {
      params: { action: "create_link", type: "itv", cmd: `/ch/${channelId}`, JsHttpRequest: "1-xml" },
      headers: { 
        "User-Agent": USER_AGENT, 
        "Cookie": `mac=${mac}; authorization=Bearer ${token}` 
      }
    })

    let rawUrl = linkRes.data?.js?.cmd || ""
    // Limpeza crucial: remove prefixos como "ffrt ", "ffmpeg ", etc.
    const cleanUrl = rawUrl.split(" ").pop()

    if (!cleanUrl || !cleanUrl.startsWith("http")) return res.json({ streams: [] })

    res.json({
      streams: [{
        name: "Stalker Portal",
        title: "Qualidade Original",
        url: cleanUrl
      }]
    })
  } catch (e) { res.json({ streams: [] }) }
})

/* ================= CONFIG PAGE (SIMPLIFICADA) ================= */

app.get("/configure", (req, res) => {
  res.send(`
    <style>body{font-family:sans-serif;padding:20px;background:#111;color:#fff}input{display:block;width:100%;margin:10px 0;padding:10px}</style>
    <h2>Configurar Stalker</h2>
    <form method="POST">
      URL do Portal: <input name="portal" placeholder="http://url-do-servidor:8080/c" required>
      MAC Address: <input name="mac" placeholder="00:1A:79:XX:XX:XX" required>
      <button type="submit" style="padding:10px 20px;cursor:pointer">Instalar no Stremio</button>
    </form>
  `)
})

app.post("/configure", (req, res) => {
  const config = { portals: [{ portal: req.body.portal.replace(/\/$/, ""), mac: req.body.mac }] }
  const encoded = Buffer.from(JSON.stringify(config)).toString("base64")
  res.redirect(`stremio://${req.headers.host}/manifest.json?config=${encoded}`)
})

app.listen(PORT, "0.0.0.0", () => console.log(`Addon rodando na porta ${PORT}`))


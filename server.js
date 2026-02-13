import express from "express"
import cors from "cors"
import axios from "axios"

const app = express()
const PORT = process.env.PORT || 3000
const USER_AGENT = "Mozilla/5.0 (MAG250) AppleWebKit/533.3 (KHTML, like Gecko)"

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

function decodeConfig(req) {
  try {
    const configStr = req.query.config || req.params.config
    return JSON.parse(Buffer.from(configStr, "base64").toString("utf8"))
  } catch (e) { return null }
}

async function getHandshake(portal, mac) {
  try {
    const res = await axios.get(`${portal}/portal.php`, {
      params: { action: "handshake", type: "stb", JsHttpRequest: "1-xml" },
      headers: { "User-Agent": USER_AGENT, "Cookie": `mac=${mac}` },
      timeout: 7000
    })
    return res.data?.js?.token || null
  } catch (e) { return null }
}

/* ================= MANIFEST ================= */
app.get("/manifest.json", (req, res) => {
  const config = decodeConfig(req)
  res.json({
    id: "org.xulovski.stalker",
    version: "1.2.0",
    name: "Stalker IPTV",
    description: "Canais em direto",
    types: ["tv"],
    resources: ["catalog", "stream"],
    catalogs: config ? config.portals.map((_, i) => ({
      type: "tv",
      id: `stalker_p${i}`, // ID curto e simples
      name: `Servidor ${i + 1}`
    })) : [],
    behaviorHints: { configurable: true, configurationRequired: !config }
  })
})

/* ================= CATALOG ================= */
app.get("/catalog/tv/:id.json", async (req, res) => {
  const config = decodeConfig(req)
  if (!config) return res.json({ metas: [] })

  const index = parseInt(req.params.id.replace("stalker_p", ""))
  const portalData = config.portals[index]
  if (!portalData) return res.json({ metas: [] })

  const token = await getHandshake(portalData.portal, portalData.mac)
  if (!token) {
    console.log(`Falha no Handshake para o Portal ${index}`)
    return res.json({ metas: [] })
  }

  try {
    const response = await axios.get(`${portalData.portal}/portal.php`, {
      params: { action: "get_all_channels", type: "itv", JsHttpRequest: "1-xml" },
      headers: { "User-Agent": USER_AGENT, "Cookie": `mac=${portalData.mac}; authorization=Bearer ${token}` },
      timeout: 10000
    })

    const channels = response.data?.js?.data || []
    const metas = channels.map(ch => ({
      id: `stlk_${index}_${ch.id}`, // Prefixo curto para evitar bugs de metadata
      type: "tv",
      name: ch.name,
      poster: ch.logo ? (ch.logo.startsWith('http') ? ch.logo : `${portalData.portal}/${ch.logo}`) : null
    }))

    console.log(`Enviados ${metas.length} canais do Portal ${index}`)
    res.json({ metas })
  } catch (e) {
    res.json({ metas: [] })
  }
})

/* ================= STREAM ================= */
app.get("/stream/tv/:id.json", async (req, res) => {
  const config = decodeConfig(req)
  if (!config) return res.json({ streams: [] })

  try {
    const parts = req.params.id.split("_") // stlk, index, channelId
    const index = parseInt(parts[1])
    const channelId = parts[2]
    const { portal, mac } = config.portals[index]

    const token = await getHandshake(portal, mac)
    const response = await axios.get(`${portal}/portal.php`, {
      params: { action: "create_link", type: "itv", cmd: `/ch/${channelId}`, JsHttpRequest: "1-xml" },
      headers: { "User-Agent": USER_AGENT, "Cookie": `mac=${mac}; authorization=Bearer ${token}` }
    })

    let url = (response.data?.js?.cmd || "").split(" ").pop()
    if (url.startsWith("http")) {
      return res.json({ streams: [{ name: "Play", url: url }] })
    }
  } catch (e) { }
  res.json({ streams: [] })
})

app.get("/configure", (req, res) => { /* Mantém o teu código de configuração */ })
app.post("/configure", (req, res) => { /* Mantém o teu código de configuração */ })

app.listen(PORT, "0.0.0.0", () => console.log(`Rodando na porta ${PORT}`))


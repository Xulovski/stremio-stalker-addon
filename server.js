import express from "express"
import bodyParser from "body-parser"
import cors from "cors"

const app = express()
const PORT = process.env.PORT || 7000

app.use(cors())
app.use(bodyParser.urlencoded({ extended: true }))
app.use(bodyParser.json())

/* =========================
   CONFIGURAÇÃO
========================= */

app.get("/configure", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Configurar Stalker IPTV</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
    </head>
    <body>
      <h2>Configurar Stalker IPTV</h2>

      <form method="GET" action="/manifest.json">
        <label>Portal URL:</label><br>
        <input name="portal" required><br><br>

        <label>MAC Address:</label><br>
        <input name="mac" required><br><br>

        <button type="submit">Guardar e Instalar</button>
      </form>
    </body>
    </html>
  `)
})

app.post("/configure", (req, res) => {
  const { portal, mac } = req.body

  const config = {
    portal,
    mac
  }

  const encoded = Buffer
    .from(JSON.stringify(config))
    .toString("base64")

  const baseUrl = `${req.protocol}://${req.get("host")}`

  const manifestUrl =
    `${baseUrl}/manifest.json?config=${encoded}`

  res.redirect(
    `stremio://addon/${encodeURIComponent(manifestUrl)}`
  )
})

/* =========================
   MANIFEST
========================= */

app.get("/manifest.json", (req, res) => {
  const { portal, mac } = req.query

  // Manifest BASE (sem configuração)
  const manifest = {
    id: "org.xulovski.stremio.stalker",
    version: "1.0.0",
    name: "Stalker IPTV (Multi-Portal)",
    description: "Addon Stremio para Stalker IPTV",
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
      configurationRequired: true
    }
  }

  // 👉 Se AINDA NÃO houver config
  if (!portal || !mac) {
    return res.json(manifest)
  }

  // 👉 Se JÁ houver config (depois do Guardar e Instalar)
  return res.json({
    ...manifest,
    description: `Portal: ${portal}`,
    behaviorHints: {
      configurable: true,
      configurationRequired: false
    }
  })
})

/* =========================
   CATALOG (OBRIGATÓRIO)
========================= */

app.get("/catalog/tv/stalker_tv.json", (req, res) => {
  res.json({
    metas: [
      {
        id: "stalker:test",
        type: "tv",
        name: "Stalker IPTV",
        poster: "https://via.placeholder.com/300x450",
        description: "Portal Stalker configurado"
      }
    ]
  })
})

/* =========================
   STREAM (OBRIGATÓRIO)
========================= */

app.get("/stream/tv/:id.json", (req, res) => {
  res.json({
    streams: []
  })
})

/* =========================
   START
========================= */

app.listen(PORT, () => {
  console.log("Servidor ativo na porta", PORT)
})

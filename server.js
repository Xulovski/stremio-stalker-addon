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
      <meta charset="utf-8">
      <title>Configurar Stalker IPTV</title>
    </head>
    <body>
      <h2>Configurar Stalker IPTV</h2>

      <form method="POST" action="/configure">
        <label>Portal URL</label><br>
        <input name="portal" required><br><br>

        <label>MAC Address</label><br>
        <input name="mac" required><br><br>

        <button type="submit">Guardar e Instalar</button>
      </form>
    </body>
    </html>
  `)
})

app.post("/configure", (req, res) => {
  const { portal, mac } = req.body

  const config = Buffer
    .from(JSON.stringify({ portal, mac }))
    .toString("base64")

  const baseUrl = `${req.protocol}://${req.get("host")}`

  res.redirect(
    `stremio://${baseUrl}/manifest.json?config=${config}`
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
    description: "Addon Stremio para portais Stalker",
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

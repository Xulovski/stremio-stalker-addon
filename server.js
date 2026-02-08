import express from "express"
import cors from "cors"

const app = express()
const PORT = process.env.PORT || 7000

app.use(cors())
app.use(express.urlencoded({ extended: true }))
app.use(express.json())

/**
 * Página de configuração (abre no browser e no Stremio)
 */
app.get("/configure", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Configurar Stalker IPTV</title>
      </head>
      <body>
        <h2>Configurar Stalker IPTV</h2>

        <form method="POST" action="/configure">
          <label>Portal URL:</label><br/>
          <input type="text" name="portal" required /><br/><br/>

          <label>MAC Address:</label><br/>
          <input type="text" name="mac" required /><br/><br/>

          <button type="submit">Guardar e Instalar</button>
        </form>
      </body>
    </html>
  `)
})

/**
 * Recebe config e redireciona para o Stremio
 */
app.post("/configure", (req, res) => {
  const { portal, mac } = req.body

  if (!portal || !mac) {
    return res.status(400).send("Dados em falta")
  }

  const config = { portal, mac }
  const encoded = Buffer.from(JSON.stringify(config)).toString("base64")

  const baseUrl = `${req.protocol}://${req.get("host")}`
  const redirectUrl = `stremio://${baseUrl}/manifest.json?config=${encoded}`

  res.redirect(302, redirectUrl)
})

/**
 * Manifest do addon
 */
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "org.xulovski.stremio.stalker",
    version: "1.0.0",
    name: "Stalker IPTV (Multi-Portal)",
    description: "Addon Stremio para portais Stalker",
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

app.listen(PORT, () => {
  console.log("✅ Servidor ativo na porta", PORT)
})

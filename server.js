import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 7000;

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const BASE_URL = "https://stremio-stalker-addon-1.onrender.com";

/* CONFIG PAGE */
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
  `);
});

/* HANDLE CONFIG */
app.post("/configure", (req, res) => {
  const { portal, mac } = req.body

  if (!portal || !mac) {
    return res.status(400).send("Dados em falta")
  }

  const config = {
    portals: [
      { portal, mac }
    ]
  }

  const encoded = Buffer
    .from(JSON.stringify(config))
    .toString("base64")

  const redirectUrl =
    `stremio://stremio-stalker-addon-1.onrender.com/manifest.json?config=${encoded}`

  res.redirect(302, redirectUrl)
})

/* MANIFEST */
app.get("/manifest.json", (req, res) => {
  res.json({
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
      configurationRequired: false
    }
  });
});

app.get("/catalog/:type/:id.json", async (req, res) => {
  try {
    if (!req.query.config) {
      return res.json({ metas: [] })
    }

    const config = JSON.parse(
      Buffer.from(req.query.config, "base64").toString()
    )

    // para já usamos só o primeiro portal
    const { portal, mac } = config.portals[0]

    console.log("CATALOG →", portal, mac)

    // ⚠️ TESTE (canal fake)
    res.json({
      metas: [
        {
          id: "stalker:test",
          type: "tv",
          name: "Canal Teste",
          poster: "https://via.placeholder.com/300x450.png?text=Stalker",
          background: "https://via.placeholder.com/1280x720.png?text=Stalker"
        }
      ]
    })

  } catch (err) {
    console.error("CATALOG ERROR:", err)
    res.status(500).json({ metas: [] })
  }
})

app.listen(PORT, () => {
  console.log("Servidor ativo na porta", PORT)
})


function normalizeStalkerUrl(input) {
  let url = input.trim()

  // remove barras finais
  url = url.replace(/\/+$/, "")

  if (url.includes("load.php")) {
    return url
  }

  if (url.includes("portal.php")) {
    return url
  }

  if (url.endsWith("/c")) {
    return url.replace(/\/c$/, "") + "/stalker_portal/server/load.php"
  }

  return url + "/stalker_portal/server/load.php"
}

import axios from "axios"

async function stalkerHandshake(baseUrl, mac) {
  const res = await axios.get(baseUrl, {
    params: { type: "stb", action: "handshake", token: "" },
    headers: {
      "User-Agent": "Mozilla/5.0",
      "X-User-Agent": "Model: MAG250; Link: WiFi",
      "Authorization": `Bearer ${mac}`
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

  return res.data.js.data
}

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

app.get("/catalog/tv/stalker_tv.json", async (req, res) => {
  try {
    const { portal, mac } = req.query
    if (!portal || !mac) {
      return res.json({ metas: [] })
    }

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
  } catch (err) {
    console.error(err.message)
    res.json({ metas: [] })
  }
})

import axios from "axios"

app.get("/stream/:type/:id.json", async (req, res) => {
  try {
    const { portal, mac } = req.query
    const channelId = req.params.id.replace("stalker:", "")

    if (!portal || !mac) {
      return res.json({ streams: [] })
    }

    const base = portal.replace(/\/$/, "")

    // 1️⃣ Handshake
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

    // 2️⃣ Create link
    const create = await axios.get(
      `${base}/portal.php?action=create_link&type=itv&cmd=ffmpeg http://localhost/ch/${channelId}&JsHttpRequest=1-xml`,
      {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Cookie": cookie
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

const PORT = process.env.PORT || 3000

app.listen(PORT, "0.0.0.0", () => {
  console.log("Servidor ativo na porta", PORT)
})


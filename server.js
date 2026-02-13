import express from "express"
import cors from "cors"
import axios from "axios"

const app = express()
app.use(cors())
app.use(express.json())

// 🔴 PORTA — APENAS UMA VEZ
const PORT = process.env.PORT || 3000

// ================= MANIFEST =================
const manifest = {
  id: "org.stremio.stalker",
  version: "1.0.0",
  name: "Stalker IPTV (MAG)",
  description: "Addon Stremio para Stalker IPTV via MAC",
  resources: ["catalog", "stream"],
  types: ["tv"],
  catalogs: [
    {
      type: "tv",
      id: "stalker-tv",
      name: "Canais IPTV"
    }
  ],
  behaviorHints: {
    configurable: true
  }
}

app.get("/manifest.json", (req, res) => {
  res.json(manifest)
})

// ================= CATALOG =================
app.get("/catalog/tv/stalker-tv.json", async (req, res) => {
  const { portal, mac } = req.query

  if (!portal || !mac) {
    return res.json({ metas: [] })
  }

  try {
    const url = `${portal}/portal.php?type=itv&action=get_all_channels`
    const headers = {
      Cookie: `mac=${mac}; stb_lang=en; timezone=UTC`,
      "User-Agent": "Mozilla/5.0 (MAG200)"
    }

    const response = await axios.get(url, { headers })

    const channels = response.data.js.data.map(ch => ({
      id: `stalker_${ch.id}`,
      type: "tv",
      name: ch.name,
      poster: ch.logo || null
    }))

    res.json({ metas: channels })
  } catch (e) {
    console.error("CATALOG ERROR:", e.message)
    res.json({ metas: [] })
  }
})

// ================= STREAM =================
app.get("/stream/tv/:id.json", async (req, res) => {
  const { portal, mac } = req.query
  const channelId = req.params.id.replace("stalker_", "")

  try {
    const url = `${portal}/portal.php?type=itv&action=create_link&cmd=ffmpeg%20http://localhost/ch/${channelId}`
    const headers = {
      Cookie: `mac=${mac}; stb_lang=en; timezone=UTC`,
      "User-Agent": "Mozilla/5.0 (MAG200)"
    }

    const response = await axios.get(url, { headers })

    res.json({
      streams: [
        {
          url: response.data.js.cmd.replace("ffmpeg ", ""),
          title: "Stalker IPTV"
        }
      ]
    })
  } catch (e) {
    console.error("STREAM ERROR:", e.message)
    res.json({ streams: [] })
  }
})

// ================= START =================
app.listen(PORT, () => {
  console.log("Addon Stremio ativo na porta", PORT)
})

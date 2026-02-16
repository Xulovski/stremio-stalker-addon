import express from "express"
import cors from "cors"
import axios from "axios"

const app = express()

// IMPORTANTE PARA RENDER
const PORT = process.env.PORT || 3000

const ADDON_ID = "org.xulovski.stremio.stalker"
const ADDON_NAME = "Stalker IPTV Multi-Portal"

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

/* ================= HELPERS ================= */

function decodeConfig(req) {
  if (!req.query.config) return null
  try {
    return JSON.parse(
      Buffer.from(req.query.config, "base64").toString("utf8")
    )
  } catch {
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
  try {
    const portals = Array.isArray(req.body.portal)
      ? req.body.portal
      : [req.body.portal]

    const macs = Array.isArray(req.body.mac)
      ? req.body.mac
      : [req.body.mac]

    const config = {
      portals: portals.map((p, i) => ({
        portal: normalizePortal(p),
        mac: macs[i]
      }))
    }

    const encoded = Buffer.from(
      JSON.stringify(config)
    ).toString("base64")

    res.redirect(
      `stremio://${req.headers.host}/manifest.json?config=${encoded}`
    )
  } catch (err) {
    res.status(500).send("Erro ao salvar configuração")
  }
})

/* ================= MANIFEST ================= */

app.get("/manifest.json", (req, res) => {
  const config = decodeConfig(req);

  const manifest = {
    id: ADDON_ID,
    version: "1.0.1",  // incrementa para forçar refresh no Stremio
    name: ADDON_NAME,
    description: "Addon Stalker IPTV com múltiplos portais - Debug Stream",
    types: ["tv"],
    catalogs: config
      ? config.portals.map((_, i) => ({
          type: "tv",
          id: `stalker_${i}`,
          name: `Servidor ${i + 1}`
        }))
      : [],
    resources: [
      "catalog",
      {
        name: "stream",
        types: ["tv"],
        idPrefixes: ["stalker:"]  // ← chave: força Stremio a chamar /stream para IDs que começam com "stalker:"
      }
    ],
    idPrefixes: ["stalker:"],  // global, ajuda em algumas plataformas
    behaviorHints: {
      configurable: true,
      configurationRequired: !config,
      adult: false  // opcional, mas alguns addons tv precisam
    }
  };

  res.json(manifest);
});

/* ================= CATALOG ================= */

app.get("/catalog/tv/:id.json", async (req, res) => {
  try {
    const config = decodeConfig(req)
    if (!config) return res.json({ metas: [] })

    const index = Number(req.params.id.replace("stalker_", ""))
    const { portal, mac } = config.portals[index]

    const handshake = await axios.get(`${portal}/portal.php`, {
      params: {
        action: "handshake",
        type: "stb",
        JsHttpRequest: "1-xml"
      },
      headers: {
        "User-Agent": "Mozilla/5.0",
        "X-User-Agent": "Model: MAG250; Link: WiFi",
        Cookie: `mac=${mac}`
      }
    })

    const token = handshake.data?.js?.token

    if (!token) return res.json({ metas: [] })

    const channelsRes = await axios.get(`${portal}/portal.php`, {
      params: {
        action: "get_all_channels",
        type: "itv",
        JsHttpRequest: "1-xml"
      },
      headers: {
        Authorization: `Bearer ${token}`,
        "X-User-Agent": "Model: MAG250; Link: WiFi",
        Cookie: `mac=${mac}`
      }
    })

    const channels = channelsRes.data?.js?.data || []

    // Aqui está a mudança para debug:
    const metas = [{
      id: "stalker:0:debug_teste_stream",  // sem ${index} se quiseres simplificar ainda mais
      type: "tv",
      name: "** DEBUG TESTE STREAM - Clique aqui **",
      description: "Teste para ver se /stream é chamado (logs no Render)"
}];
    }];

    // Se quiseres manter os canais reais + o de teste, usa:
    // const metas = channels.map(ch => ({
    //   id: `stalker:${index}:TESTE_CANAL_123`,  // força fixo para debug
    //   type: "tv",
    //   name: ch.name || "Canal sem nome",
    //   poster: ch.logo || null
    // }));

    res.json({ metas })
  } catch (e) {
    console.error("CATALOG ERROR:", e.message)
    res.json({ metas: [] })
  }
})

/* ================= STREAM ================= */

app.get("/stream/tv/:id.json", async (req, res) => {
  console.log("STREAM REQUEST:", req.params.id);

  try {
    const config = decodeConfig(req);
    if (!config || !config.portals || config.portals.length === 0) {
      console.log("[STREAM] Config inválida ou sem portais");
      return res.json({ streams: [] });
    }

    // Parsing robusto do ID: stalker:INDEX:resto_do_id
    const idParts = req.params.id.split(':');
    if (idParts[0] !== 'stalker' || idParts.length < 3) {
      console.log("[STREAM] Formato de ID inválido:", req.params.id);
      return res.json({ streams: [] });
    }

    const portalIndex = parseInt(idParts[1], 10);
    const channelId = idParts.slice(2).join(':'); // permite : , espaços, etc. no nome/ID do canal

    if (isNaN(portalIndex) || portalIndex < 0 || portalIndex >= config.portals.length) {
      console.log("[STREAM] Índice de portal inválido:", portalIndex, "Total portais:", config.portals.length);
      return res.json({ streams: [] });
    }

    const { portal, mac } = config.portals[portalIndex];
    console.log(`[STREAM] Portal selecionado: ${portalIndex} → ${portal}`);
    console.log(`[STREAM] Canal solicitado: ${channelId}`);

    // Handshake
    const handshake = await axios.get(`${portal}/portal.php`, {
      params: {
        action: "handshake",
        type: "stb",
        JsHttpRequest: "1-xml"
      },
      headers: {
        "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3",
        "X-User-Agent": "Model: MAG250; Link: WiFi",
        Cookie: `mac=${mac}`
      },
      timeout: 15000
    });

    const token = handshake.data?.js?.token;
    if (!token) {
      console.log("[STREAM] Handshake falhou - sem token");
      return res.json({ streams: [] });
    }

    console.log("[STREAM] Token obtido com sucesso");

    // Create link - com cmd mais comum em portais modernos
    const create = await axios.get(`${portal}/portal.php`, {
      params: {
        action: "create_link",
        type: "itv",
        cmd: `/ch/${channelId}_`,  // underscore final funciona na maioria
        JsHttpRequest: "1-xml"
      },
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3",
        "X-User-Agent": "Model: MAG250; Link: WiFi",
        Cookie: `mac=${mac}`,
        Referer: `${portal}/c/`,
        Origin: portal
      },
      timeout: 20000
    });

    // Logs completos para debug
    console.log("=== CREATE_LINK REQUEST ===");
    console.log("URL:", `\( {portal}/portal.php?action=create_link&type=itv&cmd=/ch/ \){channelId}_`);
    console.log("=== CREATE_LINK RESPONSE STATUS ===", create.status);
    console.log("=== CREATE_LINK FULL DATA ===", JSON.stringify(create.data, null, 2));

    // Tentativas de extrair o URL de várias chaves possíveis
    let raw = null;
    if (create.data?.js) {
      raw =
        create.data.js.cmd ||
        create.data.js.link ||
        create.data.js.url ||
        create.data.js.streamer ||
        create.data.js.stream ||
        create.data.js.play_url ||
        (typeof create.data.js === 'string' ? create.data.js : null);
    }

    console.log("=== VALOR RAW EXTRAÍDO ===", raw);

    let streamUrl = null;
    if (typeof raw === 'string' && raw.trim()) {
      streamUrl = raw
        .trim()
        .replace(/^ffmpeg\s*/i, '')           // remove "ffmpeg " ou "ffmpeg http..."
        .replace(/\s*\|.*$/g, '')             // remove pipe ffmpeg no final
        .replace(/\s+$/, '');                 // limpa espaços finais

      // Se for relativo (ex: /udp/..., /live/...) → junta o portal base
      if (streamUrl && !streamUrl.match(/^https?:\/\//i)) {
        streamUrl = portal.replace(/\/+$/, '') + '/' + streamUrl.replace(/^\/+/, '');
      }

      // Preserva query string se existir
      if (raw.includes('?') && !streamUrl.includes('?')) {
        const queryPart = raw.split('?')[1];
        streamUrl += '?' + queryPart;
      }
    }

    console.log("=== STREAM URL FINAL TENTADA ===", streamUrl);

    if (streamUrl && streamUrl.startsWith('http')) {
      console.log("[SUCCESS] Enviando stream válido:", streamUrl);
      return res.json({
        streams: [{
          name: "Stalker IPTV",
          title: channelId,
          url: streamUrl,
          behaviorHints: {
            notWebReady: false,
            bingeWatcher: false
          }
        }]
      });
    } else {
      console.log("[FALHA] Nenhum URL de stream válido encontrado");
      return res.json({ streams: [] });
    }

  } catch (e) {
    console.error("STREAM ERROR:", e.message);
    console.error("STACK:", e.stack);
    return res.json({ streams: [] });
  }
});

/* ================= START ================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log("Addon Stremio ativo na porta", PORT)
})

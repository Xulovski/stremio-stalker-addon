import axios from "axios";

async function test() {
  const portal = "http://dragon1.sbs/c";
  const mac = "00:1A:79:B4:F6:D2";

  const baseUrl = portal.replace(/\/c$/, "") + "/stalker_portal/server/load.php";

  const handshake = await axios.get(baseUrl, {
    params: { type: "stb", action: "handshake", token: "" },
    headers: {
      "User-Agent": "Mozilla/5.0",
      "X-User-Agent": "Model: MAG250; Link: WiFi",
      "Cookie": `mac=${mac}; stb_lang=en; timezone=GMT`
    }
  });

  console.log("TOKEN:", handshake.data.js.token);

  const token = handshake.data.js.token;

  const channels = await axios.get(baseUrl, {
    params: { type: "itv", action: "get_all_channels" },
    headers: {
      "Authorization": `Bearer ${token}`,
      "X-User-Agent": "Model: MAG250; Link: WiFi"
    }
  });

  console.log("CHANNELS:", channels.data.js.data);
}

test();

# Neemo Local Gateway

This small companion keeps the published Neemo website connected to Hubs on the same local network as this computer. The browser cannot listen to raw MQTT traffic itself, so this companion includes the local Hub network and forwards authenticated events to Neemo over HTTPS.

If the website is temporarily unreachable, the Gateway keeps up to 10,000 events for 15 minutes and retries with increasing delays. Original Hub observation times are preserved.

## Mac setup

1. In the Neemo website, open **Hubs**, choose **Find Hubs**, and create a setup code.
2. Download and unzip the Neemo connection.
3. Double-click `Start Neemo on Mac.command`. If macOS blocks it, Control-click it and choose **Open**.
4. Paste the one-time setup code when asked.
5. Neemo starts its built-in broker, saves the local network address in `HUB ADDRESS.txt`, and copies the address to the Mac clipboard.
6. Put that address in the Hub firmware’s `MQTT_HOST`, keep port `1883`, flash the Hub, and keep the Neemo window open.

No separate Node.js, Homebrew, or Mosquitto setup is required. If a compatible Node.js is unavailable, the launcher downloads an official, checksum-verified private runtime inside this folder. The Gateway’s built-in MQTT broker listens on port `1883`, subscribes to `rfid-hub/#`, and stores its private Neemo token in `.neemo-gateway.json` with owner-only file permissions.

The built-in broker listens on every network interface. Hubs must use the computer’s local network address (for example, `192.168.1.25`), not `127.0.0.1`. If automatic address detection chooses the wrong adapter, set `MQTT_ADVERTISED_HOST` before starting.

## Windows setup

1. Create a setup code in Neemo.
2. Right-click `Start Neemo on Windows.ps1` and choose **Run with PowerShell**.
3. Paste the code and keep the window open.

The Windows launcher also prepares a private official Node.js runtime if necessary. No separate Mosquitto installation is required.

## Hub network

- Broker port: `1883`
- Subscription: `rfid-hub/#`
- Hub heartbeat: `rfid-hub/<MAC>/status/hello` with `hello world`
- Tag readings: `rfid-hub/<MAC>/rfid/tag` with `EPC[,EPC...],POWER_LEVEL`
- `<MAC>` is 12 uppercase hexadecimal characters without colons.
- `POWER_LEVEL` is an integer from 0 through 30; lower means closer.

The current MVP’s built-in broker intentionally uses anonymous MQTT on a trusted local network so it stays compatible with the existing Hub firmware. Do not expose port `1883` to the public internet. The Gateway-to-Neemo connection remains protected by HTTPS and a revocable Gateway token.

## Configuration

Use `.env.example` as a list of optional settings if you need a custom broker or website address, then set those variables in your terminal before starting. No broker password is required for the current firmware contract. Never put Gateway tokens or future broker passwords in the website source code.

To reset this computer’s connection, disconnect the Gateway in Neemo and delete `.neemo-gateway.json`. Then create a fresh setup code.

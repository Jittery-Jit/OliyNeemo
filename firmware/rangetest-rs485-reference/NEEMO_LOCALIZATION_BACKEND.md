# Neemo localization backend contract

The Neemo backend locates a tag from the same inventory observations reported by multiple measured Hubs. No localization calculation needs to run on either board.

There are two supported real-data paths.

## Direct Hub upload

For each active scan, a network-connected Hub may send one or more readings to:

```text
POST /api/device/readings
Authorization: Bearer <Hub device token>
Content-Type: application/json
```

```json
{
	"scanId": "scan UUID from /api/device/commands",
	"readings": [
		{
			"epc": "normalized EPC from the reader inventory record",
			"rssi": -52.4,
			"antenna": 1,
			"frequency": 915000,
			"readCount": 8
		}
	]
}
```

The supplied `rangetest-rs485.ino` transport remains compatible:

- reader UART stays at 57,600 baud;
- command `0x01` remains the inventory command;
- the existing CRC-16 calculation and RS485 direction handling do not change;
- BLE provisioning UUIDs and the plain-text Wi-Fi credential format do not change.

## BLE tag-reader bridge

The implemented app also consumes the separate RFID telemetry service:

- service `ad4c743b-87d7-4031-8e10-e0aa7c580011`;
- notify characteristic `32855659-f1b4-41c0-a882-5f9b40ccf0d3`;
- command characteristic `0e1fc589-868f-4e77-930c-b470f64a08c1`.

After subscribing, Neemo writes the plain ASCII command `APP` and waits for `#APP ON`. During a scan, it accepts `<EPC>,<powerLevel>` notifications, parses the power level after the last comma, expands multi-EPC messages, and associates every reading with the specific Hub connection that delivered it. The signed-in app submits those readings to `/api/scans/readings` and closes that Hub's scan job through `/api/scans/complete`.

`powerLevel` is the real 0–30 reader value, not calibrated distance or dBm. Neemo negates it only to preserve the existing relative-signal convention: level 0 is strongest and level 30 is weakest. No sample EPCs or guessed signal values are inserted.

The server converts signal differences into relative distance ratios, combines them with the measured Hub coordinates and room dimensions, rejects strong reflection outliers, averages repeated signal samples inside that specific scan, and returns a bounded position plus an uncertainty radius. Three non-collinear Hubs are the mathematical minimum for a 2D result; four or more distributed around the room are strongly preferred.

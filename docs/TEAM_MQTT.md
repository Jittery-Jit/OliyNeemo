# Team MQTT scanner contract

## Resolve the Team ID

The firmware can exchange the same eight-character invite code used by people joining a team:

```http
POST https://neemo.jt-mx-lin.workers.dev/api/scanners/team-id
Content-Type: application/json

{"inviteCode":"ABCDEFGH"}
```

Successful response:

```json
{ "teamId": "123e4567-e89b-42d3-a456-426614174000" }
```

The lookup does not create a team membership. Store the returned Team ID in firmware configuration and use it in every MQTT topic. The route accepts invite codes without regard to letter case, is rate-limited, and never caches its response.

The Team ID is also shown under **Hubs → Connect cloud scanner**.

## MQTT connection

```text
Broker: mqtt://neemo.xy.icu:2883
QoS: 1
Retain: true
HUB_ID: 12 uppercase MAC hex characters without separators
```

Publish every 5 seconds:

```text
/neemo/<TEAM_ID>/<HUB_ID>/status/heartbeat
```

```json
{
	"eventType": "hub.heartbeat",
	"teamId": "<TEAM_ID>",
	"hubId": "5C013BBEDEBC",
	"seenAt": "2026-07-29T20:00:00.000Z"
}
```

Publish each observation:

```text
/neemo/<TEAM_ID>/<HUB_ID>/tags/<EPC>
```

```json
{
	"eventType": "tag.seen",
	"teamId": "<TEAM_ID>",
	"hubId": "5C013BBEDEBC",
	"tagId": "E20034120123456789ABC005",
	"seenAt": "2026-07-29T20:00:01.000Z",
	"sequence": 1,
	"signalRssi": -47,
	"readCount": 1
}
```

`seenAt` must be current ISO-8601 UTC. `sequence` should increase per Hub boot. If the reader exposes only power level, send integer `powerLevel` from 0–30 instead of `signalRssi`.

The prototype broker is public. Team ID provides routing, not authentication, and a signed-in Neemo page must remain open to persist incoming MQTT data.

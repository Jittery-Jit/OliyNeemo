# Neemo app compatibility

This folder is a direct copy of the supplied `rangetest-rs485.zip`. Neemo's iPhone and Android BLE clients were implemented against these files:

- `config.h` for every service and characteristic UUID
- `ble_service.h` and `ble_service.cpp` for advertising, state, device information, network information, and credential formats
- `wifi_scan.h` and `wifi_scan.cpp` for chunked scan-result bytes
- `hub_types.h` for state, error, and Wi-Fi security numeric values
- `rangetest-rs485.ino` for the RS485 pins, 57,600-baud reader link, inventory command, and CRC format

The Chrome website writes the original credential message unchanged:

```text
SSID bytes | 0x00 | password bytes
```

After the Hub reports `ONLINE`, the website uses the Hub's device information and a one-time setup code to create the shared team record through Neemo's backend. The setup code and backend URL are not sent to this firmware.

The native phone clients may append:

```text
0x00 | one-time Neemo setup code | 0x00 | Neemo backend URL
```

The supplied `handleCredentialsWrite` copies at most 64 password bytes into a zero-filled buffer and constructs the password `String` at the first null byte. Therefore it ignores the appended fields and remains wire-compatible without modification. The phone uses the appended values itself after the Hub reports `ONLINE`.

This is intentionally plain-text BLE pairing, per the latest product decision. No proof-of-possession or encrypted provisioning protocol is expected by the Chrome or phone clients.

The Chrome implementation also uses the archive's reset characteristic `0ae5af30-e919-4b0a-ba0b-3ae2e1e26ab3`, automatically reconnects the previously approved device if BLE drops during the firmware's 60-second resume window, and reads the real `state` value before displaying the selected Hub.

Web Bluetooth deliberately differs from the mobile-app PRD in two places:

- Chrome's secure chooser reveals only the one Hub the user selects, so the website cannot display or signal-sort all nearby Hubs at once.
- The supplied firmware has no local HTTP health endpoint, and an HTTPS website cannot reliably probe an unencrypted local-IP endpoint. The website therefore treats the firmware's `ONLINE` state plus readable `network_info` as the reachability confirmation.

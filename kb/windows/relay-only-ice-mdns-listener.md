---
tech: windows
tags: [webrtc, pion, ice, turn, mdns, firewall, attended-support]
severity: high
---
# Relay-only ICE can still open an mDNS listener

## PROBLEM

A disposable Windows support executable has a new path for each invitation.
Direct ICE gathering and multicast DNS can open inbound sockets and trigger
Windows Firewall's network-access dialog at startup. This dialog is not a UAC
elevation prompt. A later privileged host runs from another temporary path, so
approving the first executable is not a durable transport fix.

In Pion ICE v4, selecting relay candidates does not by itself disable mDNS.
The agent initializes mDNS separately from candidate gathering. Also, a TURN
URL without an explicit TCP transport normally uses a local UDP socket. Thus
"relay only" does not mean "no inbound listeners."

## WRONG

```go
config := webrtc.Configuration{
    ICETransportPolicy: webrtc.ICETransportPolicyRelay,
    ICEServers: []webrtc.ICEServer{{URLs: []string{"turn:relay.example"}}},
}
// The default SettingEngine still permits mDNS. This configuration also
// permits a UDP connection to TURN.
```

Do not suppress the symptom by disabling the firewall, adding broad executable
exceptions, changing UAC, or requiring the customer to approve every download.

## RIGHT

```go
settings := webrtc.SettingEngine{}
settings.SetICEMulticastDNSMode(ice.MulticastDNSModeDisabled)
config := webrtc.Configuration{
    ICETransportPolicy: webrtc.ICETransportPolicyRelay,
    ICEServers: []webrtc.ICEServer{{
        URLs: []string{"turn:relay.example:3478?transport=tcp"},
        Username: user, Credential: credential,
    }},
}
api := webrtc.NewAPI(webrtc.WithSettingEngine(settings))
pc, err := api.NewPeerConnection(config)
```

Parse the supplied URLs using the TURN/STUN URI parser. Retain authenticated
TURN-over-TCP and TURNS-over-TCP endpoints only; reject missing compatible
relays rather than falling back to direct gathering. Apply this to both the
ordinary attended connector and its privileged replacement.

Test real ICE gathering against a local TCP TURN server with a network adapter
that counts and refuses ListenPacket, ListenUDP and ListenTCP. Require an actual
relay candidate and zero listener calls. A test asserting only the configured
ICE policy misses the mDNS failure.

## NOTES

Observed during SupportForge Windows attended acceptance on September 28, 2026.
Pion ICE v4.4.2 initializes multicast DNS in agent.go independently of relay
candidate selection; gather.go dials TCP TURN but listens for UDP TURN. The
regression test proves outbound gathering without local listeners. Actual
Windows UI acceptance remains a separate release check.

This trades direct peer paths for relay availability and bandwidth. Keep the
change scoped to disposable attended hosts when managed-agent transports still
need direct connections.

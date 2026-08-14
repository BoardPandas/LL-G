---
tech: windows
tags: [network-adapters, ndis, getiftable2, mib-if-row2, wmi, win32-networkadapter, wifi-direct, bluetooth-pan, telemetry, metric-cardinality]
severity: high
---
# The NDIS HardwareInterface flag is not a physical-adapter test

## PROBLEM
`GetIfTable2` looks like the cheap native answer to "which of these interfaces are
real NICs", because `MIB_IF_ROW2.InterfaceAndOperStatusFlags` has a bit literally
named `HardwareInterface`. It is not that answer, and it is wrong in **both**
directions:

- **Kept, but virtual.** "Microsoft Wi-Fi Direct Virtual Adapter" entries are
  virtual miniports over the same radio, and they set `HardwareInterface`. The
  flag means *an NDIS miniport is bound*, which virtual miniports satisfy.
- **Dropped, but real.** The Bluetooth PAN adapter ("Bluetooth Network
  Connection") does **not** set it — while Windows lists it under Network
  Connections and WMI calls it physical.

The failure is silent. Nothing errors; you just get phantom interfaces and a
missing real one, and both look plausible in a UI. On one desktop showing three
adapters in Network Connections, raw IP-stack enumeration produced **44 metric
series**; a `HardwareInterface`-only filter cut that to 6 — still four Wi-Fi
Direct phantoms kept and the Bluetooth adapter lost. Because interface names
become metric dimensions, a wrong filter is unbounded series cardinality in the
database rather than an obviously broken field.

The authoritative signal is WMI's `Win32_NetworkAdapter.PhysicalAdapter`.

Two traps on the way to that conclusion:

- **Names don't work.** They are localised, vendor-specific and change between
  driver versions, so a `-QoS Packet Scheduler-0000` suffix match works on your
  machine and quietly stops working on the next.
- **The locally-administered MAC bit doesn't work either.** It is tempting,
  because Wi-Fi Direct adapters derive their MAC from the radio's with that bit
  set (`d8:…` → `1a:…`, `0a:…`, `fa:…`). But Windows Wi-Fi MAC randomization sets
  the same bit on the **real** radio, so this drops genuine adapters on any
  machine using random hardware addresses.

One flag *is* still needed: `FilterInterface` (bit 1). NDIS filter modules —
QoS Packet Scheduler, WFP MAC Layer LightWeight Filter, Native WiFi Filter Driver
— appear as their own interfaces carrying their parent's byte counters, **and
report their parent's MAC**, so no MAC-based check can separate them. Check that
bit before anything else.

## WRONG
```go
const (
	ifFlagHardwareInterface = 1 << 0
	ifFlagFilterInterface   = 1 << 1
)

// Looks authoritative, silently keeps Wi-Fi Direct virtual adapters and
// silently drops the Bluetooth PAN adapter.
func isPhysicalInterface(row *mibIfRow2) bool {
	flags := row.interfaceAndOperStatusFlags
	return flags&ifFlagHardwareInterface != 0 && flags&ifFlagFilterInterface == 0
}
```

## RIGHT
```go
// Ask WMI once (it is the only source that answers correctly), cache the answer,
// and join to it on MAC — the one identifier both sources report.
//
//   Get-CimInstance Win32_NetworkAdapter |
//     Where-Object { $_.MACAddress } |
//     Select-Object MACAddress, @{n='physical';e={[bool]$_.PhysicalAdapter}}

func (s *sampler) keepInterface(row *mibIfRow2) bool {
	// Filter modules first: they report their PARENT's MAC, so the join below
	// would keep them. This is the one thing the flags answer correctly.
	if row.interfaceAndOperStatusFlags&ifFlagFilterInterface != 0 {
		return false
	}

	physical, known := s.physicalAdapters()
	if !known {
		// Nobody has asked WMI yet. Fall back to the broad answer rather than
		// dropping everything — too many series beats none.
		return row.interfaceAndOperStatusFlags&ifFlagHardwareInterface != 0
	}

	_, ok := physical[macOf(row)] // net.HardwareAddr.String() on BOTH sides
	return ok
}
```

## NOTES
- **Format the MAC identically on both sides.** These are compared as strings; a
  case or separator mismatch makes every adapter look unknown and silently drops
  the filter to its fallback. Use one formatter (in Go, `net.HardwareAddr.String()`)
  for the WMI value and the `MIB_IF_ROW2.PhysicalAddress` bytes alike.
- **"No physical adapters" and "nobody has asked yet" must be distinct states.**
  In most languages an empty set and an unpopulated one are the same value, and
  here they are opposites: the first legitimately keeps nothing, the second must
  fall back. Adopting an empty WMI result — which is what a failed query returns —
  drops every network series on the device, and a device charting nothing looks
  exactly like a quiet one.
- **A partial hardware enumeration must not become the filter.** If your
  collector truncates at a ceiling, do not publish that list as authoritative;
  absence from a sample is not evidence the adapter is virtual.
- **Beware tests that pin the assumption instead of the behaviour.** A unit test
  asserting `HardwareInterface == physical` against a hand-built struct passes
  forever and proves nothing. This was caught only by running against a real
  endpoint and comparing to what Network Connections showed.
- Related: reading `MIB_IF_ROW2` from `GetIfTable2` requires declaring the struct
  **in full**, not a prefix up to the fields you use — the array stride is
  `sizeof(MIB_IF_ROW2)`, and a short struct reads each row's `Alias` out of the
  previous row's `Description`, yielding garbage interface names.

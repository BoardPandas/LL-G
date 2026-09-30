---
tech: supportforge
tags: [desktop-agent, enrollment, install-hint, msi, device-token, agent-auth, enforcement, identity, fail-closed, go]
severity: high
---
# An install hint written into the identity field skips enrollment and strands the device

## PROBLEM

The generic Windows MSI takes `ORG=org_<id>` as an "exact bind" hint. The agent
copied it straight into `ClientID`. Enrollment runs only while `ClientID` is empty,
so it never ran: the agent generated `AgentID = <clientId>-agent-<hostname>`, saved
that identity to config.json and the registry backup, and heartbeated with no device
token and no certificate. The server had never registered the device.

With agent auth enforced (`AGENT_GUARD_MODE=enforce`, `AGENT_COMMAND_AUTH_MODE=enforce`)
every heartbeat and command-token request is 401 "Agent authentication required",
permanently. The enrollment retry loop did not help, because `Enrolled()` checked only
`ClientID && AgentID` and read true. Nothing on the device looks wrong: the service
runs, config.json has a plausible identity, and the log shows ordinary 401s.

The device also cannot be fixed by shipping a fixed agent. Updates are delivered in
the heartbeat response, and its heartbeats are refused, so it never learns an update
exists. Recovery needs a manual reinstall.

Two newer paths had the same flaw: discarding an install code "because the device is
already enrolled", and `supportforge-service -enroll` refusing for the same reason.
Both asked `Enrolled()`, so both stranded the devices they were meant to recover.

## WRONG

```go
// Install hint becomes the identity.
if strings.HasPrefix(strings.ToLower(org), "org_") && c.ClientID == "" {
	c.ClientID = org
}

// Enrollment only when there is no identity at all.
if cfg.ClientID == "" && cfg.EnrollKey != "" {
	cfg.enroll()
}

// "Enrolled" means the fields are filled in, not that the device can prove them.
func (c *AgentConfig) Enrolled() bool { return c.ClientID != "" && c.AgentID != "" }
func (c *AgentConfig) CanEnroll() bool { return !c.Enrolled() && c.EnrollKey != "" }
```

## RIGHT

```go
// A hint is a destination the server must confirm, never an identity.
if strings.HasPrefix(strings.ToLower(org), "org_") && c.ExpectedClientID == "" {
	c.ExpectedClientID = org // sent as expectedClientId, omitempty
}

// Re-enroll decisions ask whether the identity can be proven.
func (c *AgentConfig) HasDeviceCredential() bool {
	if c.DeviceToken != "" {
		return true
	}
	id, err := devicecert.NewIdentityStore(DataDir()).Load()
	if err != nil {
		return true // unreadable is not absent; never re-enroll on a guess
	}
	return id.Enrolled() && !id.Expired(time.Now())
}

func (c *AgentConfig) CanEnroll() bool {
	return c.hasEnrollmentCredential() && (!c.Enrolled() || !c.HasDeviceCredential())
}

// Pin the attempt: the installer's target, else the identity already claimed.
// The server then confirms that client inside the key's MSP or refuses;
// fuzzy matching and the holding queue never get to move the device.
func (c *AgentConfig) enrollmentTarget() string {
	if c.ExpectedClientID != "" {
		return c.ExpectedClientID
	}
	return c.ClientID
}

// And refuse an answer naming a different client than the one asked for.
if target != "" && resp.ClientID != target {
	return fmt.Errorf("enrollment answered %q, not %q", resp.ClientID, target)
}
```

## NOTES

- Put the credential check in the service, not in `config.Load()`. The user-session
  GUIs (ticket window, technician console, consent, permissions) also call `Load()`,
  and `device-token.json` is ACL'd to SYSTEM and Administrators, so in a GUI a healthy
  device reads as tokenless. A `Load()`-level "no token, so enroll" rule would make
  every GUI launch re-enroll whenever an installer left a key behind.
- Keep "enrolled" (has identity fields) and "can authenticate" (token or unexpired
  certificate) as separate questions, and use the second one everywhere an install
  decides whether to leave a device alone: the retry loop, install-code discard, and
  any `-enroll` command.
- Send `expectedClientId` with `omitempty`. The server treats any present value as an
  exact bind and rejects `""` as invalid.
- The server's foreign-fingerprint guard and `IDENTITY_CONFLICT` check remain the
  arbiter; pinning the agent side is in addition to them, not instead. See
  [[installer-preserves-foreign-msp-identity]] for the opposite failure (a working
  foreign identity preserved when it should have been questioned).
- To find stranded devices: repeated 401s from one `agentId` with no `device_token`
  on any heartbeat row. They will not self-heal from an update; see the Go slice's
  "a transport cannot deliver its own rollback when it is unreachable".
- Workaround on older agents: pass the exact client name (`ORG="Client Name"`),
  which goes through enrollment as a match hint instead of becoming the identity.
- Found 2026-09-30 re-enrolling Admin-WS1 (BoardPandas/supportforge-platform #301).
  Fixed in agent 3.273.0.0 (hint becomes `ExpectedClientID`) and 3.273.1.0
  (credential-aware re-enrollment, pinning, answer check). 17 mutations of the new
  guards were each caught by a named test.

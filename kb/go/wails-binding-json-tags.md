---
tech: go
tags: [wails, webview, encoding-json, struct-tags, typescript, bindings, webrtc, ice, silent-data-loss]
severity: high
---
# A Wails binding serializes with encoding/json, so the webview sees struct tags -- not Go field names

## PROBLEM

A Wails v2 binding that returns a Go struct marshals it with `encoding/json`.
What arrives in the webview is therefore the **struct tags**, not the Go field
names. Write the TypeScript type from the Go source and every field reads
`undefined`.

That alone would be loud. What makes it silent is the code that almost always
sits immediately after a binding call: a `.filter()` or a `?? default` meant to
drop malformed entries. Fed `undefined`, it drops *every* entry, and the caller
receives a well-formed empty collection rather than an error. TypeScript cannot
help -- the hand-written binding type declares the wrong spelling as optional,
so reading it type-checks.

Seen live in a remote-desktop viewer. The Go side handed over
`[]remotecontrol.ICEServerConfig` (tags `urls`/`username`/`credential`); the TS
type declared `{URLs?, Username?, Credential?}`; the mapper read `server.URLs`,
the length filter discarded all of them, and every session built its
`RTCPeerConnection` with `iceServers: []`.

A PeerConnection with no STUN and no TURN is not obviously broken. It
negotiates, gathers host candidates, trickles them, and fails ~15 seconds later
as `connectionState === "failed"` -- **indistinguishable from a tenant that was
never configured with a relay**. It connects when both peers share a LAN, so it
reads as "certain machines are unreachable" and sends you to the customer's
firewall. It had been broken since the day the PeerConnection moved into the
webview, and nothing caught it, because a relay that was dropped and a relay
that was never configured produce identical logs.

The same shape applies to every binding: a dropped list element, a defaulted
number, a boolean silently false. `false` and "the field was spelled wrong" are
the same value.

## WRONG

```typescript
// Go: type ICEServerConfig struct {
//         URLs       []string `json:"urls"`
//         Username   string   `json:"username,omitempty"`
//         Credential string   `json:"credential,omitempty"`
//     }

// ...so this type is a lie, and an optional one, so it compiles.
export type IceServerConfig = { URLs?: string[]; Username?: string; Credential?: string };

const configured = await go.iceServers();       // [{urls: [...], username, credential}]
return configured
  .filter((s) => (s.URLs?.length ?? 0) > 0)     // s.URLs is undefined -> drops EVERY server
  .map((s) => ({
    urls: s.URLs as string[],                   // the cast silences the last warning
    username: s.Username || undefined,
    credential: s.Credential || undefined,
  }));
// -> [] , and new RTCPeerConnection({iceServers: []}) fails 15s later as `failed`
```

## RIGHT

```typescript
// Spelled from the struct TAGS, with the Go field names kept only as tolerated
// aliases -- this side cannot see how the generated binding serializes, and
// reading a shape that never arrives costs one `??`.
export type IceServerConfig = {
  urls?: string[];
  username?: string;
  credential?: string;
  /** @deprecated Go field-name spellings; tolerated, never produced. */
  URLs?: string[];
  Username?: string;
  Credential?: string;
};

export function toIceServers(configured: IceServerConfig[]): RTCIceServer[] {
  return configured
    .map((s) => ({
      urls: s.urls ?? s.URLs ?? [],
      username: s.username ?? s.Username ?? undefined,
      credential: s.credential ?? s.Credential ?? undefined,
    }))
    .filter((s) => s.urls.length > 0);
}
```

```typescript
// The assertion that matters is the COUNT, not the shape. A mapping that
// silently loses entries is the failure mode, and "some entries came through"
// reads as success right up until the one that would have connected is the one
// dropped.
it("keeps every configured relay", () => {
  const configured = [
    { urls: ["stun:a:3478"] },
    { urls: ["turn:b:3478"], username: "u", credential: "c" },
    { urls: ["turns:c:5349"], username: "u", credential: "c" },
  ];
  expect(toIceServers(configured)).toHaveLength(configured.length);
});
```

## NOTES

- **Before writing a TS type for any Wails binding, read the Go struct's json
  tags.** Never infer field names from Go. Bindings that Wails generates are
  correct; the hand-written ones beside them are where this happens.
- **Audit for the pattern, not the instance:** grep for capitalized property
  reads on binding results (`\.[A-Z][A-Za-z]*\b` on a value that came from a
  binding). Every one is either correct-by-tag or silently undefined.
- Mutation-test the guard. Revert the mapper to the Go spelling and confirm a
  *named* test fails; a test that passes either way proves nothing here, because
  the broken version returns a valid empty array.
- Applies to any Go→JS bridge that marshals with `encoding/json`, not just
  Wails -- the tag/field-name split is the language's, not the framework's.
- Related: `kb/nodejs/json-canonicalization-diverges-from-go.md` is the other
  half of this boundary -- there the field *names* agree and the encoded *bytes*
  differ. Both fail without an error.

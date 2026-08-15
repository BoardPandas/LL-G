---
tech: supportforge
tags: [policy, settings, dead-config, rmm, multi-tenant, silent-failure, ui]
severity: high
---
# A tenant setting that is declared, rendered, and read by nothing

## PROBLEM

The RMM policy compiler builds its editor UI from a registry: declare a key in
`src/rmm/policy/sections.ts` with a Zod schema, a label and a default, and it
appears in Settings → RMM → Rules with the right control, participates in
scope precedence, saves, versions, and shows in the effective-policy chain.

Every part of that works **without a single consumer reading the value**. There
is no compile error, no lint, no test — a customer sets the toggle, the UI
confirms it saved, the chain shows it resolving, and nothing anywhere acts on
it. The setting is a promise the product is not keeping, and it looks exactly
like a working feature from both sides of the screen.

Found live: the `access` section declared `serverConsent` (whether to prompt
before connecting to a *server*, as distinct from a workstation) from the day
the rules screen shipped. The first consumer written years later mapped
`desktopConsent` through and silently dropped `serverConsent`, so every
unattended session resolved to `silent` regardless of configuration. A tenant
that had explicitly asked to be prompted before anyone touched their servers
was never asked — while the setting displayed as enabled.

This is worse than an unimplemented feature, because the customer has made a
decision, recorded it, and been told it took effect.

## WRONG

```ts
// sections.ts declares both, and both render.
access: {
  keys: {
    desktopConsent: { schema: z.enum(['required','notify','silent']), defaultValue: 'required' },
    serverConsent:  { schema: z.enum(['required','notify','silent']), defaultValue: 'silent'   },
  },
}

// The consumer resolves one of them and quietly loses the other.
return {
  consentMode: enumOr(values.desktopConsent, MODES, 'required'),
  // serverConsent never read -- no error, no warning, setting is inert
};

function consentModeFor(policy, mode, rawServerConsent?: unknown) {
  if (mode === 'attended') return policy.consentMode;
  // optional arg the only caller never passes => always 'silent'
  return typeof rawServerConsent === 'string' ? rawServerConsent : 'silent';
}
```

## RIGHT

```ts
// Carry every declared key on the resolved type, so losing one is a type error
// rather than a silent drop.
return {
  desktopConsent: enumOr(values.desktopConsent, MODES, 'required'),
  serverConsent:  enumOr(values.serverConsent,  MODES, 'silent'),
};

// Read them off the policy. No optional argument a caller can forget to pass.
function consentModeFor(policy: SessionPolicy, mode: SessionMode): ConsentMode {
  if (mode === 'attended') {
    return policy.desktopConsent === 'silent' ? 'notify' : policy.desktopConsent;
  }
  return policy.serverConsent;
}
```

## NOTES

Before writing the first consumer of a policy section, grep every key in it and
confirm each has a reader. A key with no reader is either dead config to delete
or an unkept promise to implement — both are decisions worth making explicitly,
and neither should be discovered by a customer.

Two structural defences:

* **Never plumb a policy value through an optional function argument.** The
  only caller forgetting to pass it is invisible; a required field on the
  resolved policy type is not.
* **Add a test that iterates the section registry** and asserts each key has a
  consumer, or at minimum that the resolved policy type has a field per
  declared key. The compiler's own suite already iterates `POLICY_AREAS` for
  defaults and sources, so the shape exists to extend.

Related: adding keys to an existing section does **not** invalidate compiled
`rmm_effective_policies` rows, because `inputsDigestFor` hashes the layer
identities and not the document or its defaults. Bump
`POLICY_ENVELOPE_SCHEMA_VERSION` in the same change or the new key silently
never reaches a device — a second way for a live setting to do nothing.

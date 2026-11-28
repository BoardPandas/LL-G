---
tech: apple-configuration-profiles
tags: [mobileconfig, ios, macos, cms, signeddata, der, signing-certificate, renewal, passwords, rust, cms-crate, zeroize]
severity: medium
---
# Signed Apple configuration profiles: DER CMS SignedData with embedded content, the same signing identity is required to replace an installed profile, and passwords in the profile are readable

## PROBLEM
Facts about signed `.mobileconfig` files that are easy to get wrong when a server generates them:

1. **Format.** A signed profile is a **DER**-encoded CMS `SignedData` with the profile (the property list) **embedded** as its content. A detached signature, or PEM output, is not a signed profile.
2. **Replacement needs the same signing identity.** Apple requires an updated profile to be signed by the same identity as the installed one in order to replace it. A certificate renewal that changes the signing identity can therefore block replacement of profiles already installed.
3. **Signing is not encryption.** A signed, unencrypted profile is readable by anyone who obtains the file, so any password placed in it (a mail account password, a device credential) is in the clear.
4. **Rust `cms` crate.** Its `SignedData` builder copies the content into values that cannot be zeroized, and it reads the system clock for the signing time. Secret content therefore stays in memory after use, and the output is not reproducible under an injected clock.

## WRONG
```text
- Emit a detached or PEM signature next to the plist and call it a signed profile.
- Assume a profile signed after a certificate renewal can replace one signed before it.
- Put a long-lived account password in the profile because "it is signed".
- Assume secret bytes passed to the cms builder are wiped when your own buffer is.
```

## RIGHT
```text
- Produce DER CMS SignedData with the plist as encapsulated content.
- Plan for the signing identity before the first renewal: know whether renewal changes it,
  and test replacing an installed profile with one signed after a renewal.
- Put only a credential minted for that one device in the profile, revocable on its own,
  and treat the downloaded file as a secret.
- Keep the profile's secret content as short-lived as possible in memory; do not rely on
  zeroization of what the cms builder copied. Test signing time by parsing the output,
  not by expecting a fixed value.
```

## NOTES
- Check a generated profile by parsing it back (content type, embedded content, signer certificate) rather than by comparing bytes.

---
tech: rust
tags: [jsonwebtoken, jwt, es256, pkcs8, sec1, der, validation, exp, clock, testing]
severity: medium
---
# jsonwebtoken 12: EncodingKey::from_ec_der expects PKCS#8 despite its name, and Validation always reads the system clock

## PROBLEM
Two surprises in `jsonwebtoken` 12:

1. `EncodingKey::from_ec_der` takes the key as **PKCS#8** DER. The name suggests a bare EC private key in DER; that is not what it accepts.
2. `Validation` checks `exp` against the **system clock**. There is no way to hand it a clock, so a verifier built around an injected clock (for deterministic tests of expiry, or for a server-wide time source) is silently judged by wall time instead.

## WRONG
```rust
let key = EncodingKey::from_ec_der(sec1_der_bytes);        // not PKCS#8: the wrong input

let validation = Validation::new(Algorithm::ES256);        // exp compared with the system clock
let data = decode::<Claims>(token, &decoding_key, &validation)?;
```

## RIGHT
```rust
let key = EncodingKey::from_ec_der(pkcs8_der_bytes);       // PKCS#8 DER

let mut validation = Validation::new(Algorithm::ES256);
validation.validate_exp = false;                            // the library must not judge time
let data = decode::<Claims>(token, &decoding_key, &validation)?;
if data.claims.exp <= clock.now_unix() {                    // check exp yourself, with your clock
    return Err(TokenError::Expired);
}
```

## NOTES
- Once `validate_exp` is off, the `exp` check is entirely yours: make it impossible to skip (do it in the one function that returns verified claims), and apply the same treatment to `nbf` if you use it.
- Test with the injected clock on both sides of `exp`.

---
tech: typescript
tags: [money, validation, currency, bigint, forms, data-integrity]
severity: high
---
# Stripping characters from money input silently changes its value

## PROBLEM

Removing every character except digits and periods is not money validation. It turns `-100` into positive `100`, `abc` into an empty string that `Number` converts to zero, and `1e3` into `13`. Multiplying parsed floating-point values and rounding also accepts unsupported precision instead of explaining the error. A form can submit plausible but incorrect financial data without any API error.

## WRONG

```typescript
const amountCents = Math.round(Number(input.replace(/[^0-9.]/g, '')) * 100);
```

## RIGHT

```typescript
function parseMinorUnits(input: string, fractionDigits: number): number {
  // fractionDigits comes from the application's supported currency definition.
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 4) {
    throw new Error('Unsupported currency precision');
  }
  const value = input.trim();
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error('Enter a non-negative decimal amount');
  }
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > fractionDigits) {
    throw new Error(`Use at most ${fractionDigits} decimal places`);
  }
  const minor = BigInt(whole ?? '0') * 10n ** BigInt(fractionDigits)
    + BigInt(fraction.padEnd(fractionDigits, '0') || '0');
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Amount is too large');
  }
  return Number(minor);
}
```

## NOTES

- The example intentionally accepts non-negative plain decimals only. If negative amounts or localized grouping/currency symbols are allowed, define their full grammar explicitly. Never remove a sign or guess an ambiguous separator.
- Distinguish optional blank input from an explicit zero. Document the API's actual omitted-value default and make the form label agree with it.
- Use the same parser for inline errors and immediately before submission. Disable invalid submission, associate the error with the input, and validate again at the API boundary.
- Currency precision varies; do not multiply every currency by 100. Reject excess precision instead of silently rounding unless rounding is an explicit product rule.
- Keep the value as a decimal string until integer conversion. Use a string/BigInt API contract when values exceed JavaScript's safe integer range; BigInt cannot be directly JSON-serialized.
- Test `-100`, `abc`, `1e3`, excess fractional digits, unsafe integers, explicit zero, optional blank, and exact conversion of `0.29` to `29` for a two-digit currency. Include a zero-digit currency where supported.
- Related: [Number(null) silently coerces null/empty to 0](number-null-coercion.md).

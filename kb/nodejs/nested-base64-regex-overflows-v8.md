---
tech: nodejs
tags: [base64, regex, image-generation, validation, billing]
severity: high
---
# Nested base64 regex overflows V8 on multi-megabyte image payloads

## PROBLEM

An OpenAI image response can contain a 4K PNG as a multi-megabyte `b64_json` string. The conventional regex that repeats a four-character base64 group nests repetition. V8 can exhaust its regexp stack while validating an otherwise valid response, after the provider has completed and billed the image request. The resulting `RangeError: Maximum call stack size exceeded` looks like a decode or provider failure and hides the completed charge unless usage is recorded before output validation.

## WRONG

```ts
const validBase64 = (value: string) =>
	/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);

const image = Buffer.from(response.data[0].b64_json, "base64");
recordPaidSpend("image", estimatedCost);
```

## RIGHT

```ts
function validBase64(value: string): boolean {
	if (value.length === 0 || value.length % 4 !== 0) return false;
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
	return Buffer.from(value, "base64").toString("base64") === value;
}

recordPaidSpend("image", estimatedCost);
const encoded = response.data[0].b64_json;
if (!validBase64(encoded)) throw new Error("Image response contains invalid base64.");
const image = Buffer.from(encoded, "base64");
```

## NOTES

Record completed-call usage at the provider transport boundary, before validating image count, base64, or image signature. Keep a regression fixture with a valid multi-megabyte PNG base64 response; small fixtures cannot exercise V8's nested-quantifier stack failure.

---
tech: soc2
tags: [soc2, oneleet, compliance, trust-services-criteria, availability, confidentiality, scope]
severity: high
---
# Oneleet SOC 2 framework can omit scoped categories while reading complete

## PROBLEM
A SOC 2 program scoped to Security + Availability + Confidentiality was set up in Oneleet, and the tenant's only framework ("SOC 2 - Security Controls") held 33 requirements, CC1.1 to CC9.2, with no A1 or C1 requirements at all.
Nothing flags it. The dashboard reads "0 of 33 met", which looks like a complete denominator, every control maps cleanly, and monitors run. The missing categories only surface when someone compares the framework's requirement codes against the scope decision. Found during preparation that is cheap; found during fieldwork it means criteria with no controls, no evidence, and no observation-period history.

## WRONG
```text
Scope decided: Security, Availability, Confidentiality
Check progress: TenantComplianceFrameworkList -> "0 of 33 requirements met"
Assume the 33 cover the scope; start collecting evidence.
```

## RIGHT
```js
// Day one: diff the framework's requirement codes against the scope.
const scope = { security: CC_CODES, availability: ["A1.1", "A1.2", "A1.3"], confidentiality: ["C1.1", "C1.2"] };
const inOneleet = new Set(framework.requirements.map((r) => r.referenceId));
const missing = Object.values(scope).flat().filter((code) => !inOneleet.has(code));
// missing = A1.1..A1.3, C1.1..C1.2 -> ask the vendor to add them, and track each
// as a placeholder control so a coverage check keeps failing loudly until they exist.
```

## NOTES
The fixed control catalog cannot be extended by the customer (controls cannot be created), so the fix is on the vendor side; ask early whether the signed quote covers the extra categories. A coverage check that reads only the vendor's requirement list passes vacuously here: drive coverage from your own scope decision and the AICPA TSC code list instead.

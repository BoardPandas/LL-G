---
tech: llm-integration
tags: [llm, classification, classifier, prompt-steering, fail-closed, user-input, billing, prompt-fields, testing]
severity: high
---
# Keeping a field out of an LLM's input does not stop it steering: every field that reaches the prompt is a lever

## PROBLEM

An LLM classifier makes a consequential decision -- bug vs billable feature
request, refund eligible or not, priority -- and is designed to fail closed. A new
intake path asks the submitter to pick a category, and the design correctly keeps
that category OUT of the classifier's input.

Then the same design writes the category into the record's title
(`[feedback/feature-idea] ...`) or restates it in a context block in the body.
Both reach the prompt, and the title is usually the highest-weight field a
classifier reads. The submitter's own label now steers a paid model toward the
outcome the fail-closed design existed to protect -- through the front door, with
no injection attempt and no error.

## WRONG

```ts
const title = `[feedback/${category}] ${firstLine}`;          // category leaks into the prompt
const body = `${message}\n\nCategory: ${category}`;           // ...and again here
await createRecord({ title, body });                          // classifier reads title + body
```

## RIGHT

```ts
const title = `[feedback] ${firstLine}`;                      // neutral prefix only
await createRecord({ title, body: message, feedbackCategory: category });
// The category lives in a column a human reads and no prompt does.
```

```ts
// Guard: build the real classifier request for each category and assert the
// label appears nowhere in it. Use a message that does not contain the words.
for (const category of CATEGORIES) {
  const record = recordFromFeedback({ message: 'The page will not load', category });
  const request = buildClassifierRequest(record);
  expect(JSON.stringify(request)).not.toContain(category);
}
```

## NOTES

- Enumerate EVERY field that reaches the prompt -- title, body, labels, tags,
  project or product name, attachment filenames -- not just the field being added.
- The test must exercise the real request builder, not a hand-assembled prompt,
  or it stops covering the next field someone adds.
- Related: a classifier that must fail closed should map parse or transport
  failures to manual triage, never to the billable outcome.

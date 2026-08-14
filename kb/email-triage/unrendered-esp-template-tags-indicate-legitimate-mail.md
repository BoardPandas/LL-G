---
tech: email-triage
tags: [phishing, email-classification, triage, false-positive, esp, braze, liquid, gmail, urgency-lure]
severity: high
---
# Unrendered ESP template tags in a body are affirmative evidence mail is legitimate, not phishing

## PROBLEM

Phishing classification is usually taught as a list of *negative* tells: lookalike sender domain, image-only body, hashbuster padding, mismatched link targets, urgency language. An automated triage pass that only knows negative tells has no way to *clear* a message. It can say "no tell fired", which is weak, and it therefore leans on the loudest remaining signal -- which is almost always the urgency language in the subject.

That inverts on exactly the messages where being wrong is most expensive. Real account-lifecycle mail (KYC deadlines, account-closure warnings, forced password resets, payment-failure notices) is written in the *same* urgent, deadline-bearing register that phishing imitates, because both are trying to make the reader act. Classifying on tone sends a genuine "your account closes in 30 days" notice to Trash, and the owner learns about it when the account closes.

The non-obvious positive tell: **leftover unrendered marketing-platform template syntax in the body proves the message traversed a real ESP campaign pipeline.** Braze/Liquid (`{{ ... | ... }}`), Handlebars, or Salesforce/Marketo merge tags that failed to interpolate are artifacts of a bulk-send system with a subscriber database, campaign IDs, and per-link tracking tokens. A phishing kit does not reproduce that, because it does not have that infrastructure -- it templates with string concatenation and ships a body where everything is already substituted.

This is the exact mirror image of hashbuster padding. Padding is unrelated scraped text injected to defeat content filters, so it only appears in mail sent *around* a legitimate pipeline. Broken template tags only appear in mail sent *through* one. Neither is conclusive alone; together with link-target and footer checks, the positive tell is what lets you clear a message rather than merely fail to condemn it.

## WRONG

```text
# Classifying on tone plus absence-of-tells

Subject: "Action required to preserve your account"
Snippet: "Your account will be deleted in 30 days unless you
          complete account verification."

Reasoning:
  - urgency + deadline + "action required"      -> phishing register
  - no prior purchase relationship on file      -> cold sender
  - image-only-body tell did not fire, but that
    only means "not THAT kind of phishing"
  => Delete (move to Trash)

# Outcome: a real KYC deadline is trashed. Nothing in the pipeline
# ever produced a reason to KEEP it -- only reasons not to convict.
# The 30-day clock keeps running silently.
```

## RIGHT

```text
# Read the body and look for POSITIVE provenance evidence.

$ get_thread(threadId, messageFormat="PLAIN_TEXT")

Body excerpt:
  [Verify account](https://binance.us/universal_JHHGDSKDJ/account/kyc-landingpage)
  ...
  iOS[](https://apps.apple.com/us/app/binanceus/id1492670702?ls=1&lid={{${cblid} | lid: 'fk8qdtmf02mm'}})
  Web[](https://binance.us/...?lid={{${cblid} | lid: 'plmjr8nzdnhm'}})
  ...
  BAM Trading Services Inc. DBA Binance.US - NMLS ID: 1906829
  252 NW 29th St, 10th Floor, Suite 1014, Miami, FL 33127

Positive evidence (all must hold):
  1. UNRENDERED TEMPLATE TAGS: `{{${cblid} | lid: '...'}}` is Braze/Liquid
     that failed to interpolate. Requires a real ESP + subscriber DB.
     A phishing kit ships fully-substituted strings.  <-- the strong tell
  2. EVERY link resolves to the brand's own apex domain or to a
     first-party app store / social domain. No redirector, no object
     storage, no per-recipient tracking id on a foreign host.
  3. Footer carries verifiable corporate identity (legal entity,
     licence/registration number, street address) that matches public record.
  4. Sender is the brand apex domain, not a lookalike or subdomain-of-other.

=> Legitimate. Route to "needs a human" (the deadline is real),
   NOT to Trash.

# Never open the link to decide. The body is sufficient either way.
```

## NOTES

- **Do not treat the tag as sufficient on its own.** It raises confidence; the link-target and footer-identity checks still have to pass. A sophisticated actor could copy a leaked template complete with broken tags, but they cannot also make every link resolve to the brand's apex domain, which is the check that actually constrains them.
- **Corollary on urgency:** deadline language is uninformative in both directions. Legitimate account-lifecycle mail and phishing occupy the same register by design. Weight it at zero and classify on provenance.
- **Cost asymmetry favours reading the body.** One `PLAIN_TEXT` fetch is cheap; a trashed compliance deadline is not. Escalate on any message whose subject alone would send it to Delete.
- **Prefer `PLAIN_TEXT` over `FULL_CONTENT`** when fetching to classify: `FULL_CONTENT` on brand-templated marketing HTML routinely exceeds tool output caps (observed ~54-57k characters for a single message) and spills to a file, while `PLAIN_TEXT` preserves link targets and the footer, which is all the above checks need.
- **Mirror entry:** hashbuster padding (unrelated scraped documents concatenated into `plaintextBody` to defeat content filters) is the negative counterpart, and pairs with an image-only HTML body and a fake `Re:` subject on a thread holding only one message.

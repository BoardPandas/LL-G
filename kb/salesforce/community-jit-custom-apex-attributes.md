---
tech: salesforce
tags: [salesforce, jit, provisioning, experience-cloud, saml, apex, entra, custom-attributes]
severity: high
---
# Community JIT needs custom Apex, and IdP custom attributes map to the wrong source

## PROBLEM
Two traps when standing up SAML Just-in-Time provisioning for Experience Cloud
(community) members:
1. Standard attribute JIT does not cleanly provision community users; they must be
   bound to a Contact under an Account. The one-checkbox "Standard" JIT creates plain
   internal users, not community users. You need a custom Apex `Auth.SamlJitHandler`.
2. Sign-up attributes collected by a custom IdP user flow (e.g. Entra External ID's
   PhoneNumber, JobFunction, OrganizationsName) live in DIRECTORY EXTENSION attributes,
   not the built-ins. Mapping the SAML claim from the built-in (`user.telephonenumber`,
   `user.companyname`) sends an EMPTY value with no error; the field silently arrives
   blank in Salesforce.

## WRONG
```text
- Enable Standard JIT and expect community (portal) users to be created -> fails or
  makes the wrong user type.
- Map Salesforce Contact.Phone claim from user.telephonenumber when the sign-up flow
  wrote the phone to a CUSTOM attribute "PhoneNumber":
    Claim: Contact.Phone  Source: user.telephonenumber   -> arrives empty
```

## RIGHT
```apex
// Custom handler creates Account (by org), Contact (dedup by email), community User.
global class EntraSamlJitHandler implements Auth.SamlJitHandler {
  global User createUser(Id p, Id communityId, Id portalId, String fedId,
                         Map<String,String> attrs, String assertion) {
    // find-or-create Account by attrs.get('Account.Name'), Contact by email,
    // then insert a community User bound to that Contact with FederationIdentifier=fedId
  }
  global void updateUser(...) { /* refresh Contact fields each login */ }
}
```
```text
IdP claim mapping for CUSTOM sign-up attributes -> use the extension source:
  Claim: Contact.Phone         Source: user.extension_<extapp-guid>_PhoneNumber
  Claim: Contact.JobFunction   Source: user.extension_<extapp-guid>_JobFunction
  Claim: Account.Name          Source: user.extension_<extapp-guid>_OrganizationsName
Built-in attributes (givenName, surname, mail, streetAddress, postalCode, jobTitle)
map from user.<attr> directly.
```

## NOTES
- Distinguish built-in vs custom by the attribute name in the user flow: built-ins are
  lowercase camelCase (givenName, jobTitle); custom attributes created for the flow are
  often PascalCase (JobFunction, PhoneNumber) and only exist as extension attributes.
- The Apex handler MUST dedup Contacts by a stable key (email or member ID) or every
  login spawns a duplicate member.
- Community usernames must be globally unique across ALL Salesforce orgs; append a
  suffix to the email.
- JIT errors surface only as a generic "Single Sign-On Error" in the browser; the exact
  Apex line is in Setup > Identity Provider Event Log and the execute-as user's debug
  logs.
- Custom Contact fields the handler writes (e.g. Job_Function__c) must exist first.

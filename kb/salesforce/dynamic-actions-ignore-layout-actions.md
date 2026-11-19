---
tech: salesforce
tags: [salesforce, lightning, flexipage, dynamic-actions, quick-action, page-layout]
severity: medium
---
# Record pages with Dynamic Actions ignore the page layout's actions

## PROBLEM
Adding a quick action to a page layout's "Mobile & Lightning Actions" does nothing on a
Lightning record page whose highlights panel uses Dynamic Actions. The deploy succeeds and the
button never appears. Which pages do this is visible only in the FlexiPage metadata.

## WRONG
```xml
<!-- Layout only: invisible on a Dynamic Actions page -->
<platformActionListItems>
    <actionName>Contact.Issue_Code</actionName>
    <actionType>QuickAction</actionType>
    <sortOrder>27</sortOrder>
</platformActionListItems>
```

## RIGHT
```xml
<!-- In the FlexiPage's force:highlightsPanel, property actionNames -->
<valueListItems>
    <value>Contact.Issue_Code</value>
    <visibilityRule>
        <criteria>
            <leftValue>{!$Permission.CustomPermission.Issue_Code}</leftValue>
            <operator>EQUAL</operator>
            <rightValue>true</rightValue>
        </criteria>
    </visibilityRule>
</valueListItems>
```

## NOTES
Retrieve every FlexiPage for the object and look for `enableActionsConfiguration` true or an
`actionNames` property; update those and the layouts used by the other pages. A
custom-permission visibility rule also hides the action from users who cannot use it.
Production deploys refuse `--test-level NoTestRun` even for layouts and pages; use
`RunSpecifiedTests`.

---
tech: go
tags: [encoding-xml, testing, zero-values, scheduled-tasks, mutation-testing]
severity: high
---
# XML safety assertions can pass when the required element is missing

## PROBLEM

Unmarshalling a scheduled-task definition into bool fields makes a missing element
look identical to an explicit false. A test intended to prove Enabled=false or
AllowStartOnDemand=false therefore stays green when the safety setting is removed.
A second false green comes from modelling real trigger elements as repeated generic
Trigger children: encoding/xml silently ignores unmatched elements, so the test sees
zero triggers even when a LogonTrigger exists.

## WRONG

```go
var task struct {
    Enabled bool `xml:"Settings>Enabled"`
    Triggers []struct{} `xml:"Triggers>Trigger"`
}
_ = xml.Unmarshal(definition, &task)
if task.Enabled || len(task.Triggers) != 0 { t.Fatal("unsafe task") }
// Missing Enabled and a real LogonTrigger can both pass.
```

## RIGHT

```go
var task struct {
    Settings struct {
        Enabled *bool `xml:"Enabled"`
        AllowStartOnDemand *bool `xml:"AllowStartOnDemand"`
    } `xml:"Settings"`
    Triggers struct {
        Children []struct { XMLName xml.Name } `xml:",any"`
    } `xml:"Triggers"`
}
if err := xml.Unmarshal(definition, &task); err != nil { t.Fatal(err) }
if task.Settings.Enabled == nil || *task.Settings.Enabled { t.Fatal("not explicitly disabled") }
if task.Settings.AllowStartOnDemand == nil || *task.Settings.AllowStartOnDemand { t.Fatal("on-demand not explicitly disabled") }
if len(task.Triggers.Children) != 0 { t.Fatal("unexpected trigger") }
```

## NOTES

Mutate the actual production definition independently: remove Enabled, remove
AllowStartOnDemand, and add a real LogonTrigger. Each mutation must fail the test;
restore the definition and confirm the test passes. All three checks were measured
during the Windows elevation P0 probe review on 2026-09-20, before native execution.
Portable XML tests are useful but do not prove Windows accepted the definition or
that Task Scheduler enforces the intended security context.

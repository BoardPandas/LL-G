---
tech: windows
tags: [go, com, task-scheduler, xml, utf-16, cleanup]
severity: high
---
# Task Scheduler XML crosses a UTF-16 COM boundary

## PROBLEM

`ITaskFolder::RegisterTask` receives an XML BSTR, not the caller's original byte
buffer. Go COM bindings convert a Go UTF-8 string to UTF-16. Declaring the XML as
UTF-8 can make Task Scheduler reject registration with `unable to switch the
encoding`, even though Go's XML parser accepted the original string.

The reverse boundary also matters: the registered task's exported XML may declare
UTF-16, but the COM binding already decoded its BSTR into a Go UTF-8 string.
Feeding those bytes directly into `encoding/xml` fails on the encoding declaration
or encourages an incorrect second UTF-16 decoding step.

Separately, the COM enum `TASK_LOGON_SERVICE_ACCOUNT` (5) is not a valid XML
`LogonType` text value. The XML schema and the COM method enum are different
contracts; do not put `<LogonType>ServiceAccount</LogonType>` in task XML.

## WRONG

```go
// The declaration does not match the BSTR passed by COM.
definition := `<?xml version="1.0" encoding="UTF-8"?><Task ...>...</Task>`
_, err := oleutil.CallMethod(folder, "RegisterTask", name, definition,
    2, "SYSTEM", nil, 5, taskDACL)

// Readback is already a Go string, but may still declare UTF-16.
err = xml.Unmarshal([]byte(taskXML.ToString()), &parsed)
```

## RIGHT

```go
// Leave the declaration encoding-free; COM owns the string representation.
definition := `<?xml version="1.0"?><Task ...>...</Task>`
// Put SYSTEM's SID in Principal/UserId. Set service-account logon through the
// RegisterTask argument, without the invalid XML ServiceAccount logon text.
_, err := oleutil.CallMethod(folder, "RegisterTask", name, definition,
    2, "SYSTEM", nil, 5, taskDACL)
if err != nil { return err }

// Only for XML already decoded from a COM BSTR, not arbitrary UTF-16 file bytes.
decoder := xml.NewDecoder(strings.NewReader(taskXML.ToString()))
decoder.CharsetReader = func(charset string, input io.Reader) (io.Reader, error) {
    if !strings.EqualFold(charset, "UTF-16") {
        return nil, errors.New("unexpected COM XML charset")
    }
    return input, nil
}
if err := decoder.Decode(&parsed); err != nil { return err }
```

## NOTES

- Validate with native registration, exact principal/action readback, refusal to
  overwrite an existing task, and removal. A well-formed Go XML parse does not
  test Windows schema or COM behavior.
- Preserve the actual COM error in credential-free diagnostics. A generic
  bootstrap error hid the encoding mismatch during the first investigation.
- Native registration/readback/removal passed in SupportForge candidate run
  36165035861 on September 25, 2026 after both boundary corrections.
- Microsoft method contract:
  https://learn.microsoft.com/en-us/windows/win32/api/taskschd/nf-taskschd-itaskfolder-registertask
- Microsoft XML schema:
  https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-schema

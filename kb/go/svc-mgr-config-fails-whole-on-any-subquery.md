---
tech: go
tags: [go, windows, services, scm, x-sys]
severity: high
---
# x/sys/windows/svc/mgr Service.Config() fails whole when any sub-query fails

## PROBLEM
`(*mgr.Service).Config()` calls QueryServiceConfig plus QueryServiceConfig2 for DESCRIPTION, DELAYED_AUTO_START_INFO and SERVICE_SID_INFO. If any of them fails -- for example a description stored as a resource string like `@file.dll,-101` whose MUI file will not load (ERROR_MUI_FILE_NOT_FOUND) -- the whole call returns an error. If running-state reporting is gated on Config() succeeding, that service silently never reports as running.

## WRONG
```go
st, _ := s.Query()
cfg, err := s.Config()
if err != nil {
    return err // the service's state is dropped too
}
report(st.State, cfg.StartType)
```

## RIGHT
```go
st, err := s.Query()
if err != nil {
    return err
}
status := Status{Running: st.State == svc.Running}
if cfg, err := s.Config(); err != nil {
    status.StartTypeUnreadable = true // optional detail, not a reason to drop the row
} else {
    status.StartType = cfg.StartType
}
```

## NOTES
If you need the start type reliably, call `windows.QueryServiceConfig` directly; it does not touch the description.

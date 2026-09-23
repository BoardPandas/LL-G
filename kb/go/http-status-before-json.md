---
tech: go
tags: [http, json, error-handling, ipc, desktop-agent, regression-testing]
severity: high
---
# Successful JSON decoding does not establish HTTP success

## PROBLEM

Go's HTTP client returns a response without an error for HTTP 4xx and 5xx.
Decoding that response into a success struct can also return nil: encoding/json
ignores unknown object fields, leaving the struct's fields at their zero values.
An error envelope such as `{"error":"Ticket not found"}` can therefore become
an apparently completed request with no results instead of a refusal.

Observed in a desktop self-help client: the API returned 404, but the service's
IPC result contained no steps, pending=false, and no error. The existing IPC and
UI binding error paths worked; the HTTP client never supplied an error to them.
Twenty HTTP/IPC refusal cases failed before the status check was added.

## WRONG

```go
resp, err := client.Do(req)
if err != nil { return nil, err }
defer resp.Body.Close()
var result SuccessResponse
err = json.NewDecoder(resp.Body).Decode(&result)
return &result, err // error JSON can decode successfully into zero values
```

## RIGHT

```go
resp, err := client.Do(req)
if err != nil { return nil, err }
defer resp.Body.Close()
if resp.StatusCode >= http.StatusBadRequest {
    return nil, fmt.Errorf("request failed: HTTP %d %s",
        resp.StatusCode, http.StatusText(resp.StatusCode))
}
var result SuccessResponse
if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
    return nil, err
}
return &result, nil
```

## NOTES

- Apply the endpoint's status contract before decoding its success schema. A 202
  pending response can be legitimate; the API may impose a narrower 2xx allowlist.
- Retain the caller's existing body cleanup/drain and connection timeout behavior.
- Test JSON error envelopes, misleading success-shaped error bodies, HTML gateway
  errors, empty error bodies, and legitimate empty successful results separately.
- Assert both a non-nil error and a nil success result. Follow the error through
  downstream IPC or bindings, not only the HTTP helper.
- Do not downgrade authentication or retry through a weaker transport because an
  authenticated server refused the request.

---
tech: rust
tags: [axum, serde, extractor, rejection, logging, secrets, password, json]
severity: high
---
# Logging an axum extractor rejection's body text logs the offending value

## PROBLEM
When a request body does not deserialize, the rejection's text (for example axum's JSON rejection `body_text()`, built from the serde error) describes what was wrong **including the value it found**. A sign-in request that sends the password with the wrong JSON type produces a message that quotes that value. A handler or error layer that logs the rejection text "to help debugging" writes the password into the logs.

It is silent: the response is a correct 4xx, and the log line looks like routine validation noise.

## WRONG
```rust
async fn sign_in(payload: Result<Json<SignIn>, JsonRejection>) -> Response {
    let Json(body) = match payload {
        Ok(v) => v,
        Err(rejection) => {
            tracing::warn!(error = %rejection.body_text(), "bad sign-in body"); // quotes the value
            return rejection.into_response();
        }
    };
    // ...
}
```

## RIGHT
```rust
Err(rejection) => {
    let kind = match &rejection {
        JsonRejection::JsonDataError(_) => "json_data_error",
        JsonRejection::JsonSyntaxError(_) => "json_syntax_error",
        JsonRejection::MissingJsonContentType(_) => "missing_json_content_type",
        _ => "other",
    };
    tracing::warn!(kind, status = %rejection.status(), "bad sign-in body"); // kind and status only
    return generic_bad_request();
}
```

## NOTES
- Log the rejection **kind and status** only. The same applies to query, form and path rejections, and to any serde error on untrusted input.
- Consider what the response body says too: echoing the rejection text returns the value to the caller, which is harmless for the sender but not for a log of responses.
- Test: post a body with a recognisable marker in a wrongly typed secret field and assert the marker is absent from captured logs.

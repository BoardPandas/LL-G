---
tech: python
tags: [pydantic-settings, dotenv, doppler, configuration]
severity: medium
---
# pydantic-settings rejects .env keys the model does not define

## PROBLEM
A `BaseSettings` model with `env_file=".env"` defaults to `extra="forbid"` for dotenv content, so any key in `.env` without a matching field stops the app at startup with `extra_forbidden`. A `.env` downloaded from Doppler (which adds `DOPPLER_PROJECT`, `DOPPLER_CONFIG`, `DOPPLER_ENVIRONMENT` and every secret in the config) breaks the app. Unknown process environment variables are ignored, so the same values work under `doppler run` and fail from the file.

## WRONG
```python
class Settings(BaseSettings):
    plex_token: str = ""
    model_config = {"env_file": ".env"}
```

## RIGHT
```python
class Settings(BaseSettings):
    plex_token: str = ""
    model_config = {"env_file": ".env", "extra": "ignore"}
```

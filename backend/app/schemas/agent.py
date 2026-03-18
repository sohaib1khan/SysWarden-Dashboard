from __future__ import annotations

import re
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

_HOSTNAME_RE = re.compile(r"^[a-zA-Z0-9._\-]{1,253}$")
_CAPABILITY_RE = re.compile(r"^[a-z][a-z0-9_.]{0,63}$")


class AgentRegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hostname: str = Field(..., min_length=1, max_length=253)
    capabilities: List[str] = Field(default_factory=list, max_length=50)

    @field_validator("hostname")
    @classmethod
    def validate_hostname(cls, v: str) -> str:
        if not _HOSTNAME_RE.match(v):
            raise ValueError("Invalid hostname format")
        return v

    @field_validator("capabilities", mode="before")
    @classmethod
    def validate_capabilities(cls, v: list) -> list:
        for cap in v:
            if not isinstance(cap, str) or not _CAPABILITY_RE.match(cap):
                raise ValueError(f"Invalid capability name: {cap!r}")
        return v


class AgentRegisterResponse(BaseModel):
    agent_id: str
    # Plaintext key returned exactly once — never stored on the server
    api_key: str


class AgentInfo(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    hostname: str
    capabilities: List[str] = Field(default_factory=list)
    registered_at: datetime
    last_seen: Optional[datetime]
    online: bool

    @field_validator("capabilities", mode="before")
    @classmethod
    def split_capabilities(cls, v):
        if isinstance(v, str):
            return [c for c in v.split(",") if c]
        return v or []

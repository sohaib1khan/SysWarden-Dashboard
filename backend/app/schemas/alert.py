from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator


class AlertRuleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agent_id: str = Field(..., min_length=1, max_length=32)
    metric_name: str = Field(..., min_length=1, max_length=64)
    condition: Literal["gt", "lt", "gte", "lte"]
    threshold: float
    duration_s: int = Field(default=0, ge=0, le=3600)
    webhook_url: Optional[str] = Field(default=None, max_length=512)
    enabled: bool = True

    @field_validator("webhook_url")
    @classmethod
    def validate_webhook(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        if not v.startswith(("http://", "https://")):
            raise ValueError("webhook_url must be an http/https URL")
        return v


class AlertRuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    agent_id: str
    metric_name: str
    condition: str
    threshold: float
    duration_s: int
    webhook_url: Optional[str]
    enabled: bool
    created_at: datetime


class AlertEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    rule_id: int
    agent_id: str
    metric_name: str
    value: float
    threshold: float
    condition: str
    fired_at: datetime
    notified: bool
